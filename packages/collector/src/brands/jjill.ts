/**
 * J.Jill (jjill.com) — US women's apparel. A Next.js (app router) front on
 * HCL Commerce (storeId 10101). Visitors from Europe/Turkey are redirected to
 * a GDPR notice, so this only answers US egress — GitHub's runners (probe run
 * 39655261213); the Mac and Hetzner cannot test it.
 *
 * Feed: the "/sale" listing (839 styles, 24 pages of 36, 2026-10-21) asked as
 * a React Server Components payload (`RSC: 1` header) — the page's data
 * without the HTML shell. The payload holds
 * `"total":N,"page":P,"totalPages":T,"products":[…]`, each product with
 * `price {minOfferPrice, maxOfferPrice, minPrice, maxPrice}` (offer = what the
 * shopper pays, price = the struck list price). Ranges (colours/sizes priced
 * differently) are folded conservatively: the TOP of the offer range against
 * the BOTTOM of the list range, so the discount shown is one every variant
 * gets. The listing has no stock per size; it lists orderable styles.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const ORIGIN = "https://www.jjill.com";
const MAX_PAGES = 40;
const CAP = 1500;
const PAUSE_MS = Number(process.env.JJILL_PAUSE_MS ?? 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface JJillPage {
  total: number;
  page: number;
  totalPages: number;
  products: any[];
}

/** Pull the listing block out of an RSC payload. Pure; null when absent. */
export function jjillListing(payload: string): JJillPage | null {
  const m = payload.match(/"total":(\d+),"page":(\d+),"totalPages":(\d+),"products":/);
  if (!m || m.index === undefined) return null;
  try {
    const start = m.index + m[0].length;
    const products = JSON.parse(sliceArray(payload, start));
    return Array.isArray(products) ? { total: +m[1], page: +m[2], totalPages: +m[3], products } : null;
  } catch {
    return null;
  }
}

/** The JSON array starting at `start` (bracket-matched, string-aware). */
function sliceArray(s: string, start: number): string {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  throw new Error("unterminated product array");
}

const https = (u: unknown): string | null =>
  typeof u === "string" && /^(https?:)?\/\//.test(u) ? (u.startsWith("//") ? `https:${u}` : u).replace(/\?impolicy=[^&]*$/, "") : null;

/** One listing product → a record, or null without a reduction every variant gets. Pure. */
export function mapJJill(p: any, country: CountryCode = "US"): ProductRecord | null {
  const pr = p?.price ?? {};
  const price = Number(pr.maxOfferPrice ?? pr.minOfferPrice);
  const was = Number(pr.minPrice);
  if (!p?.id || !p?.name || !p?.url || !Number.isFinite(price) || price <= 0 || !Number.isFinite(was) || was <= price) return null;
  const colours: any[] = Array.isArray(p.colors) ? p.colors : [];
  const lead = colours.find((c) => c?.id === p.defaultColorId) ?? colours[0];
  const photos = [lead?.thumbnail?.src, ...(lead?.media?.full ?? []).map((m: any) => m?.src), ...colours.map((c) => c?.thumbnail?.src)].map(https);
  const images = cleanGallery(photos);
  return {
    brand: "jjill",
    country,
    externalId: String(p.id),
    name: String(p.name).replace(/\s+/g, " ").trim(),
    url: `${ORIGIN}${String(p.url).startsWith("/") ? "" : "/"}${p.url}`,
    imageUrl: images?.[0] ?? null,
    images,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: "USD",
    inStock: true,
    category: null,
    gender: "kadin",
    variants: colours.length ? { colors: colours.map((c) => String(c?.text ?? "").trim()).filter(Boolean), sizes: [] } : null,
    groupKey: null,
    colorName: typeof lead?.text === "string" ? lead.text : null,
  };
}

/** Register as `listJJill(country)`. US only. */
export async function listJJill(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const byId = new Map<string, ProductRecord>();
  let totalPages = 1;
  for (let page = 1; page <= totalPages && byId.size < CAP; page++) {
    if (page > MAX_PAGES) throw new Error(`jjill/${country}: ${totalPages} sale pages exceed ${MAX_PAGES}`);
    if (page > 1) await sleep(PAUSE_MS);
    const payload = await getText(`${ORIGIN}/sale${page > 1 ? `?page=${page}` : ""}`, {
      country,
      timeoutMs: 45_000,
      headers: { RSC: "1", "Accept-Language": "en-US,en;q=0.9" },
    });
    const listing = jjillListing(payload);
    if (!listing) throw new Error(`jjill/${country}: sale page ${page} carried no product listing`);
    totalPages = listing.totalPages;
    for (const p of listing.products) {
      const r = mapJJill(p, country);
      if (r) byId.set(r.externalId, r);
    }
  }
  return [...byId.values()].slice(0, CAP);
}
