/**
 * Chicorée (Switzerland, women's fashion) — 2026-10-11.
 *
 * chicoree.ch is a Next.js shop whose product data comes from its own public
 * Dynamics-365 bridge, `PRODUCTS_BACKEND_URL` in the page's runtimeConfig
 * (https://d365apiprod.chicoree.ch). No key, no cookie, no proxy.
 *
 * - `/products/?published_only=true&limit=…&offset=…` is the whole online
 *   assortment as colour variants (~700 rows), each with `price`,
 *   `special_price` (CHF, major units) and `offer_type` (SALE / OFFER / null).
 *   The `offerType` filter the web app sends is ignored by the API, so the
 *   adapter reads everything and keeps rows with special_price < price.
 * - `/products/{productId}/` carries every colour with per-size stock and the
 *   photo gallery. One call per product, so it is spent on as many discounted
 *   products as the request budget allows (in-stock, deepest cut first); the
 *   rest keep the listing's colour-level data without sizes.
 *
 * Every product is women's (the shop has no other department).
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const API = "https://d365apiprod.chicoree.ch";
const SITE = "https://chicoree.ch/de";
const PAGE = 1000;
const MAX_PAGES = 5;
const MAX_DETAILS = Number(process.env.CHICOREE_MAX_DETAILS ?? 55);
const PAUSE_MS = Number(process.env.CHICOREE_PAUSE_MS ?? 300);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ChicoreeRow {
  product_id: string;
  product_color_id: string;
  title: string;
  color_title?: string;
  slug: string;
  image?: string;
  price: number;
  special_price?: number | null;
  offer_type?: string | null;
  availability?: number;
}

export const productUrl = (slug: string, colorId: string) => `${SITE}/frauen-kleidung/${slug}/id/${colorId}/`;

function availability(n: unknown): SizeVariant["availability"] {
  const q = Number(n ?? 0);
  if (!(q > 0)) return "out_of_stock";
  return q <= 2 ? "low_on_stock" : "in_stock";
}

/** Map one listing row (a colour variant), optionally enriched by its product detail colour. Pure. */
export function mapChicoree(row: ChicoreeRow, detailColour: any = null, country: CountryCode = "CH"): ProductRecord | null {
  if (!row?.product_color_id || !row?.title || !row?.slug) return null;
  const was = Number(detailColour?.price ?? row.price);
  const now = Number(detailColour?.special_price ?? row.special_price);
  const reduced = Number.isFinite(now) && now > 0 && Number.isFinite(was) && now < was;
  const price = reduced ? now : was;
  if (!Number.isFinite(price) || price <= 0) return null;

  const sizes: SizeVariant[] = Array.isArray(detailColour?.sizes)
    ? detailColour.sizes
        .filter((s: any) => s?.title)
        .map((s: any) => ({ label: String(s.title).trim(), availability: availability(s.availability) }))
    : [];
  const oneSize = sizes.length === 1 && /^(one ?size|os|uni|tu)$/i.test(sizes[0].label);
  const gallery: string[] = Array.isArray(detailColour?.images) ? detailColour.images.filter((u: unknown) => typeof u === "string") : [];
  const first = row.image ?? gallery[0] ?? null;
  const colour = String(detailColour?.color_title ?? row.color_title ?? "").trim() || null;
  const total = Number(detailColour?.availability ?? row.availability ?? 0);

  return {
    brand: "chicoree",
    country,
    externalId: row.product_color_id,
    name: String(row.title).trim(),
    url: productUrl(row.slug, row.product_color_id),
    imageUrl: first,
    images: cleanGallery(gallery, first),
    price: toMinor(price),
    listPrice: reduced ? toMinor(was) : null,
    currency: COUNTRIES[country].currency,
    inStock: sizes.length ? sizes.some((s) => s.availability !== "out_of_stock") : total > 0,
    category: null,
    gender: "kadin",
    variants: sizes.length && !oneSize ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: `chicoree:${row.product_id}`,
    colorName: colour,
  };
}

export async function listChicoree(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "CH") return [];
  const rows: ChicoreeRow[] = [];
  for (let n = 0; n < MAX_PAGES; n++) {
    if (n > 0) await sleep(PAUSE_MS);
    const data = await getJson<any>(`${API}/products/?published_only=true&limit=${PAGE}&offset=${n * PAGE}`, { country });
    const page: ChicoreeRow[] = Array.isArray(data?.results) ? data.results : [];
    rows.push(...page);
    if (!data?.next || page.length < PAGE) break;
  }
  const deals = rows.filter((r) => Number(r.special_price) > 0 && Number(r.special_price) < Number(r.price));

  // Product ids worth a detail call: in stock first, then the deepest cut.
  const cut = (r: ChicoreeRow) => 1 - Number(r.special_price) / Number(r.price);
  const order = [...deals].sort((a, b) => Number((b.availability ?? 0) > 0) - Number((a.availability ?? 0) > 0) || cut(b) - cut(a));
  const ids = [...new Set(order.map((r) => r.product_id))].slice(0, MAX_DETAILS);
  const colours = new Map<string, any>();
  for (const id of ids) {
    await sleep(PAUSE_MS);
    const d = await getJson<any>(`${API}/products/${encodeURIComponent(id)}/`, { country, retries: 1 }).catch(() => null);
    for (const c of d?.color_variations ?? []) if (c?.product_color_id) colours.set(String(c.product_color_id), c);
  }

  const out = new Map<string, ProductRecord>();
  for (const r of deals) {
    const rec = mapChicoree(r, colours.get(r.product_color_id) ?? null, country);
    if (rec && rec.listPrice != null) out.set(rec.externalId, rec);
  }
  const all = [...out.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, 1500);
}
