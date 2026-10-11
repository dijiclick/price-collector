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
 * Sources, in order, within a ~55-page budget: İNDİRİMLİ ÜRÜNLER (c=70),
 * SEZON SONU İNDİRİMLERİ (c=261), SERİ SONU İNDİRİMLERİ (c=209, 1.5k items,
 * only part of them reduced — ~300 deals per run on 2026-10-11). Only reduced
 * docs are kept.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "haydigiy";
export const SITE = "https://haydigiy.com";
const API = "https://connect.haydigiy.com/api/search-products";
export const SALE_CATEGORIES = [70, 261, 209];
const MAX_PAGES = Number(process.env.HAYDIGIY_MAX_PAGES ?? 55);
const MAX_PRODUCTS = Number(process.env.HAYDIGIY_MAX_PRODUCTS ?? 1500);
const PAUSE_MS = 400;
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
  for (const c of SALE_CATEGORIES) {
    for (let page = 1; requests < MAX_PAGES; page++) {
      if (requests > 0) await sleep(PAUSE_MS);
      requests++;
      const j = await getJson<any>(`${API}?page=${page}&c=${c}`, { retries: 1 }).catch((e) => {
        if (requests === 1) throw e;
        return null;
      });
      const rows: any[] = j?.data ?? [];
      for (const p of rows) {
        const r = mapHaydigiy(p);
        if (r && r.listPrice != null && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (!rows.length || page >= Number(j?.last_page ?? 0)) break;
    }
  }
  if (process.env.HAYDIGIY_DEBUG) console.error(`haydigiy: ${requests} requests, ${byId.size} deals`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, MAX_PRODUCTS);
}
