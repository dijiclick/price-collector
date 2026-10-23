/**
 * Bobbi Brown Turkey (www.bobbibrown.com.tr) — Estée Lauder Companies' own
 * Drupal/PerlGem stack, not Akinon like M·A·C TR (maccosmetics.ts). The whole
 * shop is ~120 products / ~700 shades, so the full catalogue is returned,
 * reduced and full price, like the other TR cosmetics brands.
 *
 * Akamai walls every page for a browser User-Agent that comes with curl's/Node's
 * TLS fingerprint (403 "Access Denied"), but lets `okhttp/4.12.0` through — from
 * this Mac and from GitHub's runners alike (probe 40021898171). Pages are 1-4 MB
 * and take ~10 s, so they are not read; the data comes from the site's own
 * JSON-RPC catalogue endpoint (`/rpc/jsonrpc.tmpl`, method `prodcat`), which
 * takes a list of category ids or product ids and the fields to return:
 *   1. the home page → every `/products/<id>/…` category in the menu,
 *   2. one call → each category's product ids,
 *   3. one call per 60 products → products and their SKUs.
 * Three to four requests a run.
 *
 * A row is one SKU: a shade (`SHADENAME`) or, for an unshaded product, a size.
 * Each SKU carries its OWN `PRICE` and strikethrough `PRICE2`, so there is no
 * min/max range to mistake for a markdown (the Sephora −%81 trap). A shade's
 * link is the product page with `?shade=<name>` — the same link the page's own
 * shade picker writes. `INVENTORY_STATUS` 4 is a retired SKU (often a duplicate
 * of a live shade, one priced 34 TL) and is dropped; 1 sells, 2 is temporarily
 * out, 7 sold out.
 *
 * Photos: `IMAGE_LARGE` is the responsive PNG every SKU has (698/701 load);
 * `IMAGE_L_V2` 404s for ~40% of SKUs. The host answers Apple's URLSession
 * (what the iOS image loader uses) and okhttp (Android) with 200; a plain curl
 * with a browser UA gets 403, which is the bot wall, not a missing photo.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson, getText } from "../http";
import { cleanListPrice, toMinor } from "../normalize";

export const brand = "bobbibrown";
export const SITE = "https://www.bobbibrown.com.tr";
const RPC = `${SITE}/rpc/jsonrpc.tmpl?dbgmethod=prodcat`;
const HEADERS = { "User-Agent": "okhttp/4.12.0" };
const CHUNK = 60;
const IMG_SIZE = "?width=900&height=900";

/** The menu's categories on 2026-10-24, used when the home page can't be read. */
export const FALLBACK_CATEGORIES = [
  2321, 2326, 2327, 2328, 2330, 2332, 2339, 2340, 2341, 2342, 2343, 2380, 13994, 13995, 13996, 14006, 14007,
  14008, 14013, 14015, 14017, 14018, 14019, 14020, 14021, 14022, 14358, 14460, 22040, 22330, 23824, 27014,
];
/** Merchandising lists (best sellers, new, special prices, minis): never a product's category. */
const PROMO_CATEGORIES = new Set(["CAT2380", "CAT14358", "CAT14460", "CAT22330", "CAT27014"]);

const PRODUCT_FIELDS = ["PRODUCT_ID", "PROD_RGN_NAME", "url", "IMAGE_LARGE", "skus"];
const SKU_FIELDS = [
  "SKU_ID", "PRICE", "PRICE2", "SHADENAME", "PRODUCT_SIZE", "INVENTORY_STATUS", "isOrderable", "IMAGE_LARGE", "UPC_CODE",
];

/** `/products/<id>/…` links in a page → category ids. */
export function categoryIdsOf(html: string): number[] {
  const ids = new Set<number>();
  for (const m of html.matchAll(/href="\/products\/(\d+)[/"]/g)) ids.add(Number(m[1]));
  return [...ids].sort((a, b) => a - b);
}

/** Form body of one `prodcat` JSON-RPC call. */
export function rpcBody(params: Record<string, unknown>): string {
  return "JSONRPC=" + encodeURIComponent(JSON.stringify([{ method: "prodcat", id: 1, params: [params] }]));
}

