/**
 * Myer (myer.com.au) — Australia's biggest department store. Multi-brand:
 * Sportscraft, Cue, Oroton, Guess, Tommy Hilfiger, Calvin Klein, Levi's,
 * Estée Lauder, MAC… Measured 2026-11-10:
 *
 * - Product lists come from the site's Constructor.io index. The key is in the
 *   site's own HTML (`key_AuSCxHCycrDpMxRc`); ac.cnstrc.com is not behind the
 *   site's wall and answers a GitHub runner (probe run in the commit message).
 * - `browse/group_id/<id>` walks one category. The site's own Sale tree is
 *   group 167153 (61,755 of 177,789 products); its departments are walked one
 *   by one so Home, Toys, Tech and Kids are left out and each department has a
 *   share of the cap.
 * - Each hit carries `price_from_au` (charged) and `list_price_from_au` (the
 *   struck-through price), `brand` (the maker), `outofstock`, and a gallery.
 *   Rows are kept only when list > price. `sale_type` "MYER one Member Price"
 *   rows are member-only prices and are dropped; so are gift sets, whose "was"
 *   is the value of the parts.
 * - `variations_map` (Constructor's own aggregation) returns stock per size in
 *   the same request, so sizes need no detail call.
 * - Constructor answers at most 10,000 results per query; the walk stops far
 *   below that.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "myer";
const KEY = "key_AuSCxHCycrDpMxRc";
const PER_PAGE = 200;
const PAUSE_MS = Number(process.env.MYER_PAUSE_MS ?? 700);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The site's sale departments (children of "All Sale", group 1156166) and each one's share of the feed. */
export const MYER_GROUPS: { id: string; name: string; gender: ProductRecord["gender"]; cap: number }[] = [
  { id: "974553", name: "Women's Sale / Clothing", gender: "kadin", cap: 800 },
  { id: "974555", name: "Women's Sale / Shoes", gender: "kadin", cap: 300 },
  { id: "974556", name: "Women's Sale / Bags & Wallets", gender: "kadin", cap: 250 },
  { id: "974552", name: "Women's Sale / Accessories & Watches", gender: "kadin", cap: 150 },
  { id: "974554", name: "Women's Sale / Lingerie & Sleepwear", gender: "kadin", cap: 150 },
  { id: "1099568", name: "Women's Sale / Activewear", gender: "kadin", cap: 100 },
  { id: "988141", name: "Women's Sale / Swimwear", gender: "kadin", cap: 100 },
  { id: "988277", name: "Beauty Sale", gender: null, cap: 300 },
  { id: "968152", name: "Men's Sale / Clothing", gender: "erkek", cap: 250 },
  { id: "968153", name: "Men's Sale / Shoes", gender: "erkek", cap: 100 },
];

const VARIATIONS = JSON.stringify({
  group_by: [{ name: "size", field: "data.size_value" }],
  values: { stock: { aggregation: "max", field: "data.stock" } },
  dtype: "object",
});

export function myerUrl(groupId: string, page: number): string {
  const q = new URLSearchParams({
    key: KEY,
    num_results_per_page: String(PER_PAGE),
    page: String(page),
    c: "ciojs-client-2.35.2",
    variations_map: VARIATIONS,
  });
  return `https://ac.cnstrc.com/browse/group_id/${groupId}?${q}`;
}

const num = (v: unknown): number => (typeof v === "number" ? v : parseFloat(String(v ?? "")));

/** The hit's own department wins over the shelf it was found on (a women's shoe on the men's shelf). */
function genderOf(department: string, shelf: ProductRecord["gender"]): ProductRecord["gender"] {
  if (/^kids?$/i.test(department)) return "cocuk";
  if (/^womens$/i.test(department)) return "kadin";
  if (/^mens$/i.test(department)) return "erkek";
  return shelf;
}

/** Map one Constructor result. Pure; null unless it is a real markdown. */
export function mapMyer(x: any, gender: ProductRecord["gender"]): ProductRecord | null {
  const d = x?.data;
  const name = String(x?.value ?? "").replace(/\s+/g, " ").trim();
  if (!d?.id || !name || typeof d.url !== "string" || !/^https:\/\/www\.myer\.com\.au\//.test(d.url)) return null;
  if (/myer one|member/i.test(String(d.sale_type ?? "")) || d.is_gift_set === true) return null;
  // The beauty and bag shelves also list candles, appliances and suitcases.
  if (/^home$/i.test(String(d.department ?? "")) || /candles|home fragrance|appliance/i.test(String(d.category ?? ""))) return null;
  const price = num(d.price_from_au);
  const list = num(d.list_price_from_au);
  if (!(price > 0) || !(list > price)) return null;
  // A price range across sizes: keep it only when the dearest size is reduced too.
  const priceTo = num(d.price_to_au);
  const listTo = num(d.list_price_to_au);
  if (priceTo > price && !(listTo > priceTo)) return null;
  const imgs: string[] = (Array.isArray(d.media) ? d.media : [])
    .slice()
    .sort((a: any, b: any) => Number(a?.sequence ?? 0) - Number(b?.sequence ?? 0))
    .map((m: any) => (typeof m?.base_url === "string" ? m.base_url.replace("{{size}}", "720x928") : null))
    .filter(Boolean);
  const lead = imgs[0] ?? (typeof d.image_url === "string" ? d.image_url : null);
  const vm = x?.variations_map && typeof x.variations_map === "object" ? x.variations_map : {};
  const sizes: SizeVariant[] = Object.entries(vm)
    .filter(([label]) => label && !/^(one size|os|n\/a|null|undefined)$/i.test(label))
    .map(([label, v]: [string, any]) => ({ label, availability: Number(v?.stock) > 0 ? ("in_stock" as const) : ("out_of_stock" as const) }));
  const colour = typeof d.colour === "string" && d.colour.trim() ? d.colour.trim() : null;
  return {
    brand,
    country: "AU",
    externalId: String(d.id),
    name,
    url: d.url,
    imageUrl: lead,
    images: cleanGallery(imgs, lead),
    price: toMinor(price),
    listPrice: toMinor(list),
    currency: "AUD",
    inStock: d.outofstock !== true && d.is_buyable !== false,
    category: typeof d.product_type === "string" && d.product_type.trim() ? d.product_type.trim() : null,
    maker: typeof d.brand === "string" && d.brand.trim() ? d.brand.trim() : null,
    gender: genderOf(String(d.department ?? ""), gender),
    variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: null,
    colorName: colour,
  };
}

export async function listMyer(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "AU") return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const g of MYER_GROUPS) {
    let kept = 0;
    const pages = Math.ceil(g.cap / PER_PAGE) + 1;
    for (let page = 1; page <= pages && kept < g.cap; page++) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      const d = await getJson<any>(myerUrl(g.id, page), { country, retries: 2, timeoutMs: 40_000 });
      const rows: any[] = d?.response?.results ?? [];
      if (!rows.length && page === 1 && byId.size === 0 && g === MYER_GROUPS[0]) throw new Error("myer/AU: the sale browse returned no products");
      for (const x of rows) {
        if (kept >= g.cap) break;
        const r = mapMyer(x, g.gender);
        if (!r || byId.has(r.externalId)) continue;
        byId.set(r.externalId, r);
        kept++;
      }
      if (rows.length < PER_PAGE) break;
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)];
}

export const listProducts = listMyer;
