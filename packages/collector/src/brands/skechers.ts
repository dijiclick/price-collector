/**
 * Skechers Turkey (www.skechers.com.tr, "hebiar" platform) through the site's
 * PersonaClick search feed (2026-10-11).
 *
 * The storefront host — pages, its REST/GraphQL, and the Android app, which
 * calls the same host — sits behind an AWS load-balancer rule that answers 403
 * to GitHub's runners (home probe; sale page probe run 38136052355). The search
 * the site and app run on is PersonaClick's, keyed by a public shop id that
 * ships in the app:
 *
 *   https://api.personaclick.com/search?shop_id=<id>&type=full_search
 *     &search_query=skechers&categories=7001&limit=200&page=N
 *
 * `categories=7001` is the site's "Sezon İndirimi" category (680 products,
 * 4 pages). Answers a runner with 200 (probe run 38136272241). Rows carry
 * price/oldprice in TRY, gender, stock quantity, and every size's EAN
 * (`barcodeList`, `"<size>£<ean>"`) — but no per-size stock, so `variants` is
 * null and the EANs go to `barcodes` (tags are scannable).
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const SITE = "https://www.skechers.com.tr";
export const PERSONACLICK_SHOP_ID = "93d6864969ae524443b4943f4a9616";
const SALE_CATEGORY = "7001";
const PAGE_SIZE = 200;
const MAX_PAGES = Number(process.env.SKECHERS_MAX_PAGES ?? 10);
const CAP = Number(process.env.SKECHERS_MAX_PRODUCTS ?? 1500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const skechersUrl = (page: number) =>
  `https://api.personaclick.com/search?shop_id=${PERSONACLICK_SHOP_ID}&type=full_search&search_query=skechers` +
  `&categories=${SALE_CATEGORY}&limit=${PAGE_SIZE}&page=${page}`;

const param = (p: any, key: string): string[] =>
  ((p?.params ?? []).find((x: any) => x?.key === key)?.values ?? []).map(String);

const title = (s: string) =>
  s.toLocaleLowerCase("tr").replace(/(^|[\s-])\S/g, (c) => c.toLocaleUpperCase("tr"));

/** Map one PersonaClick product. Pure. */
export function mapSkechers(p: any): ProductRecord | null {
  const price = Number(p?.price_full ?? p?.price);
  const old = Number(p?.oldprice_full ?? p?.oldprice);
  if (!p?.id || !p?.name || !p?.url || !Number.isFinite(price) || price <= 0) return null;
  const url = String(p.url).split("?")[0];
  if (!url.startsWith(SITE)) return null;
  const desc = typeof p.description === "string" ? p.description.trim() : "";
  const barcodes = param(p, "barcodeList")
    .map((v) => v.split("£")[1]?.replace(/\D/g, "") ?? "")
    .filter((b) => b.length >= 8 && b.length <= 14);
  const img = typeof p.image_url === "string" ? p.image_url : p.image_url_resized?.original ?? null;
  const gender: ProductRecord["gender"] =
    p.fashion_feature === "child" ? "cocuk" : p.fashion_gender === "f" ? "kadin" : p.fashion_gender === "m" ? "erkek" : null;
  const colour = param(p, "Renk")[0] ?? null;
  return {
    brand: "skechers",
    country: "TR",
    externalId: String(p.id),
    name: `${title(String(p.name))}${desc ? ` ${desc}` : ""}`.trim(),
    url,
    imageUrl: img,
    images: cleanGallery([], img),
    price: toMinor(price),
    listPrice: Number.isFinite(old) && old > price ? toMinor(old) : null,
    currency: "TRY",
    inStock: Number(p.stock_quantity ?? 1) > 0,
    barcodes: barcodes.length ? [...new Set(barcodes)] : null,
    category: param(p, "urunCesidi")[0] ?? null,
    gender,
    variants: null,
    groupKey: p.group_id && p.group_id !== p.id ? `skechers:${p.group_id}` : null,
    colorName: colour,
  };
}

export const brand = "skechers";

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (country !== "TR") return [];
  const byId = new Map<string, ProductRecord>();
  for (let page = 1; page <= MAX_PAGES && byId.size < CAP; page++) {
    if (page > 1) await sleep(800);
    const d = await getJson<any>(skechersUrl(page), { retries: 2 }).catch(() => null);
    const rows: any[] = Array.isArray(d?.products) ? d.products : [];
    if (!d) {
      if (page === 1) throw new Error("skechers: PersonaClick search refused");
      break;
    }
    for (const p of rows) {
      const r = mapSkechers(p);
      if (r && r.listPrice != null && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
