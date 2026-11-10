/**
 * TK Maxx Germany + Austria — the clearance ("Sale") range via Bloomreach Discovery (2026-11-10).
 *
 * tkmaxx.com is Akamai-walled for datacentre IPs (403 "securityfailover" page,
 * robots.txt included) and so is the app's own API host `api.mbaeu.tjx.com`
 * (probe runs 42800460434, 42801737998). The shop's search is Bloomreach
 * Discovery, which is public. Account id 7256 and the catalogue name
 * `tkmaxx_de` come from the Android app (`com.tjx.tkmaxx`, Flutter, `libapp.so`
 * strings). The catalogue answers NOTHING without the right view:
 * `view_id=tkmaxx-de` (Germany) / `tkmaxx-at` (Austria); without a view, or with
 * a wrong one, numFound is 0, and an unknown domain key silently falls back to
 * the UK catalogue. There is no Dutch/Polish catalogue on this account.
 *
 *   GET https://core.dxpapi.com/api/v1/core/?account_id=7256&domain_key=tkmaxx_de
 *       &view_id=tkmaxx-de&request_type=search&search_type=keyword&q=*
 *       &fq=is_clearance:"true"&fq=department:"Damen"&fl=…&rows=200&start=N
 *
 * Runner-verified for both views (probe run 42804255823: 200, German titles,
 * 200 docs a page). Measured 2026-11-10 (DE): 32,562 products, 7,429 on
 * clearance — Damen 3,595, Herren 970, Home 2,650 (skipped), Kinder 214 (skipped).
 *
 * Prices: TK Maxx prices everything under a maker's `rrp` ("UVP"), so the RRP
 * is NOT used — that would mark the whole catalogue as discounted. Only
 * clearance rows count, struck against `was_price` (TK Maxx's own earlier
 * price); all 200 of 200 sampled clearance rows had was_price > price.
 * `sizes` lists what is sellable now ("g,0002,0004,universal,xs" → "xs").
 *
 * FRAGILE — photos: `img.tkmaxx.com` (Akamai) answered 403 to browser and
 * `okhttp` User-Agents and 200 to `CFNetwork` (iOS) and `Dalvik` ones, from the
 * runner and from the Mac alike. Check the photos in the Android app before
 * this brand ships; a server-side resizer must send one of the passing UAs.
 * Product pages themselves are walled for bots (fine for shoppers), so a
 * pasted-link resolver has to query this search by pid instead.
 *
 * NOT LISTED in lib/brands.ts / the registry (2026-11-10): `img.tkmaxx.com` answers 403
 * to an `okhttp` User-Agent (what React Native's Android image loader sends) from
 * both this Mac and a GitHub runner (probe run 42811005492), so every photo would
 * be blank on Android. List it once photos are served through something that
 * sends a passing User-Agent (CFNetwork / Dalvik pass).
 */
import { type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";

const API = "https://core.dxpapi.com/api/v1/core/";
export const TKMAXX_MARKETS: Partial<Record<CountryCode, { view: string; site: string; currency: string }>> = {
  DE: { view: "tkmaxx-de", site: "https://www.tkmaxx.com/de/de", currency: "EUR" },
  AT: { view: "tkmaxx-at", site: "https://www.tkmaxx.com/at/de", currency: "EUR" },
};
export const TKMAXX_TREES: { department: string; gender: "kadin" | "erkek"; pages: number }[] = [
  { department: "Damen", gender: "kadin", pages: 8 },
  { department: "Herren", gender: "erkek", pages: 4 },
];
const FL = "pid,title,price,url,thumb_image,brand,rrp,was_price,stock,is_clearance,sizes,colors,department,price_range";
const ROWS = 200;
const CAP = 2000;
const PAUSE_MS = Number(process.env.TKMAXX_PAUSE_MS ?? 300);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function searchUrl(country: CountryCode, department: string, start: number): string {
  const m = TKMAXX_MARKETS[country]!;
  const fq = (s: string) => `&fq=${encodeURIComponent(s)}`;
  return (
    `${API}?account_id=7256&domain_key=tkmaxx_de&view_id=${m.view}&request_type=search&search_type=keyword&q=*` +
    fq('is_clearance:"true"') +
    fq(`department:"${department}"`) +
    `&fl=${FL}&rows=${ROWS}&start=${start}&url=${encodeURIComponent(m.site)}` +
    `&_br_uid_2=${encodeURIComponent("uid=1234567890123:v=15.0:ts=1700000000000:hc=1")}&request_id=1`
  );
}

const cents = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null);

