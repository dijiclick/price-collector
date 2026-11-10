/**
 * Peek & Cloppenburg (P&C Düsseldorf) — DE, AT, NL sale via Constructor.io (2026-11-10).
 *
 * The websites (peek-cloppenburg.de/.at/.nl) sit behind a Cloudflare managed
 * challenge and 403 every datacentre IP, sitemaps included (probe run
 * 42800460434). The shop's search/browse is Constructor.io, on a custom zone
 * host that is NOT walled. Host and keys come from the Android app
 * (`com.fashionid.mobileshop`, Flutter, `libapp.so` strings): one index per
 * tenant. Which key is which market was read from the data itself:
 *   - `key_iHfd…` channel 0446, ~70 German store channels, EUR — a product's
 *     price pair matched the .de page Google had indexed (1745543: 74,99 / 99,99)
 *   - `key_iaHy…` channel 0770 + Austrian stores (0298 = Salzburg on the .at site)
 *   - `key_cXlo…` channel 0772, Dutch texts
 *   (also in the app, not used: Poland `key_Oi5l…` PLN, ANSON'S men's-only
 *   `key_Y0au…`, and stale stage indexes.)
 *
 * Route: GET `/browse/group_id/<Damen|Herren|Kinder>?key=…&filters[flags-sale]=True
 * &num_results_per_page=100&page=N&fmt_options[fields]=…` — default order is the
 * shop's own relevance (first pages were 100% in stock). Runner-verified for
 * all three markets (probe run 42801737998: 200, ~700 KB raw a page).
 * Measured 2026-11-10: DE 53,256 sale of 88,771 products (women 30k, men 21k,
 * kids 1.7k); AT 52,858; NL 51,112. 23 requests per market.
 *
 * One Constructor item = one colour ("dispo") of a style; `variations` are its
 * sizes with `onlineAvailable`. `formerPrice` is the struck price the site
 * shows as "Vorher". `metadata.lowestPriceInfo.lowestPrice` equals the current
 * price on every row seen (100/100), so it is not a usable 30-day reference and
 * is ignored. Rows whose in-stock sizes disagree on price are priced at the
 * cheapest in-stock size.
 *
 * Fragile / unverified: product URLs are `https://www.peek-cloppenburg.<tld>/
 * <lang>/p/<slug>-<id>` — confirmed for .de from Google's index; .at (`/de/p/`)
 * and .nl (`/nl/p/`) follow the same pattern as their indexed category pages
 * but no product page could be fetched (walled). Photos: the CDN only serves
 * an allow-list of option strings; `f=auto,quality=50,width=800` works.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";

const HOST = "https://wpkmgeuco-zone.cnstrc.com";
export const PUC_MARKETS: Partial<Record<CountryCode, { key: string; site: string; currency: string }>> = {
  DE: { key: "key_iHfdPDgapcfSlejV", site: "https://www.peek-cloppenburg.de/de", currency: "EUR" },
  AT: { key: "key_iaHyrMw72VKbm8a6", site: "https://www.peek-cloppenburg.at/de", currency: "EUR" },
  NL: { key: "key_cXloFaAZ9x69VelO", site: "https://www.peek-cloppenburg.nl/nl", currency: "EUR" },
};
/** The three root groups carry the same ids in every market's index. */
export const PUC_TREES: { group: string; gender: "kadin" | "erkek" | "cocuk"; pages: number }[] = [
  { group: "id-iqr0wqjci-lxlxk25a", gender: "kadin", pages: 15 },
  { group: "id-iqr0wqjci-lxlxk25a-sdfax3", gender: "erkek", pages: 6 },
  { group: "id-iqr0wqjci-lxlxk25a-sddfdf", gender: "cocuk", pages: 2 },
];
const FIELDS = ["id", "url", "image_url", "metadata", "price", "formerPrice", "label", "onlineAvailable", "code"];
const PER_PAGE = 100;
const CAP = 2300;
const PAUSE_MS = Number(process.env.PUC_PAUSE_MS ?? 300);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function browseUrl(key: string, group: string, page: number): string {
  const fields = FIELDS.map((f) => `&fmt_options%5Bfields%5D=${f}`).join("");
  return `${HOST}/browse/group_id/${group}?key=${key}&filters%5Bflags-sale%5D=True&num_results_per_page=${PER_PAGE}&page=${page}${fields}`;
}

