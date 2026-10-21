/**
 * Tendam group — Women'secret, Springfield and Cortefiel (Spain), one
 * Salesforce Commerce Cloud stack behind Cloudflare: Sites-WS / Sites-SPF /
 * Sites-CTF on womensecret.com, myspringfield.com and cortefiel.com.
 *
 * There is no third-party search provider (Einstein/CQuotient only), so the
 * feed is the storefront's own listing HTML. A listing path takes SFRA's
 * `?start=N&sz=60` paging directly, so no category id is needed: 200 from a
 * GitHub runner for all three homepages (probe run 39612079467, 2026-10-21).
 * From a Turkish IP womensecret.com geo-redirects a browser UA to
 * intl.womensecret.com; runners (US) are not redirected.
 *
 * Which listings: the sale shelves are campaign categories whose paths change
 * with the season ("mid-season-sale", "rebajas", "precios-especiales"), so each
 * run reads the brand's homepage navigation and keeps the women's/men's links
 * under `promociones/`, `rebajas/` or `precios-especiales` — minus multi-buy
 * campaigns ("3 por 2", "2ª unidad al 50%", "2x30"), whose discount only
 * exists in the basket. Kids, teen and home shelves are left out.
 *
 * A tile is one style in its selected colour. `basePrice` is the struck
 * "Inicial" price (the tile's price-history tooltip states the discount is
 * applied over it — EU Omnibus wording), `salesPrice` the current one. A
 * listing only shows sellable colours; `outOfStock` in the colour data is
 * honoured anyway. Sizes need one extra call per style
 * (Product-GetProductVariantData), so they are not collected here. Guest
 * brands (Calvin Klein at Women'secret, Only at Springfield, Pedro del Hierro
 * at Cortefiel) are kept with `maker` set.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { decodeEntities, jsonOf } from "./_sfcchtml";

export type TendamBrand = "womensecret" | "springfield" | "cortefiel";

export const TENDAM: Record<TendamBrand, { origin: string; house: string }> = {
  womensecret: { origin: "https://womensecret.com", house: "Women'secret" },
  springfield: { origin: "https://myspringfield.com", house: "Springfield" },
  cortefiel: { origin: "https://cortefiel.com", house: "Cortefiel" },
};
/** Storefront path per market. */
const MARKETS: Partial<Record<CountryCode, string>> = { ES: "/es/es" };

const PAGE = 60;
const MAX_REQUESTS = 40;
const MAX_LISTINGS = 8;
const CAP = 1500;
const PAUSE_MS = Number(process.env.TENDAM_PAUSE_MS ?? 500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const clean = (s: unknown): string => (typeof s === "string" ? decodeEntities(s).replace(/\s+/g, " ").trim() : "");
/** "Women'secret" / "Womensecret" / "WOMENSECRET" → "womensecret". */
const fold = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, "");

/** "1.299,99 €" → 1299.99. Pure. */
export function euros(s: string | undefined | null): number {
  const t = clean(s ?? "").replace(/[^0-9.,]/g, "");
  if (!t) return NaN;
  return parseFloat(t.replace(/\./g, "").replace(",", "."));
}

const SALE = /\/(?:[a-z-]+\/)*(?:promociones|rebajas)\/[a-z0-9-]+(?:\/[a-z0-9-]+)*|\/(?:mujer|hombre)\/precios-especiales(?:-marcas)?/;
const MULTIBUY = /\d+-por-\d+|\d+x\d+|unidad-al|de-dos-en-dos|packs?-/;
const NOT_ADULT = /\/(?:ninos?|ninas?|nino|nina|teen|hogar|home|deporte-ninos)(?:\/|-|$)|-(?:nino|nina|ninos|ninas|teen|hogar)(?:\/|$)/;