/** "g,0002,0004,universal,xs" → "XS"; null for the one-size placeholders. */
export function sizeLabel(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const label = s.split(",").slice(4).join(",").trim();
  if (!label || /^(keine gr(ö|oe)(ß|ss)e|nosize|one size|einheitsgr(ö|oe)(ß|ss)e)$/i.test(label)) return null;
  return label.toUpperCase();
}

/** The product-type folder of a page path: "/damen/bekleidung/x/hosen/<slug>/p/1" → "hosen". */
export function categoryOf(path: string): string | null {
  const seg = path.split("/p/")[0].split("/").filter(Boolean);
  const c = seg.length >= 2 ? seg[seg.length - 2] : null;
  return c ? c.replace(/[+-]+/g, " ").replace(/\s+/g, " ").trim() || null : null;
}

export function toRecord(d: any, gender: ProductRecord["gender"], country: CountryCode): ProductRecord | null {
  const m = TKMAXX_MARKETS[country];
  const pid = typeof d?.pid === "string" ? d.pid : "";
  const title = typeof d?.title === "string" ? d.title.trim() : "";
  const path = typeof d?.url === "string" ? d.url : "";
  if (!m || !pid || !title || !/^\/.+\/p\/[^/]+$/.test(path)) return null;
  if (String(d.is_clearance) !== "true") return null;
  const price = cents(d.price);
  const listPrice = cents(d.was_price);
  if (!price || !listPrice || listPrice <= price) return null;
  // A price range across sizes is not one price.
  const range = Array.isArray(d.price_range) ? d.price_range : [];
  if (range.length === 2 && range[0] !== range[1]) return null;

  const sizes: SizeVariant[] = [];
  for (const s of Array.isArray(d.sizes) ? d.sizes : []) {
    const label = sizeLabel(s);
    if (label && !sizes.some((x) => x.label === label)) sizes.push({ label, availability: "in_stock" });
  }
  const maker = typeof d.brand === "string" && d.brand.trim() ? d.brand.trim() : null;
  const colour = Array.isArray(d.colors) && typeof d.colors[0] === "string" ? d.colors[0] : null;
  const image = typeof d.thumb_image === "string" && /^https:\/\//.test(d.thumb_image) ? d.thumb_image : null;
  return {
    brand: "tkmaxx",
    country,
    externalId: pid,
    name: maker ? `${maker} ${title}` : title,
    url: `${m.site}${path}`,
    imageUrl: image,
    images: null,
    price,
    listPrice,
    currency: m.currency,
    inStock: typeof d.stock === "number" ? d.stock > 0 : true,
    category: categoryOf(path),
    maker,
    gender,
    variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
    sizesInStockOnly: sizes.length ? true : undefined,
    groupKey: null,
    colorName: colour,
  };
}

export async function listTkMaxx(
  country: CountryCode,
  fetchJson: (u: string) => Promise<any> = (u) => getJson(u, { country, timeoutMs: 45_000 }),
): Promise<ProductRecord[]> {
  if (!TKMAXX_MARKETS[country]) throw new Error(`tkmaxx: no market ${country}`);
  const byId = new Map<string, ProductRecord>();
  let first = true;
  for (const tree of TKMAXX_TREES) {
    for (let page = 0; page < tree.pages; page++) {
      let docs: any[];
      try {
        const res = await fetchJson(searchUrl(country, tree.department, page * ROWS));
        docs = Array.isArray(res?.response?.docs) ? res.response.docs : [];
      } catch (e) {
        if (first) throw e;
        break;
      }
      // An empty first page is how a wrong view or a retired catalogue shows up.
      if (first && !docs.length) throw new Error(`tkmaxx/${country}: empty first page`);
      first = false;
      for (const d of docs) {
        const rec = toRecord(d, tree.gender, country);
        if (rec && !byId.has(rec.externalId)) byId.set(rec.externalId, rec);
      }
      if (docs.length < ROWS) break;
      await sleep(PAUSE_MS);
    }
  }
  const rows = [...byId.values()];
  return [...rows.filter((r) => r.inStock), ...rows.filter((r) => !r.inStock)].slice(0, CAP);
}
