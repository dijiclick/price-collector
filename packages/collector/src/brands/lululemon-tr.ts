/**
 * lululemon Turkey (www.lululemon.com.tr): the "We Made Too Much" markdown
 * collection, read through the storefront's own load-more route.
 *
 * The Turkish store is a separate Next.js site on the Retter platform (product
 * data from `api.lululemon.retter.io`, photos from `api.mircate.com` PIMAPI) —
 * nothing to do with shop.lululemon.com's Akamai-walled GraphQL (lululemon.ts).
 * The category page's infinite scroll POSTs to `/api/products`
 * `{type: "categories", categories: ["we-made-too-much"], searchParams: {}, page}`
 * and gets 20 listing rows back; the server route calls Retter for us, so no
 * Retter token is needed. Answers a GitHub runner directly (probe 38221961090,
 * 2026-10-12) — no proxy, as the Turkey rule requires.
 *
 * One row = one colour of one style (`colorGroupId`), and carries every
 * size×colour variant of the style with `inStock`, so per-size stock is exact.
 * Prices are already kuruş (integers). WMTM held 517 colours / 26 pages on
 * 2026-10-12; each page is ~0.5 MB, the run ~13 MB — free datacenter egress.
 * The collection lists only colours with some stock; sold-out sizes still show.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";

export const brand = "lululemon";

const SITE = "https://www.lululemon.com.tr";
const API = `${SITE}/api/products`;
const COLLECTION = "we-made-too-much";
const PAGE_SIZE = 20; // fixed by the route
const MAX_PAGES = 75; // 1,500 / 20
const PAUSE_MS = 400;
const CAP = 1500;

/** "6.495,00 TL" → 649500 (kuruş). Null when it doesn't parse. */
export function kurusFromLabel(label: unknown): number | null {
  if (typeof label !== "string") return null;
  const m = label.replace(/\s/g, "").match(/^([\d.]+),(\d{2})/);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, "") + m[2]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Map one `/api/products` row (one colour of one style). Pure; null unless reduced. */
export function mapLululemonTr(p: any): ProductRecord | null {
  const a = p?.attributes ?? {};
  if (!p?.id || !p?.variantGroupId || !a.productName || !a.slug) return null;
  const colourCode = String(a.colourCode ?? (p.axesValues ?? []).find((x: any) => x?.axe === "colourCode")?.value ?? "");
  const all: any[] = Array.isArray(p.variants) ? p.variants : [];
  const mine = all.filter((v) => v?.isActive !== false && String(v?.colourCode ?? "") === colourCode);

  // The row's own prices are the variant it shows; a colour can price sizes
  // differently, so prefer the cheapest in-stock size of this colour, paired
  // with ITS normal price (never a range across sizes).
  let price = Number(p?.prices?.discountedPrice);
  let was = Number(p?.prices?.normalPrice);
  const priced = mine
    .filter((v) => v?.inStock)
    .map((v) => ({ now: kurusFromLabel(v?.prices?.discountedPriceLabel), was: Number(v?.prices?.normalPrice) }))
    .filter((x): x is { now: number; was: number } => x.now != null && Number.isFinite(x.was) && x.was > 0)
    .sort((x, y) => x.now - y.now);
  if (priced.length) ({ now: price, was } = priced[0]);
  if (!(Number.isFinite(price) && price > 0 && Number.isFinite(was) && price < was)) return null;
  if (p?.prices?.currency && p.prices.currency !== "TRY") return null;

  const sizes: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const v of mine) {
    const label = String(v?.size ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: v?.inStock ? "in_stock" : "out_of_stock" });
  }
  // One-size items with no variant list: trust the row's stock status.
  const inStock = mine.length ? mine.some((v) => v?.inStock) : p.stockStatus !== "NONE" && p.isActive !== false;

  // Gallery from the colour's variant (Retter image URLs, one path per photo).
  // The row's own mircate PIMAPI URLs differ only in `?filename=`, which
  // cleanGallery would collapse to one photo; they are the fallback.
  const isUrl = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//.test(u);
  const variantPhotos: string[] = (mine.find((v) => Array.isArray(v?.images) && v.images.length)?.images ?? []).filter(isUrl);
  const rowPhotos: string[] = (p.images ?? [])
    .filter((i: any) => i?.type === "PRODUCT_IMAGE")
    .map((i: any) => i?.url)
    .filter(isUrl);
  const photos = variantPhotos.length ? variantPhotos : rowPhotos;
  const cats: { id?: string; name?: string }[] = Array.isArray(a.categories) ? a.categories : [];
  const ids = cats.map((c) => String(c?.id ?? ""));
  const gender: ProductRecord["gender"] = ids.includes("kadin") ? "kadin" : ids.includes("erkek") ? "erkek" : null;
  const leaf = cats.length > 1 ? String(cats[cats.length - 1]?.name ?? "").trim() : "";
  const colour = String(a.colour || mine[0]?.colour || a.colourEnglish || mine[0]?.colourEnglish || "").trim();

  return {
    brand,
    country: "TR",
    externalId: String(p.colorGroupId ?? `${p.variantGroupId}_${colourCode}`),
    name: String(a.productName).trim(),
    url: `${SITE}/tr-tr/p/${a.slug}/${p.variantGroupId}${colourCode ? `?color=${encodeURIComponent(colourCode)}` : ""}`,
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price,
    listPrice: was,
    currency: "TRY",
    inStock,
    barcodes: null,
    category: leaf || (Array.isArray(a.productType) && a.productType[0]) || null,
    gender,
    variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: String(p.variantGroupId),
    colorName: colour || null,
  };
}

/**
 * The default order ("Akıllı Sıralama", view count) shifts between page reads:
 * 517 rows came back as only 465 distinct colours (2026-10-12). Newest-first
 * is stable — 517 of 517 distinct — so always page in that order.
 */
const SORT = "createdAt_desc";

export function requestBody(page: number): string {
  return JSON.stringify({ type: "categories", categories: [COLLECTION], searchParams: { sort: SORT }, page });
}

export async function listLululemonTr(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  for (let n = 1; n <= MAX_PAGES && byId.size < CAP * 1.2; n++) {
    if (n > 1) await new Promise((r) => setTimeout(r, PAUSE_MS));
    const d = await getJson<any>(API, {
      method: "POST",
      body: requestBody(n),
      headers: { "Content-Type": "application/json", Origin: SITE, Referer: `${SITE}/tr-tr/c/${COLLECTION}` },
      country: "TR",
    });
    const rows: any[] = Array.isArray(d?.products) ? d.products : [];
    if (n === 1 && !rows.length) throw new Error(`lululemon/TR: empty first page ${JSON.stringify(d).slice(0, 200)}`);
    for (const p of rows) {
      const r = mapLululemonTr(p);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listLululemonTr;
