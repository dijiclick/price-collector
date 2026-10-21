/**
 * Scapino (scapino.nl) — Dutch shoe & fashion chain, Netherlands only. A Vike
 * (Vite SSR) storefront over Tweakwise; every listing page server-renders its
 * page context as JSON (`<script id="vike_pageContext">`), and the page
 * answers a GitHub runner through Cloudflare with a plain browser UA (probe
 * run 39636006759, 2026-10-21).
 *
 * Markdown shelf: `/c/sale` (Tweakwise `tn_cid=10000&tn_fk_issale=True`,
 * 837 items on 2026-10-21), 24 per page, paged with `?p=N`. Each product's
 * `primary` carries `price` (charged), `priceFrom` (the struck "van" price
 * the tile shows), `stock`, photos, brand and `types` (Schoenen / Kleding /
 * Accessoires). NOTE: `priceFrom` equals `attributes.suggestedRetailPrice` —
 * Scapino strikes through the brand's recommended price, which is also the
 * price it sells the item at outside the sale. Only priceFrom > price is kept.
 *
 * Sports equipment the sale also carries (footballs, padel rackets, shin
 * guards) and shoe-care products are dropped.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { nlGender, nlType } from "./_nltypes";

const ORIGIN = "https://www.scapino.nl";
const MAX_PAGES = 70;
const CAP = 1500;
const PAUSE_MS = Number(process.env.SCAPINO_PAUSE_MS ?? 400);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const scapinoPageUrl = (page: number): string => `${ORIGIN}/c/sale/${page > 1 ? `?p=${page}` : ""}`;

/** The page context JSON of a listing page, or null. Pure. */
export function scapinoContext(html: string): any | null {
  const m = html.match(/<script id="vike_pageContext" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

const NOT_FASHION = /voetbal|\bbal(len)?\b|racket|padel|scheenbeschermer|bidon|veters\b|inlegzool|zolen\b|schoenpoets|schoencr[eè]me|impregneer|spray|borstel|schoenlepel|schoenspanner|sokkenbol/i;

/** One listing product → a record, or null when it is not a real markdown or not fashion. Pure. */
export function mapScapinoProduct(p: any, country: CountryCode = "NL"): ProductRecord | null {
  const a = p?.primary ?? p;
  const price = Number(a?.price);
  const was = Number(a?.priceFrom);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(was) || was <= price) return null;
  const title = String(a?.title ?? "").trim();
  const route = String(a?.routeGeneral ?? a?.route ?? "");
  const id = String(a?.groupId ?? "");
  if (!title || !id || !route.startsWith("/p/")) return null;
  if (NOT_FASHION.test(title)) return null;
  const attrs = a?.attributes ?? {};
  const types: string[] = Array.isArray(attrs.types) ? attrs.types.map(String) : [];
  // `_Default` is a 50×50 thumbnail; /w512/ is the same photo at 512 px (2026-10-21).
  const big = (u: unknown) => (typeof u === "string" ? u.replace("/_Default/", "/w512/") : u);
  const images = cleanGallery((Array.isArray(a?.imageUrls) ? a.imageUrls : []).map(big), big(a?.mainImageUrl ?? null) as string | null);
  const brand = typeof attrs.brand === "string" && attrs.brand.trim() ? attrs.brand.trim() : null;
  return {
    brand: "scapino",
    country,
    externalId: id,
    name: title,
    url: `${ORIGIN}${route}`,
    imageUrl: images?.[0] ?? null,
    images,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: "EUR",
    inStock: Number(a?.stock ?? 0) > 0,
    barcodes: typeof attrs.gtin === "string" && /^\d{8,14}$/.test(attrs.gtin) ? [attrs.gtin] : null,
    category: nlType(title) ?? (types[0] === "Schoenen" ? "Shoes" : types[0] ?? null),
    maker: brand,
    gender: nlGender(title),
  };
}

/** Register as `listScapino(country)`. NL only. */
export async function listScapino(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "NL") return [];
  const byId = new Map<string, ProductRecord>();
  let totalPages = 1;
  for (let page = 1; page <= totalPages && byId.size < CAP; page++) {
    if (page > MAX_PAGES) throw new Error(`scapino: more than ${MAX_PAGES} sale pages`);
    if (page > 1) await sleep(PAUSE_MS);
    const ctx = scapinoContext(await getText(scapinoPageUrl(page), { country, timeoutMs: 60_000 }));
    const pp = ctx?.pageProps;
    if (!pp || !Array.isArray(pp.products)) throw new Error(`scapino: page ${page} has no page context`);
    const paging = pp.searchResult?.paging ?? {};
    if (Number(paging.page) !== page) throw new Error(`scapino: asked for page ${page}, got ${paging.page}`);
    totalPages = Number(paging.totalPages ?? 1);
    for (const p of pp.products) {
      const r = mapScapinoProduct(p, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    // Pages are not always full (page 9 had 23 on 2026-10-21) — stop on totalPages only.
    if (!pp.products.length) break;
  }
  if (!byId.size) throw new Error("scapino: 0 marked-down products");
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
