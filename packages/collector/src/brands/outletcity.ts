/**
 * OUTLETCITY METZINGEN (outletcity.com) — DE, AT, CH (2026-11-10).
 *
 * Off-price designer outlet (Karl Lagerfeld, Boss, Marc Cain, Tommy Hilfiger,
 * Coach, Joop!, …), SAP Hybris + a Vue micro-frontend. The shop's own list
 * endpoint (`POST /de-de/shop/rest/productlist/filter/page/damen/sale`) needs a
 * guest session cookie bound to a CSRF token AND hides prices from guests, so
 * it is not used. The product list the site itself renders comes from its
 * search provider, epoq, and that is public, cookie-free and carries
 * everything (playbook: search-provider route):
 *
 *   GET https://search.epoq.de/inbound-servletapi/getSearchResult
 *       ?format=json&style=compact&tenantId=outletcity-<de|at|ch>&sessionId=1
 *       &orderBy=&order=desc&limit=500&offset=N&full&locakey&nrf&query=
 *       &ff=g:product_type&fv=<Damen|Herren>
 *
 * (the exact query the site's mf-productlist chunk builds; tenant id from the
 * page's `epoq_tenantId`). The body is JSONP without a callback —
 * `null({"result":{…}});` — with ~115 KB of facets, then
 * `findings.finding[].match-item`, every field wrapped as `{"$": "…"}`:
 * `g:id`, `title`, `g:brand` (the maker), `link` (that market's storefront
 * URL), `g:price`, `c:oldPrice` (the maker's UVP, the price the shop strikes),
 * `e:currency`, `c:saleflag`, `g:quantity`, `g:product_type`
 * ("Damen>Bekleidung>Jacken>Übergangsjacken"), `e:large_image`,
 * `c:largeImageHover`, `c:colordetailed`, and `c:available_sizes`
 * ("L#2#280.00#195.99#30#|M#…" = size#stock#UVP#price#discount, sellable sizes
 * only). ~2.4 MB per 500 rows.
 *
 * Measured 2026-11-10: DE 73.8k women's / 46.1k men's rows, AT 48.3k / 33.9k,
 * CH 26.7k / 28.1k (CHF, own prices). epoq prices equal the product page's
 * (`GET /<market>/shop/rest/products/<code>/`, also public: 43.99 / UVP 89.00).
 * Runner probe 42800838023: epoq 200 for the three tenants with EUR / EUR / CHF
 * and /de-de/, /at-de/, /ch-de/ links; guest product pages and the product
 * JSON 200 with the price — no login is needed to see a price.
 *
 * What is kept: the shop's "Sale" rows (`c:saleflag` — in practice a discount
 * of ≥ 39 % against UVP; the rest of the outlet sits at a flat −30 %), in the
 * shop's own relevance order, with UVP above the price. The was-price is the
 * maker's UVP (an outlet "comparable value"), which the owner accepted for
 * outlet stores. epoq does not carry the product page's 30-day lowest price.
 * Rows whose sizes are priced differently ("ab" prices) are dropped. Kids are
 * not walked. The international shop (/int-en/, tenant outletcity-int, net
 * prices + per-country `c:price_xx`) is English-only with no local storefront
 * and is not collected.
 *
 * Requests per market: 5 women's + 2 men's pages = 7 (each retried up to
 * twice: epoq now and then drops the socket mid-body, seen from the Mac).
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import type { CountryCode } from "../../../../lib/countries";

const EPOQ = "https://search.epoq.de/inbound-servletapi/getSearchResult";

export const OUTLETCITY_MARKETS: Partial<Record<CountryCode, { tenant: string; prefix: string; currency: string }>> = {
  DE: { tenant: "outletcity-de", prefix: "/de-de/shop/", currency: "EUR" },
  AT: { tenant: "outletcity-at", prefix: "/at-de/shop/", currency: "EUR" },
  CH: { tenant: "outletcity-ch", prefix: "/ch-de/shop/", currency: "CHF" },
};

/** Women first; men a minority (25 % of the cap). */
export const OUTLETCITY_TREES: { type: string; gender: "kadin" | "erkek"; pages: number; cap: number }[] = [
  { type: "Damen", gender: "kadin", pages: 5, cap: 1500 },
  { type: "Herren", gender: "erkek", pages: 2, cap: 500 },
];
const PER_PAGE = 500;
const PAUSE_MS = Number(process.env.OUTLETCITY_PAUSE_MS ?? 800);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The site's own search query for one page of a department, relevance order. */
export function epoqUrl(tenant: string, type: string, offset: number, limit: number = PER_PAGE): string {
  return (
    `${EPOQ}?format=json&style=compact&tenantId=${tenant}&sessionId=1&orderBy=&order=desc` +
    `&limit=${limit}&offset=${offset}&full&locakey&nrf&query=&ff=${encodeURIComponent("g:product_type")}&fv=${encodeURIComponent(type)}`
  );
}

/** `null({...});` (JSONP without a callback) → the match-items. Pure. */
export function parseEpoq(body: string): any[] {
  const a = body.indexOf("{");
  const b = body.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("outletcity: epoq answer is not JSON");
  const f = JSON.parse(body.slice(a, b + 1))?.result?.findings?.finding;
  const list = Array.isArray(f) ? f : f ? [f] : [];
  return list.map((x: any) => x?.["match-item"]).filter(Boolean);
}

