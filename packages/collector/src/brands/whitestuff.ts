/**
 * White Stuff (whitestuff.com) — United Kingdom in GBP and its EU store
 * (whitestuff.com/eu, EUR, the storefront Ireland is served from). Added
 * 2026-11-10.
 *
 * The Nuxt storefront (BigCommerce behind it) lists products from
 * Constructor.io; the public key per storefront sits in the site's Constructor
 * bundle (cnstrc.com/js/cust/white-stuff_*.js: `/us` and `/global`, `/eu`,
 * default = UK). `ac.cnstrc.com/browse/collection_id/<womens-sale|mens-sale>`
 * answers a GitHub runner without a wall (probe run 42803687149).
 *
 * A result is one style in one colour: `data.price` is the price charged now
 * (the product page's own JSON-LD carries the same figure) and
 * `data.original_price` the struck one. No sizes or stock in the feed — the
 * sale listing only holds orderable styles.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

interface WsMarket { key: string; prefix: string }

export const WHITESTUFF_MARKETS: Partial<Record<CountryCode, WsMarket>> = {
  GB: { key: "key_dFTyRs3aP0olfv1g", prefix: "" },
  IE: { key: "key_9mTc0OflGwRLw1xx", prefix: "/eu" },
};

const SITE = "https://www.whitestuff.com";
const SECTIONS: [collection: string, gender: ProductRecord["gender"], cap: number][] = [
  ["womens-sale", "kadin", 1100],
  ["mens-sale", "erkek", 400],
];
const PER_PAGE = 100;
const PAUSE_MS = Number(process.env.WHITESTUFF_PAUSE_MS ?? 700);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase()) : s);

export function whitestuffUrl(m: WsMarket, collection: string, page: number): string {
  const q = new URLSearchParams({ key: m.key, num_results_per_page: String(PER_PAGE), page: String(page), c: "ciojs-client-2.35.2", i: "modadrop", s: "1" });
  return `https://ac.cnstrc.com/browse/collection_id/${collection}?${q}`;
}

/** One Constructor result → record, or null. Pure. */
export function mapWhiteStuff(r: any, country: CountryCode, gender: ProductRecord["gender"]): ProductRecord | null {
  const m = WHITESTUFF_MARKETS[country];
  const d = r?.data;
  const price = Number(d?.price);
  const was = Number(d?.original_price);
  if (!m || !d?.id || !r?.value || !d?.url || !Number.isFinite(price) || price <= 0) return null;
  const img = typeof d.image_url === "string" && d.image_url ? `${d.image_url.split("?")[0]}?w=900&fmt=auto` : null;
  const group = (Array.isArray(d.group_ids) ? d.group_ids : []).map(String).find((g: string) => g.includes("/"));
  const cat = group ? titleCase(group.split("/").pop()!.replace(/-/g, " ").toUpperCase()) : null;
  const colour = typeof d.colour === "string" ? titleCase(d.colour.replace(/_/g, " ")) : null;
  return {
    brand: "whitestuff",
    country,
    externalId: String(d.id),
    name: titleCase(String(r.value).replace(/\s+/g, " ").trim()),
    url: `${SITE}${m.prefix}${d.url}`,
    imageUrl: img,
    images: cleanGallery([], img),
    price: toMinor(price),
    listPrice: Number.isFinite(was) && was > price ? toMinor(was) : null,
    currency: COUNTRIES[country].currency,
    inStock: true,
    category: cat,
    gender,
    variants: null,
    groupKey: d.sku ? `whitestuff:${d.sku}` : null,
    colorName: colour,
  };
}

export async function listWhiteStuff(country: CountryCode): Promise<ProductRecord[]> {
  const m = WHITESTUFF_MARKETS[country];
  if (!m) return [];
  const out: ProductRecord[] = [];
  const ids = new Set<string>();
  let calls = 0;
  for (const [collection, gender, cap] of SECTIONS) {
    let taken = 0;
    pages: for (let page = 1; page <= Math.ceil(cap / PER_PAGE) + 1; page++) {
      if (calls++ > 0) await sleep(PAUSE_MS);
      const data = await getJson<any>(whitestuffUrl(m, collection, page), { country });
      const results: any[] = data?.response?.results ?? [];
      for (const r of results) {
        const rec = mapWhiteStuff(r, country, gender);
        if (!rec || rec.listPrice == null || ids.has(rec.externalId)) continue;
        ids.add(rec.externalId);
        out.push(rec);
        if (++taken >= cap) break pages;
      }
      if (results.length < PER_PAGE) break;
    }
  }
  if (!out.length) throw new Error(`whitestuff/${country}: Constructor returned no reduced rows`);
  return out;
}
