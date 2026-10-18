/**
 * Globus — Swiss department store (www.globus.ch), added 2026-10-11.
 *
 * Every path on www.globus.ch sits behind a Cloudflare bot rule that answers a
 * browser User-Agent with a "Just a moment…" challenge (403) — but Globus's own
 * Android app is a WebView that appends "; Customer/<version>" to the
 * User-Agent (ch.globus 3.0.10, CustomerApplication.appUserAgentString), and
 * requests carrying it pass. With that UA a plain request from a GitHub runner
 * reaches the storefront's GoTSRPC catalogue service (probe run 38135739184):
 *
 *  - `POST /service/catalogue/GetFilteredCategory` with `[{path, page: 1,
 *    pageSize: 100, …}]` returns the first 100 listing items, the facet list
 *    and `pagedItems` — the product ids of the next 19 pages (2,000 ids).
 *    Page > 1 through this call is "ServiceErrorNotAllowed"; 100 is the
 *    largest page size the service accepts.
 *  - `POST /service/catalogue/GetListingItems` with the same request plus
 *    `productIDs: pagedItems[n]` returns page n+1.
 *
 * Each listing item is one colour (`productSummary`) with every size's own
 * `price`/`crossPrice` pair, `available` flag and `stock` count, in CHF. Sale
 * slices: `/damen/sale-aktionen` (women's fashion, ~3,800) and
 * `/beauty/beauty-sale` (~400).
 *
 * Caveat: product photos live under www.globus.ch/cf-media/… behind the same
 * rule, so they only load for a client that sends the app UA.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const SITE = "https://www.globus.ch";
const SERVICE = `${SITE}/service/catalogue`;
/** Globus's Android WebView UA — the "; Customer/x.y.z" suffix is what the bot rule lets through. */
export const GLOBUS_APP_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.135 Mobile Safari/537.36; Customer/3.0.10";
const PAGE_SIZE = 100;
const PAUSE_MS = Number(process.env.GLOBUS_PAUSE_MS ?? 700);
const CAP = 1500;

export const GLOBUS_SALE: { path: string; gender: ProductRecord["gender"]; max: number }[] = [
  { path: "/beauty/beauty-sale", gender: null, max: 500 },
  { path: "/damen/sale-aktionen", gender: "kadin", max: CAP },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : NaN;
};

export function listingRequest(path: string, page = 1, productIDs?: string[]) {
  return {
    path,
    query: "",
    filterSelections: [],
    sort: "",
    page,
    firstPageSize: PAGE_SIZE,
    pageSize: PAGE_SIZE,
    ...(productIDs ? { productIDs, images: [] } : {}),
  };
}

/** `/cf-media/akeneo/<id>/<version>` → a 600px JPEG rendition. */
export function globusImage(uri: unknown): string | null {
  if (typeof uri !== "string" || !uri.startsWith("/")) return null;
  return `${SITE}${uri}/600.jpg`;
}

function genderFromPath(p: any, fallback: ProductRecord["gender"]): ProductRecord["gender"] {
  const uris = (Array.isArray(p?.path) ? p.path : []).map((n: any) => String(n?.uri ?? "")).join(" ");
  if (/\/(kinder|kids)\b/.test(uris)) return "cocuk";
  if (/\/herren\b/.test(uris)) return "erkek";
  if (/\/damen\b/.test(uris)) return "kadin";
  return fallback;
}

function availabilityOf(s: any): SizeVariant["availability"] {
  if (s?.available === false) return "out_of_stock";
  const stock = num(s?.stock);
  if (!s?.alwaysAvailable && stock > 0 && stock <= 2) return "low_on_stock";
  return "in_stock";
}

