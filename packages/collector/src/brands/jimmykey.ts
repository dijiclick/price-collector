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
 * `search_query=*` matches the whole catalogue, but PersonaClick returns ONE
 * colourway per model (`group_id`), and which one depends on the sort: 1,412
 * rows on 2026-10-19 while the `ColorID` facet counted 1,879 colourways.
 *
 * FULL CATALOGUE (2026-10-19): the walk reads the `ColorID` facet off the
 * first page and then asks for each colour on its own
 * (`filters={"ColorID":["108"]}`, price-sorted): within one colour a model has
 * one colourway, so nothing is folded away — 1,879 of 1,879 in 83 requests,
 * every row of the plain walk among them. Reduced rows (`oldprice_full >
 * price_full`) keep their strike price, the rest are full-price rows
 * (`listPrice` null). The collector delists whatever a run does not return, so
 * a failed page, a truncated facet or a walk that falls short of the facet's
 * count fails the run instead of handing back part of the catalogue. Answers a
 * GitHub runner with 200 (probe run 39124308073).
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
/** Requests per run: 83 today (80 colours); headroom for the catalogue to double. */
const MAX_REQUESTS = Number(process.env.JIMMYKEY_MAX_REQUESTS ?? 250);
const CAP = Number(process.env.JIMMYKEY_MAX_PRODUCTS ?? 6000);
const PAUSE_MS = Number(process.env.JIMMYKEY_PAUSE_MS ?? 600);
/** Rows the walk may fall short of the facet count (stock moving mid-walk). */
const SHORTFALL = 0.01;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const brand = "jimmykey";

/** The whole catalogue, or one `ColorID` of it (price-sorted, a stable order to page). */
export const jimmykeyListUrl = (page: number, colorId?: string) =>
  `https://api.personaclick.com/search?shop_id=${SHOP_ID}&type=full_search&search_query=*&limit=${PAGE_SIZE}&page=${page}` +
  (colorId != null ? `&filters=${encodeURIComponent(JSON.stringify({ ColorID: [colorId] }))}&sort_by=price&order=asc` : "");

/** The `ColorID` facet: colour id → colourways, and the facet's own total. */
export function colorFacet(d: any): { values: [string, number][]; count: number } | null {
  const f = d?.filters?.ColorID;
  if (!f || typeof f.values !== "object") return null;
  return { values: Object.entries(f.values).map(([k, v]) => [k, Number(v)]), count: Number(f.count) };
}

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
  let requests = 0;
  // A partial walk would let the delist sweep mark the unseen rows sold out:
  // every failure below fails the run.
  const get = async (page: number, colorId?: string) => {
    if (requests >= MAX_REQUESTS) throw new Error(`jimmykey: over ${MAX_REQUESTS} requests — raise JIMMYKEY_MAX_REQUESTS`);
    if (requests > 0) await sleep(PAUSE_MS);
    requests++;
    const d = await getJson<any>(jimmykeyListUrl(page, colorId), { retries: 2 }).catch(() => null);
    if (!d || !Array.isArray(d.products)) throw new Error(`jimmykey: PersonaClick search refused (colour ${colorId ?? "all"}, page ${page})`);
    for (const p of d.products) {
      const r = mapJimmyKey(p);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    return d;
  };
  const facet = colorFacet(await get(1));
  const sum = facet?.values.reduce((a, [, n]) => a + n, 0) ?? 0;
  // A facet list cut short (PersonaClick caps long ones) would hide whole colours.
  if (!facet || !sum || sum !== facet.count) throw new Error(`jimmykey: ColorID facet unusable (${sum} of ${facet?.count})`);
  for (const [colorId] of facet.values) {
    for (let page = 1; ; page++) {
      const d = await get(page, colorId);
      if (d.products.length < PAGE_SIZE) break;
    }
  }
  if (byId.size < facet.count * (1 - SHORTFALL)) throw new Error(`jimmykey: ${byId.size} of ${facet.count} colourways — partial walk refused`);
  if (process.env.JIMMYKEY_DEBUG) console.error(`jimmykey: ${requests} requests, ${byId.size} of ${facet.count} colourways`);
  const all = [...byId.values()];
  // A cap that cut rows would let the delist sweep mark them sold out: refuse instead.
  if (all.length > CAP) throw new Error(`jimmykey: ${all.length} products, over the cap of ${CAP}`);
  return [...all.filter((r) => r.listPrice != null), ...all.filter((r) => r.listPrice == null)];
}
