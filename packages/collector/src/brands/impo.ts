/**
 * Impo — Swiss perfumery (www.impo.ch, Coop group), added 2026-10-11.
 *
 * The storefront sits behind DataDome, but its SAP Commerce OCC API does not:
 * `https://webapi.impo.ch/occ/v2/impo/products/search` answers a plain GET
 * (verified 2026-10-11). `_sapocc.ts` doesn't fit this shop — Impo's strike
 * price is `originalPrice` (not `firstStrikePrice`), there is no `sizeDetail`,
 * and its category facets cannot be addressed in the query string (every
 * `:allCategories:<code>` form is silently dropped) — so this adapter is
 * self-contained.
 *
 * What works instead is the shop's own "Aktionen" sort: `sort=specialOffers`
 * puts every reduced product first, so paging from the top yields only
 * discounts until they run out. `pageSize` is capped at 100 by the server.
 * Each hit is one sellable variant (a shade or a bottle size) with its own
 * code, EAN and stock; variants share `baseProduct`, which becomes groupKey.
 *
 * Images live on an internal host (`api-prod-nsg.impo.ch`) that is not
 * reachable from outside; the site serves them through its Next.js image
 * proxy, which is what this adapter links to as well.
 */
import { MAX_GALLERY, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const API = "https://webapi.impo.ch/occ/v2/impo";
const SITE = "https://www.impo.ch";
const MEDIA_HOST = "http://api-prod-nsg.impo.ch";
const PAGE_SIZE = 100;
const PAUSE_MS = Number(process.env.IMPO_PAUSE_MS ?? 800);
const FIELDS =
  "pagination,products(code,name,baseProduct,brandName,breadcrumbCategoryNames,categories(code),url," +
  "price(value,currencyIso),originalPrice(value),stock(stockLevelStatus),images(url,format,imageType)," +
  "mediaGallery,numberContentUnits,contentUnit,shopProperties)";

/** A `/medias/…` path → the site's own image proxy at a 640px rendition. */
export function impoImage(path: unknown): string | null {
  if (typeof path !== "string" || !path) return null;
  const src = /^https?:\/\//.test(path) ? path : `${MEDIA_HOST}${path.startsWith("/") ? "" : "/"}${path}`;
  return `${SITE}/_next/image?url=${encodeURIComponent(src)}&w=640&q=75`;
}

/**
 * Gallery for proxy URLs. `cleanGallery` dedupes on the URL before its query
 * string, and every proxied image shares `/_next/image` — it would keep one.
 * Same contract otherwise: http only, no duplicates, `first` in front, capped.
 */
export function impoGallery(urls: (string | null)[], first: string | null): string[] | null {
  const out = [...new Set([first, ...urls].filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u)))];
  return out.length ? out.slice(0, MAX_GALLERY) : null;
}

function props(p: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const it of p?.shopProperties?.items ?? []) if (typeof it?.key === "string") out[it.key] = it.value;
  return out;
}

export function impoGender(p: any): ProductRecord["gender"] {
  const codes: string[] = (p?.categories ?? []).map((c: any) => String(c?.code ?? ""));
  if (codes.some((c) => /^(kids?|child)/i.test(c))) return "cocuk";
  const f = codes.some((c) => c.startsWith("female_"));
  const m = codes.some((c) => c.startsWith("male_"));
  if (f && !m) return "kadin";
  if (m && !f) return "erkek";
  return null;
}

/** One search hit → record. Only DISCOUNTED hits (originalPrice > price) are returned. Pure. */
export function mapImpo(country: CountryCode, p: any): ProductRecord | null {
  const code = typeof p?.code === "string" ? p.code : "";
  const price = Number(p?.price?.value);
  const was = Number(p?.originalPrice?.value);
  if (!code || !Number.isFinite(price) || price <= 0 || !(Number.isFinite(was) && was > price)) return null;
  const sp = props(p);
  const brand = String(p?.brandName ?? "").trim();
  // `name` is an abbreviated SAP article text ("Col.Imp.Comp.Eye Shadow 100");
  // line + sub-line is what the product page shows.
  const line = [sp.line, sp.subLine].filter((x) => typeof x === "string" && x.trim()).join(" ").trim();
  const content =
    sp.sizeVariant === true && p?.numberContentUnits && p?.contentUnit ? ` ${p.numberContentUnits} ${p.contentUnit}` : "";
  const name = (line ? `${line}${content}` : String(p?.name ?? "")).trim();
  if (!name) return null;
  const shade = typeof sp.colorDescription === "string" && sp.colorDescription.trim() ? sp.colorDescription.trim() : null;
  const gallery = (Array.isArray(p.mediaGallery) ? p.mediaGallery : [])
    .filter((m: any) => !m?.type || m.type === "IMAGE")
    .map((m: any) => impoImage(m?.media?.imageUrl));
  const primary = (Array.isArray(p.images) ? p.images : []).find((i: any) => i?.imageType === "PRIMARY");
  const imageUrl = gallery.find(Boolean) ?? impoImage(primary?.url);
  const ean = typeof sp.ean === "string" && /^\d{8,14}$/.test(sp.ean) ? sp.ean : null;
  const crumbs: string[] = Array.isArray(p.breadcrumbCategoryNames) ? p.breadcrumbCategoryNames : [];
  return {
    brand: "impo",
    country,
    externalId: code,
    name: shade ? `${name} ${shade}` : name,
    url: typeof p.url === "string" && p.url.startsWith("/") ? `${SITE}/de${p.url}` : SITE,
    imageUrl,
    images: impoGallery(gallery, imageUrl),
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: String(p?.price?.currencyIso ?? "CHF"),
    inStock: p?.stock?.stockLevelStatus !== "outOfStock",
    barcodes: ean ? [ean] : null,
    // Multi-brand perfumery: the label shows the brand (as Sephora does).
    category: brand || crumbs.at(-1) || null,
    gender: impoGender(p),
    variants: shade ? { colors: [shade], sizes: [] } : null,
    groupKey: typeof p.baseProduct === "string" && p.baseProduct ? `impo:${p.baseProduct}` : null,
    colorName: shade,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function listImpo(country: CountryCode, maxProducts = 1500): Promise<ProductRecord[]> {
  if (country !== "CH") return [];
  const byId = new Map<string, ProductRecord>();
  const maxPages = Math.ceil(maxProducts / 80) + 2;
  for (let page = 0; page < maxPages && byId.size < maxProducts; page++) {
    if (page) await sleep(PAUSE_MS);
    const q = new URLSearchParams({
      sort: "specialOffers",
      fields: FIELDS,
      lang: "de",
      curr: "CHF",
      pageSize: String(PAGE_SIZE),
      currentPage: String(page),
    });
    const data = await getJson<any>(`${API}/products/search?${q}`, { country }).catch((e) => {
      if (page === 0) throw new Error(`impo/${country}: OCC search refused (${e})`);
      return null;
    });
    const ps: any[] = data?.products ?? [];
    if (!ps.length) break;
    let reduced = 0;
    for (const p of ps) {
      const r = mapImpo(country, p);
      if (!r) continue;
      reduced++;
      if (!byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    // The sort puts offers first: a page without one means they ran out.
    if (reduced === 0) break;
    if (page + 1 >= Number(data?.pagination?.totalPages ?? Infinity)) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, maxProducts);
}

export const listProducts = (country: CountryCode): Promise<ProductRecord[]> => listImpo(country);