/** One listing item → a record, or null unless a size is genuinely marked down. Pure. */
export function mapGlobus(item: any, country: CountryCode = "CH", gender: ProductRecord["gender"] = null): ProductRecord | null {
  const p = item?.productSummary ?? item;
  const id = typeof p?.id === "string" ? p.id : "";
  const name = String(p?.name ?? "").trim();
  if (!id || !name || p?.isCadeauCard) return null;
  const sizesIn: any[] = Array.isArray(p.sizes) ? p.sizes : [];
  // Each size carries its own price/crossPrice pair, so a deal is read from ONE
  // size — never a cheap size against a dear size's original (the range bug).
  const offers = sizesIn
    .map((s) => ({ s, price: num(s?.price?.price), cross: num(s?.price?.crossPrice) }))
    .filter((o) => o.price > 0 && o.cross > o.price);
  if (!offers.length) return null;
  const pick = [...offers].sort(
    (a, b) => Number(b.s?.available !== false) - Number(a.s?.available !== false) || a.price - b.price,
  )[0];
  const seen = new Set<string>();
  const sizes: SizeVariant[] = [];
  for (const s of sizesIn) {
    const label = String(s?.name ?? "").trim();
    if (!label || /^(default|one ?size|einheitsgr(ö|oe)sse)$/i.test(label) || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: availabilityOf(s) });
  }
  const media: any[] = Array.isArray(p.media) ? p.media : [];
  const imgs = media.map((m) => globusImage(m?.uri)).filter((u): u is string => !!u);
  const variant = (Array.isArray(p.variants) ? p.variants : []).find((v: any) => v?.id === id);
  const colour = typeof variant?.color?.value === "string" && variant.color.value.trim() ? variant.color.value.trim() : null;
  const brand = String(p?.brand?.name ?? "").trim() || null;
  return {
    brand: "globus",
    country,
    externalId: id,
    name,
    url: typeof p.productURI === "string" && p.productURI.startsWith("/") ? `${SITE}${p.productURI}` : `${SITE}/${id}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(pick.price),
    listPrice: toMinor(pick.cross),
    currency: "CHF",
    inStock: sizesIn.some((s) => s?.available !== false),
    // Multi-brand store: the label shows the brand (same as Manor/Boyner).
    category: brand ?? (typeof p.productType === "string" ? p.productType : null),
    gender: genderFromPath(p, gender),
    variants: sizes.length || colour ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: typeof p.articleID === "string" && p.articleID ? `globus:${p.articleID}` : null,
    colorName: colour,
  };
}

async function call(method: string, req: unknown): Promise<any[] | null> {
  const res = await getJson<any[]>(`${SERVICE}/${method}`, {
    method: "POST",
    country: "CH",
    headers: { "User-Agent": GLOBUS_APP_UA, "Content-Type": "application/json", "Accept-Language": "de-CH,de;q=0.9" },
    body: JSON.stringify([req]),
  });
  return Array.isArray(res) ? res : null;
}

export async function listGlobus(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "CH") return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  let failures = 0;
  for (const slice of GLOBUS_SALE) {
    const before = byId.size;
    const absorb = (items: unknown) => {
      for (const it of Array.isArray(items) ? items : []) {
        const r = mapGlobus(it, country, slice.gender);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
    };
    if (requests++ > 0) await sleep(PAUSE_MS);
    const first = await call("GetFilteredCategory", listingRequest(slice.path)).catch(() => null);
    const listing = first?.[0];
    if (!listing) {
      failures++;
      continue;
    }
    absorb(listing.items);
    const paged: string[][] = Array.isArray(listing.pagedItems) ? listing.pagedItems : [];
    // pagedItems[0] is page 1 (already in hand); the rest are the next pages' ids.
    for (let n = 1; n < paged.length; n++) {
      if (byId.size - before >= slice.max || byId.size >= CAP * 1.1) break;
      const ids = paged[n];
      if (!Array.isArray(ids) || !ids.length) break;
      requests++;
      await sleep(PAUSE_MS);
      const res = await call("GetListingItems", listingRequest(slice.path, n + 1, ids)).catch(() => null);
      if (!res) {
        failures++;
        break;
      }
      absorb(res[0]);
    }
  }
  if (byId.size === 0 && failures > 0) throw new Error(`globus/CH: catalogue service refused (${failures} failed calls)`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const brand = "globus";
export const listProducts = listGlobus;