const val = (m: any, k: string): string => {
  const v = m?.[k]?.$;
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
};
const cents = (s: string): number | null => {
  const n = Number(s);
  return s && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

/** "L#2#280.00#195.99#30#|M#0#…" → sizes + whether all sizes share one price. */
export function parseSizes(s: string): { sizes: SizeVariant[]; onePrice: boolean } {
  const sizes: SizeVariant[] = [];
  const prices = new Set<string>();
  for (const part of s.split("|")) {
    const [label, stock, , price] = part.split("#");
    if (!label?.trim()) continue;
    if (price) prices.add(String(Number(price)));
    sizes.push({ label: label.trim(), availability: Number(stock) > 0 ? "in_stock" : "out_of_stock" });
  }
  return { sizes, onePrice: prices.size <= 1 };
}

/** The 270/530 px list rendition → 800 px (Fastly image optimiser). */
const big = (u: string): string | null => (/^https:\/\//.test(u) ? u.replace(/([?&]width=)\d+/, "$1800") : null);

/** One epoq match-item → a record, or null when it is not a clean Sale row. Pure. */
export function toRecord(m: any, gender: ProductRecord["gender"], country: CountryCode): ProductRecord | null {
  const mk = OUTLETCITY_MARKETS[country];
  if (!mk) return null;
  const id = val(m, "g:id");
  const title = val(m, "title");
  const url = val(m, "link");
  if (!id || !title || !url.startsWith(`https://www.outletcity.com${mk.prefix}`)) return null;
  if (val(m, "e:currency") !== mk.currency) return null;
  if (val(m, "c:saleflag") !== "true") return null;
  const price = cents(val(m, "g:price"));
  const was = cents(val(m, "c:oldPrice"));
  if (price == null || was == null || was <= price) return null;
  const { sizes, onePrice } = parseSizes(val(m, "c:available_sizes"));
  // "ab" rows: sizes priced differently, so neither price nor UVP is one number.
  if (!onePrice || val(m, "c:fromPrice")) return null;

  const maker = val(m, "g:brand") || null;
  const image = big(val(m, "e:large_image") || val(m, "g:image_link"));
  const real = sizes.filter((s) => !/^one size$/i.test(s.label));
  const type = val(m, "g:product_type").split(">").map((x) => x.trim()).filter(Boolean);
  return {
    brand: "outletcity",
    country,
    externalId: id,
    name: maker && !title.toLowerCase().startsWith(maker.toLowerCase()) ? `${maker} ${title}` : title,
    url,
    imageUrl: image,
    images: cleanGallery([image, big(val(m, "c:largeImageHover"))], image),
    price,
    listPrice: was,
    currency: mk.currency,
    inStock: Number(val(m, "g:quantity")) > 0,
    maker,
    category: type.length > 1 ? type[type.length - 1] : null,
    gender,
    colorName: val(m, "c:colordetailed") || val(m, "g:color") || null,
    variants: real.length ? { colors: [], sizes: real } : null,
    // `c:available_sizes` lists only sizes with stock.
    sizesInStockOnly: real.length ? true : undefined,
  };
}

export async function listOutletcity(
  country: CountryCode,
  fetchBody: (u: string) => Promise<string> = (u) => getText(u, { country, timeoutMs: 90_000, headers: { Accept: "*/*", "Accept-Language": "de-DE,de;q=0.9" } }),
): Promise<ProductRecord[]> {
  const mk = OUTLETCITY_MARKETS[country];
  if (!mk) return [];
  const out: ProductRecord[] = [];
  const seen = new Set<string>();
  let calls = 0;
  for (const tree of OUTLETCITY_TREES) {
    const rows: ProductRecord[] = [];
    for (let page = 0; page < tree.pages; page++) {
      if (calls++) await sleep(PAUSE_MS);
      let items: any[] | null = null;
      let lastErr: unknown;
      // epoq sometimes drops the socket mid-body on these 2 MB answers: retry.
      for (let attempt = 0; attempt < 3 && !items; attempt++) {
        if (attempt) await sleep(PAUSE_MS * 2 * attempt);
        try {
          items = parseEpoq(await fetchBody(epoqUrl(mk.tenant, tree.type, page * PER_PAGE)));
        } catch (err) {
          lastErr = err;
        }
      }
      if (!items) {
        if (tree === OUTLETCITY_TREES[0] && page === 0) throw lastErr;
        break;
      }
      if (tree === OUTLETCITY_TREES[0] && page === 0 && items.length === 0) throw new Error("outletcity: the search answered no products (query changed?)");
      for (const m of items) {
        const r = toRecord(m, tree.gender, country);
        if (!r || seen.has(r.externalId)) continue;
        seen.add(r.externalId);
        rows.push(r);
      }
      if (items.length < PER_PAGE) break;
    }
    out.push(...[...rows.filter((r) => r.inStock), ...rows.filter((r) => !r.inStock)].slice(0, tree.cap));
  }
  console.log(`outletcity/${country}: ${calls} pages, kept ${out.length}`);
  return out;
}
