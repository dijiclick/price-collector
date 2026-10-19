/**
 * HaydiGiy (haydigiy.com) — own Next.js storefront over an Elasticsearch-backed
 * JSON API (2026-10-11):
 *
 *   GET https://connect.haydigiy.com/api/search-products?page=N&c=<categoryId>
 *
 * which the category grid calls itself. 20 per page, fixed (per_page/limit/size
 * are ignored). No proxy: plain requests answer, and the GitHub-runner probe
 * reached the home page.
 *
 * Each doc is one colour with `price` (charged, string), `first_price` (the
 * strikethrough), `has_discount`, and `stock_variants[]` = per-size stock. A
 * shop-wide size discount can price ONE size lower still
 * (`discounted_variants`); the card price is kept, as the shop shows it.
 *
 * Until 2026-10-19 the walk read three sale categories (c=70, 261, 209) and
 * kept the reduced docs (~420).
 *
 * FULL CATALOGUE (2026-10-19): with no `c` the route lists the whole in-stock
 * shop — 5,656 docs in 284 pages of 20 (every one `has_stock`; ~490 reduced,
 * so the sale categories' deals are all among them). Two things matter:
 *   - ORDER. The default (popularity) order shifts while you page: 5,675 rows
 *     held only 5,419 distinct docs. `sorting=5` (newest first) returned
 *     5,656 rows, all distinct.
 *   - TIME. 284 pages at ~0.2 s + the 400 ms pause is ~3 min serial, too
 *     close to the 4-minute budget, so pages go two at a time (~1.5 min).
 * Reduced docs keep their strike price, the rest are full-price rows. A page
 * that fails after its retries fails the run: a partial walk would let the
 * delist sweep mark the rest sold out.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "haydigiy";
export const SITE = "https://haydigiy.com";
const API = "https://connect.haydigiy.com/api/search-products";
/** Newest first: the one order seen to page without repeats (see header). */
export const SORTING = 5;
/** 284 pages today; room for the shop to grow by half. */
const MAX_PAGES = Number(process.env.HAYDIGIY_MAX_PAGES ?? 430);
const MAX_PRODUCTS = Number(process.env.HAYDIGIY_MAX_PRODUCTS ?? 9000);
/** Pages in flight at once. */
const CONCURRENCY = 2;
const PAUSE_MS = 400;

