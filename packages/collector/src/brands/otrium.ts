/**
 * Otrium — the designer outlet (NL, DE, FR, BE, IT, ES; all EUR), 2026-11-10.
 *
 * The website (otrium.nl / .de / .fr / .be / .it / .es) sits behind a Cloudflare
 * challenge for home IPs, but its catalogue is a Constructor.io index, one per
 * country, read here directly from `ac.cnstrc.com` — outside the wall, no cookie,
 * no login. The index keys are public: every page ships them in
 * `pageProps.appConfig.constructorIndexKey` (read from a GitHub runner through
 * `/_next/data/<build>/<gender>.json`, probe run 42802174828; the same run got
 * the browse call below 200 from the runner).
 *
 *   GET ac.cnstrc.com/browse/genders/{women|men}?key=…&section=Products
 *       &num_results_per_page=100&page=N&sort_by=discount_date&sort_order=descending
 *       &filters[is_deleted]=False&fmt_options[fields]=…
 *
 * `fmt_options[fields]` keeps a page at ~0.55 MB instead of ~0.95 MB. Constructor
 * serves at most 10,000 results per query; the newest markdowns come first.
 *
 * Otrium is an outlet: EVERY product carries `regular_price` (the brand's
 * original price, shown struck through on the site) above `price`. Rows whose
 * `gate.level` is not `non_gated` are members-only prices (hidden until login on
 * the site) and are skipped — in Germany that is about half of the listing.
 * `container_sizes` are the sizes that can be bought now. Measured 2026-11-10:
 * women 41,075 products in NL; 100 of 100 on a page reduced, 0 gated (NL women).
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";

export interface OtriumMarket {
  origin: string;
  key: string;
}
export const OTRIUM_MARKETS: Partial<Record<CountryCode, OtriumMarket>> = {
  NL: { origin: "https://www.otrium.nl", key: "key_voAIVsXIPiwJE2Y3" },
  DE: { origin: "https://www.otrium.de", key: "key_0Tyn9R87YO4PpekE" },
  FR: { origin: "https://www.otrium.fr", key: "key_3uTFJMG8r4SIIAKf" },
  BE: { origin: "https://www.otrium.be", key: "key_5W9S3Se3zuK7Hwi9" },
  IT: { origin: "https://www.otrium.it", key: "key_vLfYjWMFvShcpcD8" },
  ES: { origin: "https://www.otrium.es", key: "key_1Iog61qj8cuAhmNs" },
};
/** Women first and most; men a minority. 100 a page. */
export const OTRIUM_TREES: { group: "women" | "men"; gender: "kadin" | "erkek"; pages: number }[] = [
  { group: "women", gender: "kadin", pages: 20 },
  { group: "men", gender: "erkek", pages: 6 },
];
const FIELDS = ["id", "slug", "price", "regular_price", "image", "brand_name", "gate", "genders", "currency", "available_sizes_label", "container_sizes", "stock_amount", "category_page_id", "color", "is_deleted"];
const PER_PAGE = 100;
const CAP = 2500;
const PAUSE_MS = Number(process.env.OTRIUM_PAUSE_MS ?? 300);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function browseUrl(key: string, group: string, page: number): string {
  const fields = FIELDS.map((f) => `fmt_options%5Bfields%5D=${f}`).join("&");
  return `https://ac.cnstrc.com/browse/genders/${group}?key=${key}&section=Products&num_results_per_page=${PER_PAGE}&page=${page}&sort_by=discount_date&sort_order=descending&filters%5Bis_deleted%5D=False&${fields}`;
}

/** "Dames > Kleding > Rokken > Leren rokken" from the page ids → "Leren rokken". */
export function categoryOf(paths: unknown, brand: string): string | null {
  if (!Array.isArray(paths)) return null;
  let best: string[] = [];
  for (const p of paths) {
    const parts = String(p).split(" > ").map((s) => s.trim());
    if (parts.length < 2 || parts[parts.length - 1] === brand) continue;
    if (parts.length > best.length) best = parts;
  }
  return best.length ? best[best.length - 1] : null;
}

/** One Constructor result → a record, or null (gated, deleted, not reduced). Pure. */
export function mapOtrium(result: any, market: OtriumMarket, country: CountryCode, gender: ProductRecord["gender"]): ProductRecord | null {
  const d = result?.data;
  if (!d?.id || !d.slug || d.is_deleted === true) return null;
  if (d.gate?.level !== "non_gated") return null;
  if (d.currency?.code !== "EUR") return null;
  const price = Math.round(Number(d.price) * 100);
  const was = Math.round(Number(d.regular_price) * 100);
  if (!(price > 0) || !(was > price)) return null;
  const maker = String(d.brand_name ?? "").trim();
  const title = String(result.value ?? "").trim();
  if (!maker || !title) return null;
  const sizes: string[] = (Array.isArray(d.container_sizes) ? d.container_sizes : [])
    .map((s: any) => String(s?.name ?? "").trim())
    .filter(Boolean);
  const image = typeof d.image === "string" && d.image.startsWith("https://") ? d.image : null;
  const genders: string[] = Array.isArray(d.genders) ? d.genders : [];
  return {
    brand: "otrium",
    country,
    externalId: String(d.id),
    name: `${maker} ${title}`,
    url: `${market.origin}/product/${d.slug}`,
    imageUrl: image,
    images: cleanGallery([image], image),
    price,
    listPrice: was,
    currency: "EUR",
    inStock: Number(d.stock_amount) > 0,
    maker,
    category: categoryOf(d.category_page_id, maker),
    gender: genders.includes("kids") ? "cocuk" : gender,
    variants: sizes.length ? { colors: [], sizes: sizes.map((label) => ({ label, availability: "in_stock" as const })) } : null,
    sizesInStockOnly: sizes.length ? true : undefined,
    colorName: typeof d.color?.name === "string" ? d.color.name : null,
  };
}

export async function listOtrium(
  country: CountryCode,
  fetchJson: (u: string) => Promise<any> = (u) => getJson(u, { country, timeoutMs: 45_000 }),
): Promise<ProductRecord[]> {
  const market = OTRIUM_MARKETS[country];
  if (!market) return [];
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  let seen = 0;
  for (const tree of OTRIUM_TREES) {
    for (let page = 1; page <= tree.pages; page++) {
      if (calls++) await sleep(PAUSE_MS);
      let results: any[];
      try {
        results = (await fetchJson(browseUrl(market.key, tree.group, page)))?.response?.results ?? [];
      } catch (err) {
        if (calls === 1) throw err;
        break;
      }
      if (calls === 1 && results.length === 0) throw new Error("otrium: empty first page (index key changed?)");
      seen += results.length;
      for (const r of results) {
        const rec = mapOtrium(r, market, country, tree.gender);
        if (rec && !byId.has(rec.externalId)) byId.set(rec.externalId, rec);
      }
      if (results.length < PER_PAGE) break;
    }
  }
  const all = [...byId.values()];
  const out = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
  console.log(`otrium/${country}: ${calls} pages, ${seen} seen, ${all.length} open + reduced, kept ${out.length}`);
  return out;
}
