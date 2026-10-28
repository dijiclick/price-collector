/**
 * Lutvelizade (lutvelizade.com.tr) — women's shoes, bags, accessories and
 * clothing. The shop moved from its own ASP.NET storefront to **ikas** on
 * ~2026-10-26 (the old `/kadin-…-modelleri` grids and `/…-p` product urls are
 * gone; the sitemap is now ikas's products/collections/pages index), and the
 * old adapter failed every run with "sitemap named only 1 grids".
 *
 * ikas's storefront client posts plain JSON to
 * `api.myikas.com/api/sf/graphql/searchProducts` with the shop's public
 * storefront key (`apiKey` in `window.__IKAS_DATA__`, read from the home page
 * each run, the constants below as fallback). One call returns up to 100 full
 * products with every variant's price and stock: 168 products in 2 calls
 * (2026-10-28). No proxy, no wall.
 *
 * EACH ROW is one colour of a product (`groupVariantsByVariantTypeId` names the
 * colour type), as before. The id is the variant SKU minus its size suffix
 * (`26IW011020003-3321-36` → `26IW011020003-3321`) — the same SKU-colour the
 * old grid's `data-ga4-id` carried, so tracked products keep their rows.
 *
 * PRICES. `discountPrice` (charged) below `sellPrice` (struck) is the shop's
 * own reduction; otherwise the row is full price (`listPrice: null`). Every
 * in-stock colour is returned, reduced or not, plus sold-out reduced colours.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson, getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "lutvelizade";
export const SITE = "https://lutvelizade.com.tr";
const API = "https://api.myikas.com/api/sf/graphql/searchProducts";
const IMG = "https://cdn.myikas.com/images";
const PER_PAGE = 100;
const MAX_PAGES = 10;
const PAUSE_MS = Number(process.env.LUTVELIZADE_PAUSE_MS ?? 300);
const TIMEOUT_MS = 60_000;

/** Public storefront constants (home page, 2026-10-28). */
export const IKAS_FALLBACK = {
  apiKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJtIjoiNzU3Zjg5ZmItNzZkYS00NmQ3LWIxNzctNzA5Yzg5NTVkODVjIiwic2YiOiIzNmFhODFkOC02ZDM4LTQ0OTUtODk2Zi00ZjczZTQyNjJlOWYiLCJzZnQiOjEsInNsIjoiYWY0OTRlZjUtYTMzZS00ZTc0LWEyYjUtZjBmNDI5ZDM2MTQ3In0.MDjS3cK_3BcVB67AXy8vTCtiUopMuCskEblEnTX-dn8",
  merchantId: "757f89fb-76da-46d7-b177-709c8955d85c",
  storefrontId: "36aa81d8-6d38-4495-896f-4f73e4262e9f",
  storefrontRoutingId: "22fd30d6-0563-42eb-b37d-780d660d3ae4",
  salesChannelId: "af494ef5-a33e-4e74-a2b5-f0f429d36147",
};
export type IkasConfig = typeof IKAS_FALLBACK;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The storefront constants from a page's `__IKAS_DATA__`, fallback for any missing. Pure. */
export function ikasConfig(html: string): IkasConfig {
  const pick = (k: keyof IkasConfig) => html.match(new RegExp(`"${k}":"([^"]+)"`))?.[1] ?? IKAS_FALLBACK[k];
  return {
    apiKey: pick("apiKey"),
    merchantId: pick("merchantId"),
    storefrontId: pick("storefrontId"),
    storefrontRoutingId: pick("storefrontRoutingId"),
    salesChannelId: pick("salesChannelId"),
  };
}

const imageUrl = (merchantId: string, id: string) => `${IMG}/${merchantId}/${id}/image_1080.webp`;

/** `26IW011020003-3321-36` → `26IW011020003-3321` (SKU-colour). */
export const colourSku = (sku: string): string => sku.replace(/-[^-]+$/, "");