export const pageUrl = (page: number) => `${API}?page=${page}&sorting=${SORTING}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fold = (s: string) =>
  s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").replace(/[Şş]/g, "s").replace(/[Ğğ]/g, "g").replace(/[Öö]/g, "o").replace(/[Üü]/g, "u").toLowerCase();

export function genderOf(p: any): ProductRecord["gender"] {
  const t = fold([p?.name ?? "", ...(p?.category_names ?? [])].join(" | "));
  if (/\b(cocuk|bebek|kiz cocuk)\b/.test(t)) return "cocuk";
  if (/\bkadin\b/.test(t)) return "kadin";
  if (/\berkek\b/.test(t)) return "erkek";
  return "kadin"; // a women's shop
}

/** "Kemerli Palazzo Kot Pantolon Yeşil - 3012931.1968." → without the stock code. */
export const cleanName = (s: string) => s.replace(/\s*-\s*[\d.]+\.?\s*$/, "").trim();

export function sizesOf(p: any): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const v of p?.stock_variants ?? []) {
    const label = String(v?.name ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const q = Number(v?.quantity ?? 0);
    out.push({ label, availability: q > 2 ? "in_stock" : q > 0 ? "low_on_stock" : "out_of_stock" });
  }
  if (out.length === 1 && /^(std|standart|tek beden|tek ebat)$/i.test(out[0].label)) return [];
  return out;
}

/** Map one search doc. Pure. */
export function mapHaydigiy(p: any): ProductRecord | null {
  const now = Number(p?.price);
  const was = Number(p?.first_price);
  if (!p?.id || !p?.name || !p?.slug || !Number.isFinite(now) || now <= 0) return null;
  const imgs: string[] = [...(p.medias ?? [])]
    .sort((a: any, b: any) => Number(a?.sort ?? 0) - Number(b?.sort ?? 0))
    .map((m: any) => m?.large ?? m?.medium)
    .filter((u: unknown): u is string => typeof u === "string");
  const first = typeof p.image === "string" ? p.image : imgs[0] ?? null;
  const sizes = sizesOf(p);
  const colour = typeof p.color_name === "string" && p.color_name.trim() ? p.color_name.trim() : null;
  const cats: string[] = (p.category_names ?? []).filter((c: string) => /^[A-ZÇĞİÖŞÜa-zçğıöşü]/.test(c) && /[a-zçğıöşü]/.test(c));
  return {
    brand,
    country: "TR",
    externalId: String(p.id),
    name: cleanName(String(p.name)),
    url: `${SITE}/${p.slug}`,
    imageUrl: first,
    images: cleanGallery(imgs, first),
    price: toMinor(now),
    listPrice: Number.isFinite(was) && was - now > 0.005 ? toMinor(was) : null,
    currency: "TRY",
    inStock: p.has_stock === true || Number(p.total_quantity ?? 0) > 0,
    // The specific sub-category ("Kadın Kot Pantolon"), not the promo buckets in capitals.
    category: cats.filter((c) => /\s/.test(c)).pop() ?? cats.pop() ?? null,
    gender: genderOf(p),
    variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: typeof p.group_id === "string" && p.group_id ? `haydigiy:${p.group_id}` : null,
    colorName: colour,
  };
}

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (country !== "TR") return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  let last = MAX_PAGES;
  let total = 0;
  for (let page = 1; page <= Math.min(last, MAX_PAGES); page += CONCURRENCY) {
    if (page > 1) await sleep(PAUSE_MS);
    const wave = Array.from({ length: CONCURRENCY }, (_, i) => page + i).filter((n) => n <= Math.min(last, MAX_PAGES));
    const answers = await Promise.all(
      wave.map((n) =>
        getJson<any>(pageUrl(n), { retries: 2 }).catch((e) => {
          throw new Error(`haydigiy: page ${n} failed (${e instanceof Error ? e.message : e})`);
        }),
      ),
    );
    requests += wave.length;
    let empty = false;
    for (const j of answers) {
      const rows: any[] = j?.data ?? [];
      if (!rows.length) empty = true;
      const t = Number(j?.total);
      if (Number.isFinite(t) && t > 0) total = t;
      const lp = Number(j?.last_page);
      if (Number.isFinite(lp) && lp > 0) last = lp;
      for (const p of rows) {
        const r = mapHaydigiy(p);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
    }
    // `last_page` comes from the hit count before grouping (5,697 hits, 5,656
    // docs), so the walk usually ends on an empty page. One far short of the
    // count is a glitch, not the end.
    if (empty) {
      if (byId.size < total * 0.95) throw new Error(`haydigiy: empty page after ${byId.size} of ${total} products`);
      break;
    }
    if (page + CONCURRENCY > MAX_PAGES && last > MAX_PAGES) throw new Error(`haydigiy: more than ${MAX_PAGES} pages — raise HAYDIGIY_MAX_PAGES`);
  }
  if (process.env.HAYDIGIY_DEBUG) console.error(`haydigiy: ${requests} requests, ${byId.size} products`);
  const all = [...byId.values()];
  // A cap that cut rows would let the delist sweep mark them sold out: refuse instead.
  if (all.length > MAX_PRODUCTS) throw new Error(`haydigiy: ${all.length} products, over the cap of ${MAX_PRODUCTS}`);
  const rank = (r: ProductRecord) => (r.listPrice != null ? 0 : 2) + (r.inStock ? 0 : 1);
  return all.sort((a, b) => rank(a) - rank(b));
}
