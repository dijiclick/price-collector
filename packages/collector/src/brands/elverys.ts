/**
 * Intersport Elverys (elverys.ie, Ireland, EUR) — a Shopify store
 * (`intersport-ie.myshopify.com`, `currency: "EUR"` in /meta.json). 2026-10-21.
 *
 * Route: the "Sale" collection's public `products.json` (250 a page). Every row
 * in it carries a `compare_at_price` above `price` — the struck price the shop
 * prints; the full catalogue's rows carry none (measured: 0 of 250 reduced on
 * a non-sale page), so this is a real markdown list, not a fake-everything shop.
 * Answers GitHub runners (probe run 39634392109).
 *
 * The collection also holds gym kit (dumbbells, treadmills, bikes, tents) and
 * supplements; those product types are dropped. Gender comes from the shop's
 * own `e:gender:` tag. Per-size stock is the variant `available` flag.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const SITE = "https://www.elverys.ie";
const PAGE = 250;
const MAX_PAGES = 14;
const CAP = 1500;
const PAUSE_MS = Number(process.env.ELVERYS_PAUSE_MS ?? 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Equipment, nutrition and anything else that is not something you wear. */
export const NOT_WEAR =
  /dumbbell|kettlebell|weight|treadmill|bike|rower|multi gym|bench|bar$|tent|sleeping bag|racket|ball$|hoop|board|darts|stick|goggle|supplement|nutrition|foam roller|boxing bag|shinguard|trampoline|table|net$|goal|mat$|bottle|equipment|pump|helmet|^accessories$|mini kit|cue|club|tee$|balls|watch/i;

export const pageUrl = (n: number) => `${SITE}/collections/sale/products.json?limit=${PAGE}&page=${n}`;

function genderOf(tags: string[]): ProductRecord["gender"] {
  const g = tags.find((t) => t.startsWith("e:gender:"))?.slice(9).toLowerCase();
  if (g === "mens") return "erkek";
  if (g === "womens") return "kadin";
  if (g === "kids" || g === "boys" || g === "girls" || g === "infants" || g === "juniors") return "cocuk";
  return null;
}

/** Map one products.json row. Pure; null unless a variant is struck through. */
export function mapElverys(p: any, country: CountryCode = "IE"): ProductRecord | null {
  if (!p?.id || !p?.title || !p?.handle) return null;
  const type = String(p.product_type ?? "").trim();
  if (type && NOT_WEAR.test(type)) return null;
  const vs: any[] = Array.isArray(p.variants) ? p.variants : [];
  const reduced = vs.filter((v) => Number(v.compare_at_price) > Number(v.price) && Number(v.price) > 0);
  if (!reduced.length) return null;
  // The card price: the cheapest reduced variant still for sale, else the cheapest reduced one.
  const pool = reduced.some((v) => v.available) ? reduced.filter((v) => v.available) : reduced;
  const lead = pool.reduce((a, b) => (Number(b.price) < Number(a.price) ? b : a));
  const price = Number(lead.price);
  const was = Number(lead.compare_at_price);

  const sizes: SizeVariant[] = [];
  for (const v of vs) {
    const label = String(v.option1 ?? v.title ?? "").trim();
    if (!label || /^default title$/i.test(label) || sizes.some((s) => s.label === label)) continue;
    sizes.push({ label, availability: v.available ? "in_stock" : "out_of_stock" });
  }
  const imgs: string[] = (p.images ?? []).map((i: any) => i?.src).filter((u: unknown): u is string => typeof u === "string");
  const tags: string[] = Array.isArray(p.tags) ? p.tags : String(p.tags ?? "").split(/,\s*/);
  const maker = typeof p.vendor === "string" && p.vendor.trim() ? p.vendor.trim() : null;
  return {
    brand: "elverys",
    country,
    externalId: String(p.id),
    name: String(p.title).replace(/\s+/g, " ").trim(),
    url: `${SITE}/products/${p.handle}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: "EUR",
    inStock: vs.some((v) => v.available),
    category: type || null,
    maker,
    gender: genderOf(tags),
    variants: sizes.length && !(sizes.length === 1 && /^(one size|os|o\/s)$/i.test(sizes[0].label)) ? { colors: [], sizes } : null,
  };
}

export async function listElverys(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "IE") return [];
  const byId = new Map<string, ProductRecord>();
  let inStock = 0;
  let n = 1;
  for (; n <= MAX_PAGES && inStock < CAP; n++) {
    if (n > 1) await sleep(PAUSE_MS);
    // Empty Accept-Language: Shopify then answers in the shop's own (Irish) market.
    const d = await getJson<any>(pageUrl(n), { country, headers: { "Accept-Language": "" } });
    if (!Array.isArray(d?.products)) throw new Error(`elverys/IE: page ${n} has no products array`);
    for (const p of d.products) {
      const r = mapElverys(p, country);
      if (!r || byId.has(r.externalId)) continue;
      byId.set(r.externalId, r);
      if (r.inStock) inStock++;
    }
    if (d.products.length < PAGE) break;
  }
  if (!byId.size) throw new Error("elverys/IE: sale collection returned no reduced products");
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