/** Sale listing paths linked from a brand homepage, women's first. Pure. */
export function saleListings(homeHtml: string, prefix: string): string[] {
  const out = new Set<string>();
  for (const m of homeHtml.matchAll(/href="(?:https:\/\/[a-z.]+)?(\/[a-z]{2}\/[a-z]{2}\/[^"?#]+)"/g)) {
    const path = m[1].replace(/\/+$/, "");
    if (!path.startsWith(prefix + "/")) continue;
    const rest = path.slice(prefix.length);
    if (!SALE.test(rest) || MULTIBUY.test(rest) || NOT_ADULT.test(rest)) continue;
    if (/\/promociones$|\/rebajas$/.test(rest)) continue;
    out.add(path);
  }
  const list = [...out];
  // The house's own shelves before guest-brand ones; women's before men's.
  const rank = (p: string) => (/guest|marcas/.test(p) ? 10 : 0) + (/mujer/.test(p) ? 0 : /hombre/.test(p) ? 1 : 2);
  return list.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Split a listing page into product tiles. Pure. */
export function tendamTiles(html: string): string[] {
  return html.split('<div class="productTile defaultTile').slice(1);
}

/** The audience a sale listing path names, if any. Pure. */
export function listingGender(path: string): ProductRecord["gender"] {
  return /mujer/.test(path) ? "kadin" : /hombre/.test(path) ? "erkek" : null;
}

/** Who a storefront section ("mujer", "men", "teen") is for. Pure. */
export function sectionGender(section: string): ProductRecord["gender"] | undefined {
  if (/^(mujer|women|woman)$/.test(section)) return "kadin";
  if (/^(hombre|men|man)$/.test(section)) return "erkek";
  if (/^(ninos?|ninas?|teen|kids)$/.test(section)) return "cocuk";
  return undefined;
}

/**
 * One tile → a record, or null when it is not a struck-price deal. `fallback`
 * is the listing's own audience, for products filed under a neutral section
 * ("calcetines"). Pure.
 */
export function mapTendamTile(
  tile: string,
  brand: TendamBrand,
  country: CountryCode = "ES",
  fallback: ProductRecord["gender"] = null,
): ProductRecord | null {
  const ld = jsonOf<any>(tile.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? "") ?? {};
  const was = euros(tile.match(/<span class="basePrice[^"]*">([^<]*)<\/span>/)?.[1]);
  const price = euros(tile.match(/<span class="salesPrice[^"]*">([^<]*)<\/span>/)?.[1]);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(was) || was <= price) return null;
  const url = typeof ld.url === "string" ? ld.url : null;
  const name = clean(ld.name) || clean(tile.match(/productTileProductName[^>]*>([^<]*)</)?.[1]);
  if (!url || !name) return null;
  const master = url.match(/\/(\w+)\.html/)?.[1];
  const colorId = url.match(/_color=(\w+)/)?.[1];
  if (!master) return null;
  const info = jsonOf<any>(decodeEntities(tile.match(/data-color-info="([^"]*)"/)?.[1] ?? "")) ?? {};
  const color = clean(info.displayValue);
  const photos = [...tile.matchAll(/<img class="lazy"[^>]*data-src="([^"]+\/images\/hi-res\/[^"]+)"/g)].map((m) =>
    decodeEntities(m[1]).replace(/\?.*$/, "?sw=800&sh=1200&sm=fit"),
  );
  const images = cleanGallery([...photos, typeof ld.image === "string" ? ld.image : null]);
  const maker = clean(tile.match(/productTileBrandName">([^<]*)</)?.[1]);
  const section = url.match(/\/[a-z]{2}\/[a-z]{2}\/([a-z-]+)\//)?.[1] ?? "";
  const category = clean(url.match(/\/[a-z]{2}\/[a-z]{2}\/[a-z-]+\/([a-z-]+)\//)?.[1]?.replace(/-/g, " ")) || null;
  return {
    brand,
    country,
    externalId: colorId ? `${master}_${colorId}` : master,
    name,
    url,
    imageUrl: images?.[0] ?? null,
    images,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: "EUR",
    inStock: info.outOfStock !== true,
    category,
    maker: maker && fold(maker) !== fold(TENDAM[brand].house) ? maker : null,
    gender: sectionGender(section) ?? fallback,
    variants: color ? { colors: [color], sizes: [] } : null,
    groupKey: `${brand}-${master}`,
    colorName: color || null,
  };
}

/** Register as `listTendam("womensecret" | "springfield" | "cortefiel", country)`. ES only. */
export async function listTendam(brand: TendamBrand, country: CountryCode): Promise<ProductRecord[]> {
  const prefix = MARKETS[country];
  if (!prefix) return [];
  const { origin } = TENDAM[brand];
  // TENDAM_UA: a non-browser UA skips womensecret.com's geo redirect when testing from outside Spain/the US.
  const ua: Record<string, string> = process.env.TENDAM_UA ? { "User-Agent": process.env.TENDAM_UA } : {};
  const opts = { country, timeoutMs: 60_000, headers: { "Accept-Language": "es-ES,es;q=0.9", ...ua } };
  const home = await getText(`${origin}${prefix}`, opts);
  const listings = saleListings(home, prefix).slice(0, MAX_LISTINGS);
  if (!listings.length) throw new Error(`${brand}/${country}: no sale listing linked from the homepage`);
  const byId = new Map<string, ProductRecord>();
  // Round-robin, one page per listing per round, so men's and the house's own
  // shelves are not crowded out by whichever listing comes first.
  const next = new Map<string, number>(listings.map((p) => [p, 0]));
  let requests = 1;
  while (next.size && requests < MAX_REQUESTS && byId.size < CAP) {
    for (const [path, start] of [...next]) {
      if (requests >= MAX_REQUESTS || byId.size >= CAP) break;
      await sleep(PAUSE_MS);
      requests++;
      const html = await getText(`${origin}${path}?start=${start}&sz=${PAGE}`, opts);
      const tiles = tendamTiles(html);
      let fresh = 0;
      for (const t of tiles) {
        const r = mapTendamTile(t, brand, country, listingGender(path));
        if (r && !byId.has(r.externalId)) {
          byId.set(r.externalId, r);
          fresh++;
        }
      }
      // A page past the end repeats the last one (or is empty).
      if (tiles.length < PAGE || (fresh === 0 && start > 0)) next.delete(path);
      else next.set(path, start + PAGE);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