/** Map one ikas product to one row per colour. Pure. */
export function mapIkasProduct(p: any, merchantId = IKAS_FALLBACK.merchantId): ProductRecord[] {
  if (!p?.id || p.deleted) return [];
  const slug: string | undefined = p?.metaData?.slug;
  const vs: any[] = (p.variants ?? []).filter((v: any) => v && !v.deleted && v.isActive !== false);
  if (!slug || !vs.length) return [];
  const colourType: string | null = p.groupVariantsByVariantTypeId ?? null;
  const valueName = new Map<string, string>();
  for (const t of p.productVariantTypes ?? []) for (const v of t?.variantType?.values ?? []) valueName.set(v.id, String(v.name ?? "").trim());
  const valueOf = (v: any, ofColour: boolean) =>
    (v.variantValues ?? []).find((x: any) => (x.variantTypeId === colourType) === ofColour)?.variantValueId as string | undefined;

  const byColour = new Map<string, any[]>();
  for (const v of vs) {
    const key = (colourType && valueOf(v, true)) || "_";
    const list = byColour.get(key);
    if (list) list.push(v);
    else byColour.set(key, [v]);
  }
  const colourNames = [...byColour.keys()].map((k) => valueName.get(k)).filter((n): n is string => !!n);
  // The product name carries ONE colour ("… Sandalet - Siyah") whatever the variant.
  let base = String(p.name ?? "").replace(/\s+/g, " ").trim();
  for (const c of colourNames) if (base.endsWith(` - ${c}`)) base = base.slice(0, -(c.length + 3));
  const category = p.categories?.[0]?.name ?? null;
  const out: ProductRecord[] = [];
  for (const [key, list] of byColour) {
    const colour = valueName.get(key) ?? null;
    const priced = list
      .map((v) => {
        const pr = v.prices?.[0] ?? {};
        const sell = Number(pr.sellPrice);
        const disc = Number(pr.discountPrice);
        const now = Number.isFinite(disc) && disc > 0 ? disc : sell;
        const stock = (v.stocks ?? []).reduce((a: number, s: any) => a + (Number(s?.stockCount) || 0), 0);
        return { v, now, sell, inStock: stock > 0 || v.sellIfOutOfStock === true };
      })
      .filter((x) => Number.isFinite(x.now) && x.now > 0);
    if (!priced.length) continue;
    const pick = [...priced].sort((a, b) => Number(b.inStock) - Number(a.inStock) || a.now - b.now)[0];
    const sizes: SizeVariant[] = [];
    for (const x of priced) {
      const label = valueName.get(valueOf(x.v, false) ?? "") ?? "";
      if (!label || sizes.some((s) => s.label === label)) continue;
      sizes.push({ label, availability: x.inStock ? "in_stock" : "out_of_stock" });
    }
    const withImages = list.find((v) => (v.images ?? []).length) ?? list[0];
    const imgs: string[] = [...(withImages.images ?? [])]
      .sort((a: any, b: any) => Number(b.isMain) - Number(a.isMain) || (a.order ?? 0) - (b.order ?? 0))
      .filter((im: any) => im?.id && !im.isVideo)
      .map((im: any) => imageUrl(merchantId, im.id));
    const sku = String(list.find((v) => v.sku)?.sku ?? "");
    out.push({
      brand,
      country: "TR",
      externalId: sku ? colourSku(sku) : `${p.id}:${key}`,
      name: colour ? `${base} - ${colour}` : base,
      url: `${SITE}/${slug}?variantId=${pick.v.id}`,
      imageUrl: imgs[0] ?? null,
      images: cleanGallery(imgs, imgs[0] ?? null),
      price: toMinor(pick.now),
      listPrice: Number.isFinite(pick.sell) && pick.sell > pick.now ? toMinor(pick.sell) : null,
      currency: "TRY",
      inStock: priced.some((x) => x.inStock),
      category: category === "Spor" ? "Spor Ayakkabı" : category,
      gender: "kadin", // a women's shop; every name says "Kadın"
      variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
      colorName: colour,
      groupKey: byColour.size > 1 ? `lutvelizade:${p.id}` : null,
    });
  }
  return out;
}

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (country !== "TR") return [];
  const home = await getText(`${SITE}/`, { timeoutMs: TIMEOUT_MS }).catch(() => "");
  const cfg = ikasConfig(home);
  const byId = new Map<string, ProductRecord>();
  let count = 0;
  let seen = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) await sleep(PAUSE_MS);
    const d = await getJson<any>(API, {
      method: "POST",
      timeoutMs: TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cfg.apiKey,
        "x-sfid": cfg.storefrontId,
        "x-sfrid": cfg.storefrontRoutingId,
        Origin: SITE,
        Referer: `${SITE}/`,
      },
      body: JSON.stringify({
        input: {
          locale: "tr",
          page,
          perPage: PER_PAGE,
          priceListId: null,
          salesChannelId: cfg.salesChannelId,
          query: "",
          order: [],
          showStockOption: "SHOW_ALL",
        },
      }),
    });
    const res = d?.data?.searchProducts;
    const results: any[] = res?.results ?? [];
    if (!res || !Array.isArray(res.results)) throw new Error(`lutvelizade: searchProducts page ${page} returned no results`);
    count = Number(res.count ?? 0);
    seen += results.length;
    for (const p of results) for (const r of mapIkasProduct(p, cfg.merchantId)) if (!byId.has(r.externalId)) byId.set(r.externalId, r);
    if (!results.length || seen >= count) break;
  }
  // A short walk would let the sweep mark live products sold out.
  if (seen < count) throw new Error(`lutvelizade: walked ${seen} of ${count} products`);
  const rows = [...byId.values()];
  const live = rows.filter((r) => r.inStock);
  if (!live.length) throw new Error(`lutvelizade: ${seen} products, none in stock`);
  const deals = live.filter((r) => r.listPrice != null);
  const full = live.filter((r) => r.listPrice == null);
  const soldOutDeals = rows.filter((r) => !r.inStock && r.listPrice != null);
  if (process.env.LUTVELIZADE_DEBUG) console.error(`lutvelizade: ${seen} products, ${rows.length} colours, ${deals.length} in-stock deals`);
  return [...deals, ...full, ...soldOutDeals];
}