/** "59.990" → 5999; null for anything that is not a positive amount. */
export function cents(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/** The CDN redirects unknown option strings to a 250 px thumbnail; this one is served at 800 px. */
export function photo(u: unknown): string | null {
  if (typeof u !== "string" || !/^https:\/\//.test(u)) return null;
  return u.replace(/\/cdn-cgi\/image\/[^/]+\//, "/cdn-cgi/image/f=auto,quality=50,width=800/");
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Colour from the page slug (`<brand>-<name>-<colour>-<id>`), only when brand+name match it exactly. */
export function colourFromSlug(url: string, brand: string, name: string, id: string): string | null {
  const slug = url.replace(/^\/p\//, "");
  const head = `${slugify(`${brand} ${name}`)}-`;
  const tail = `-${id}`;
  if (!slug.startsWith(head) || !slug.endsWith(tail)) return null;
  const c = slug.slice(head.length, slug.length - tail.length);
  return c && c.length <= 40 ? c.replace(/-/g, " ") : null;
}

/** One Constructor result → a record; null unless it is a real markdown. */
export function toRecord(r: any, gender: ProductRecord["gender"], country: CountryCode): ProductRecord | null {
  const m = PUC_MARKETS[country];
  const d = r?.data;
  if (!m || !d) return null;
  const id = typeof d.id === "string" || typeof d.id === "number" ? String(d.id) : "";
  const title = typeof r.value === "string" ? r.value.trim() : "";
  const path = typeof d.url === "string" ? d.url : "";
  if (!id || !title || !/^\/p\/[^/?#]+$/.test(path)) return null;

  const sizes: SizeVariant[] = [];
  const live: { price: number; was: number | null }[] = [];
  const seen = new Set<string>();
  for (const v of Array.isArray(r.variations) ? r.variations : []) {
    const vd = v?.data;
    const label = typeof vd?.label === "string" ? vd.label.trim() : "";
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const on = vd.onlineAvailable === true;
    sizes.push({ label, availability: on ? "in_stock" : "out_of_stock" });
    const p = cents(vd.price);
    if (on && p) live.push({ price: p, was: cents(vd.formerPrice) });
  }
  // Sizes can be priced apart: quote the cheapest sellable one, with ITS struck price.
  live.sort((a, b) => a.price - b.price);
  const price = live[0]?.price ?? cents(d.price);
  const listPrice = live[0] ? live[0].was : cents(d.formerPrice);
  if (!price || !listPrice || listPrice <= price) return null;

  const md = d.metadata ?? {};
  const maker = typeof md.brand === "string" && md.brand.trim() ? md.brand.trim() : null;
  // `productCategoriesV2` runs most specific first ("Wide & Loose Fit Jeans Damen"); `pages-names` is an unordered set.
  const cats: any[] = Array.isArray(md.productCategoriesV2) ? md.productCategoriesV2 : [];
  const category = cats.map((c) => (typeof c?.name === "string" ? c.name.trim() : "")).find(Boolean) ?? null;
  const imgs = md.images && typeof md.images === "object" ? Object.values(md.images).map((i: any) => photo(i?.url)) : [];
  const imageUrl = photo(d.image_url) ?? imgs.find(Boolean) ?? null;
  const siblings = Array.isArray(md.siblingDispos) ? md.siblingDispos.length : 0;
  const group = typeof md.dispoGroupId === "string" && md.dispoGroupId ? md.dispoGroupId : null;

  return {
    brand: "peekcloppenburg",
    country,
    externalId: id,
    name: maker ? `${maker} ${title}` : title,
    url: `${m.site}${path}`,
    imageUrl,
    images: cleanGallery(imgs, imageUrl),
    price,
    listPrice,
    currency: m.currency,
    inStock: sizes.length ? sizes.some((s) => s.availability === "in_stock") : d.onlineAvailable === true,
    category,
    maker,
    gender,
    variants: sizes.length ? { colors: [], sizes } : null,
    groupKey: group && siblings > 1 ? `puc-${group}` : null,
    colorName: maker ? colourFromSlug(path, maker, title, id) : null,
  };
}

export async function listPeekCloppenburg(
  country: CountryCode,
  fetchJson: (u: string) => Promise<any> = (u) => getJson(u, { country, timeoutMs: 60_000 }),
): Promise<ProductRecord[]> {
  const m = PUC_MARKETS[country];
  if (!m) throw new Error(`peekcloppenburg: no market ${country}`);
  const byId = new Map<string, ProductRecord>();
  let first = true;
  for (const tree of PUC_TREES) {
    for (let page = 1; page <= tree.pages; page++) {
      let res: any;
      try {
        res = await fetchJson(browseUrl(m.key, tree.group, page));
      } catch (e) {
        if (first) throw e;
        break;
      }
      const results: any[] = Array.isArray(res?.response?.results) ? res.response.results : [];
      if (first && !results.length) throw new Error(`peekcloppenburg/${country}: empty first page`);
      first = false;
      for (const r of results) {
        const rec = toRecord(r, tree.gender, country);
        if (rec && !byId.has(rec.externalId)) byId.set(rec.externalId, rec);
      }
      if (results.length < PER_PAGE) break;
      await sleep(PAUSE_MS);
    }
  }
  const rows = [...byId.values()];
  return [...rows.filter((r) => r.inStock), ...rows.filter((r) => !r.inStock)].slice(0, CAP);
}
