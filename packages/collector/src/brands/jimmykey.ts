import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

/**
 * Jimmy Key TR (women's wear) through the site's PersonaClick search feed —
 * the route Skechers TR uses (skechers.ts). Built 2026-10-18.
 *
 * jimmykey.com is a server-rendered .NET shop with no listing JSON; its search
 * and category tracking run on PersonaClick, keyed by the public shop id in the
 * page's `personaclick("init", …)` call:
 *
 *   https://api.personaclick.com/search?shop_id=<id>&type=full_search
 *     &search_query=*&limit=200&page=N
 *
 * `search_query=*` is the whole catalogue (1,326 colourways, 7 pages of 200,
 * 2026-10-18), and the walk keeps the reduced ones (`oldprice_full >
 * price_full`; ~750 of them, most in the "%50'ye Varan İndirim" category 96).
 * Answers a GitHub runner with 200 (probe run 39124308073).
 *
 * One row per colourway: `id` is `<model>-<colourId>` (`28786-108`), matching
 * the PDP url's last segment (`…_5ww105284/siyah/108`), and `group_id` is the
 * model. SIZES: `fashion_original_sizes` lists only the sizes in stock now (the
 * PDP of 28786-108 offers S,M,L,XL; the feed says ["S"]), so `variants` holds
 * those as in-stock — enough for the card, not for a per-size restock.
 */
export const SHOP_ID = "a2eecbc9a7b0414937fdb654375362";
const SITE = "https://www.jimmykey.com";
const PAGE_SIZE = 200;
const MAX_PAGES = Number(process.env.JIMMYKEY_MAX_PAGES ?? 15);
const CAP = Number(process.env.JIMMYKEY_MAX_PRODUCTS ?? 1500);
const PAUSE_MS = Number(process.env.JIMMYKEY_PAUSE_MS ?? 800);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const brand = "jimmykey";

export const jimmykeyListUrl = (page: number) =>
  `https://api.personaclick.com/search?shop_id=${SHOP_ID}&type=full_search&search_query=*&limit=${PAGE_SIZE}&page=${page}`;

const param = (p: any, key: string): string[] =>
  ((p?.params ?? []).find((x: any) => x?.key === key)?.values ?? []).map(String);

/** Category trees that are merchandising, not product types. */
const NOT_A_TYPE = /indirim|yeniler|koleksiyon|kampanya|outlet/;
/** Lower-case with Turkish dotted/dotless I folded (`/i` alone misses "İndirim"). */
const fold = (s: string) => s.replace(/[İI]/g, "i").replace(/ı/g, "i").toLowerCase();

/** The deepest product-type category ("Etek - Midi Etek" → "Midi Etek"). */
export function jimmykeyCategory(cats: any[]): string | null {
  const byId = new Map<string, any>((cats ?? []).map((c) => [String(c?.id), c]));
  const root = (c: any) => {
    let cur = c;
    for (let i = 0; i < 6 && cur?.parent_id && byId.has(String(cur.parent_id)); i++) cur = byId.get(String(cur.parent_id));
    return cur;
  };
  const typed = (cats ?? []).filter((c) => c?.name && !NOT_A_TYPE.test(fold(String(root(c)?.name ?? ""))));
  const leaf = typed.sort((a, b) => Number(b.level) - Number(a.level))[0];
  return leaf ? String(leaf.name).split(" - ").pop()!.trim() : null;
}

/** Map one PersonaClick product. Pure. */
export function mapJimmyKey(p: any): ProductRecord | null {
  const price = Number(p?.price_full ?? p?.price);
  const old = Number(p?.oldprice_full ?? p?.oldprice);
  if (!p?.id || !p?.name || typeof p?.url !== "string" || !Number.isFinite(price) || price <= 0) return null;
  const url = p.url.split("?")[0];
  if (!url.startsWith(SITE)) return null;
  const img = typeof p.image_url === "string" ? p.image_url : p.image_url_resized?.original ?? null;
  const gender: ProductRecord["gender"] =
    p.fashion_feature === "child" ? "cocuk" : p.fashion_gender === "m" ? "erkek" : "kadin";
  const sizes: string[] = Array.isArray(p.fashion_original_sizes) && p.fashion_original_sizes.length
    ? p.fashion_original_sizes.map(String)
    : param(p, "beden");
  const colour = param(p, "ColorGlobalName")[0] ?? null;
  return {
    brand,
    country: "TR",
    externalId: String(p.id),
    name: String(p.name).trim(),
    url,
    imageUrl: img,
    images: cleanGallery([], img),
    price: toMinor(price),
    listPrice: Number.isFinite(old) && old > price ? toMinor(old) : null,
    currency: "TRY",
    inStock: true,
    category: jimmykeyCategory(p.categories ?? []),
    gender,
    variants: sizes.length
      ? { colors: colour ? [colour] : [], sizes: [...new Set(sizes)].map((label) => ({ label, availability: "in_stock" as const })) }
      : null,
    groupKey: p.group_id ? `jimmykey:${p.group_id}` : null,
    colorName: colour,
  };
}

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (country !== "TR") return [];
  const byId = new Map<string, ProductRecord>();
  let pages = MAX_PAGES;
  for (let page = 1; page <= pages && byId.size < CAP; page++) {
    if (page > 1) await sleep(PAUSE_MS);
    const d = await getJson<any>(jimmykeyListUrl(page), { retries: 2 }).catch(() => null);
    if (!d) {
      if (page === 1) throw new Error("jimmykey: PersonaClick search refused");
      break;
    }
    const rows: any[] = Array.isArray(d.products) ? d.products : [];
    const total = Number(d.products_total);
    if (Number.isFinite(total) && total > 0) pages = Math.min(MAX_PAGES, Math.ceil(total / PAGE_SIZE));
    for (const p of rows) {
      const r = mapJimmyKey(p);
      if (r && r.listPrice != null && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return [...byId.values()].slice(0, CAP);
}