async function rpc(params: Record<string, unknown>): Promise<any> {
  const res = await getJson<any[]>(RPC, {
    method: "POST",
    timeoutMs: 90_000,
    headers: { ...HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
    body: rpcBody(params),
  });
  const value = res?.[0]?.result?.value;
  if (!value) throw new Error(`bobbibrown: prodcat returned no value (${JSON.stringify(res?.[0]?.error ?? null)})`);
  return value;
}

/** "Göz | Kalemi | Eyeliner" → "Göz Kalemi Eyeliner" (the menu breaks lines on `|`). */
const tidy = (s: unknown): string => String(s ?? "").replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ").trim();

/**
 * Product id → the most specific category it sits in: the smallest
 * non-merchandising category ("FONDÖTEN" over "Makyaj").
 */
export function categoryByProduct(categories: any[]): Map<string, string> {
  const best = new Map<string, { name: string; size: number }>();
  for (const c of categories ?? []) {
    const ps: any[] = Array.isArray(c?.products) ? c.products : [];
    const name = tidy(c?.CATEGORY_NAME);
    if (!name || PROMO_CATEGORIES.has(String(c?.CATEGORY_ID))) continue;
    for (const p of ps) {
      const id = String(p?.PRODUCT_ID ?? "");
      const cur = best.get(id);
      if (id && (!cur || ps.length < cur.size)) best.set(id, { name, size: ps.length });
    }
  }
  return new Map([...best].map(([id, v]) => [id, v.name]));
}

const absImg = (u: unknown): string | null =>
  typeof u === "string" && u.startsWith("/media/") ? `${SITE}${u.split("?")[0]}${IMG_SIZE}` : null;

/** Map one product to one row per live SKU. Pure. */
export function mapBobbiBrown(p: any, category: string | null = null): ProductRecord[] {
  const name = tidy(p?.PROD_RGN_NAME);
  const path = typeof p?.url === "string" && p.url.startsWith("/product/") ? p.url : null;
  if (!p?.PRODUCT_ID || !name || !path) return [];
  const skus: any[] = (Array.isArray(p.skus) ? p.skus : []).filter(
    (s) => s?.SKU_ID && [1, 2, 7].includes(Number(s.INVENTORY_STATUS)) && Number(s.PRICE) > 0,
  );
  const shaded = skus.some((s) => tidy(s.SHADENAME));
  const prodImgs = (Array.isArray(p.IMAGE_LARGE) ? p.IMAGE_LARGE : []).map(absImg);

  return skus.map((s): ProductRecord => {
    const shade = tidy(s.SHADENAME) || null;
    const size = tidy(s.PRODUCT_SIZE) || null;
    const inStock = Number(s.isOrderable) === 1 && Number(s.INVENTORY_STATUS) === 1;
    const price = toMinor(Number(s.PRICE));
    const imgs = (Array.isArray(s.IMAGE_LARGE) ? s.IMAGE_LARGE : []).map(absImg);
    const image = imgs.find(Boolean) ?? (shade ? null : prodImgs.find(Boolean)) ?? null;
    const upc = String(s.UPC_CODE ?? "").trim();
    const sizes: SizeVariant[] = [{ label: size ?? "ONE SIZE", availability: inStock ? "in_stock" : "out_of_stock" }];
    return {
      brand,
      country: "TR",
      externalId: String(s.SKU_ID),
      // An unshaded product's SKUs are its sizes (cleansing oil 30/100/200/400 ml): name them apart.
      name: !shaded && skus.length > 1 && size ? `${name} ${size}` : name,
      url: `${SITE}${path}${shade ? `?shade=${encodeURIComponent(String(s.SHADENAME).trim())}` : ""}`,
      imageUrl: image,
      images: cleanGallery(shade ? imgs : [...imgs, ...prodImgs], image),
      price,
      listPrice: s.PRICE2 == null ? null : cleanListPrice(price, toMinor(Number(s.PRICE2))),
      currency: "TRY",
      inStock,
      barcodes: /^\d{12,14}$/.test(upc) ? [upc] : null,
      category,
      gender: null,
      variants: { colors: shade ? [shade] : [], sizes },
      groupKey: skus.length > 1 ? String(p.PRODUCT_ID) : null,
      colorName: shade,
    };
  });
}

export async function listProducts(): Promise<ProductRecord[]> {
  let cats = FALLBACK_CATEGORIES;
  try {
    const found = categoryIdsOf(await getText(`${SITE}/`, { headers: HEADERS, timeoutMs: 60_000 }));
    if (found.length >= 10) cats = found;
  } catch (err) {
    console.warn(`bobbibrown: home page unreadable, using the saved category list (${(err as Error).message})`);
  }
  const { categories } = await rpc({
    categories: cats.map((id) => `CAT${id}`),
    category_fields: ["CATEGORY_ID", "CATEGORY_NAME", "products"],
    product_fields: ["PRODUCT_ID"],
  });
  const categoryOf = categoryByProduct(categories);
  const ids = [
    ...new Set((categories ?? []).flatMap((c: any) => (c?.products ?? []).map((p: any) => String(p?.PRODUCT_ID ?? "")))),
  ].filter(Boolean) as string[];
  if (!ids.length) throw new Error("bobbibrown: no products in any category");

  const out = new Map<string, ProductRecord>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { products } = await rpc({
      products: ids.slice(i, i + CHUNK),
      product_fields: PRODUCT_FIELDS,
      sku_fields: SKU_FIELDS,
    });
    for (const p of products ?? []) {
      for (const r of mapBobbiBrown(p, categoryOf.get(String(p?.PRODUCT_ID)) ?? null)) out.set(r.externalId, r);
    }
  }
  return [...out.values()];
}
