/**
 * Two Canadian stores resolved from the Algolia index their own storefronts
 * list from — the same source, ids and prices as their collector adapters
 * (packages/collector/src/brands/harryrosen.ts and thelasthunt.ts), 2026-11-10.
 * Both keys are the public search-only ones in each site's JS bundle, and
 * Algolia answers any egress directly (no proxy).
 *
 * - Harry Rosen: `harryrosen.com/en/product/<text>-<id>` — the trailing digits
 *   are the style-colour id (`slug`), found by searching for it.
 * - The Last Hunt: `thelasthunt.com/p/<slug>` — the slug ends in the record's
 *   objectID (`…-smt-sw001571` → `SMT-SW001571`).
 */
import type { LiveProduct } from "../live-lookup";
import { UA } from "../live-http";

async function algolia(app: string, key: string, index: string, params: Record<string, string>): Promise<any | null> {
  try {
    const r = await fetch(`https://${app}-dsn.algolia.net/1/indexes/${index}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA, "X-Algolia-Application-Id": app, "X-Algolia-API-Key": key },
      body: JSON.stringify({ params: new URLSearchParams(params).toString() }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// ─── Harry Rosen ───────────────────────────────────────────────────────────

export function harryrosenIdFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)harryrosen\.com$/i.test(u.hostname)) return null;
  return u.pathname.match(/^\/(?:en|fr)\/product\/(?:[^/]*-)?(\d{8,})\/?$/i)?.[1] ?? null;
}

const en = (v: any): string => String((v && typeof v === "object" ? v["en-CA"] ?? v.en : v) ?? "").trim();

/** Map a search answer for one id. Pure. */
export function mapHarryRosenHits(body: any, id: string): LiveProduct | null {
  const h = (Array.isArray(body?.hits) ? body.hits : []).find((x: any) => en(x?.slug) === id);
  const a = h?.attributes ?? {};
  const title = en(h?.name);
  const orig = a.originalPrice;
  if (!h || !title || orig?.currencyCode !== "CAD") return null;
  const list = Math.round(Number(orig.centAmount));
  const now = Math.round(Number(a.onlineSalePrice ?? a.currentPrice ?? a.lowestOnlinePrice) * 100);
  const price = now > 0 ? now : list;
  if (!(price > 0)) return null;
  const make = en(a.brandName);
  const base = typeof a.imageZoom === "string" && a.imageZoom ? a.imageZoom : String(a.image ?? "").split("?")[0];
  const sizes = (Array.isArray(a.onlineSizes) ? a.onlineSizes : []).flatMap((g: any) => (Array.isArray(g?.value) ? g.value : []));
  return {
    brand: "harryrosen",
    externalId: id,
    name: make && !title.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${title}` : title,
    url: `https://www.harryrosen.com/en/product/x-${id}`,
    imageUrl: /^https:\/\//.test(base) ? `${base}?w=900` : null,
    price,
    listPrice: list > price ? list : null,
    inStock: a.isOnlineAvailableToSell !== false && sizes.length > 0,
    category: en(a.level3Category) || null,
    type: null,
    gender: "erkek",
    colorName: en(a.colour) || null,
    country: "CA",
    currency: "CAD",
  };
}

export async function harryrosenUrl(url: string): Promise<LiveProduct | null> {
  const id = harryrosenIdFromUrl(url);
  if (!id) return null;
  const body = await algolia("CDROBE4GID", "d95150eee0278896aedb31f5e8f80b0f", "styles_connector_production_consumer", {
    query: id,
    hitsPerPage: "5",
    attributesToHighlight: "",
  });
  const p = mapHarryRosenHits(body, id);
  // Keep the shopper's own link (the site redirects any "<text>-<id>" to the canonical page).
  return p ? { ...p, url: (() => { const u = new URL(url); u.search = ""; u.hash = ""; return u.toString(); })() } : null;
}

// ─── The Last Hunt ─────────────────────────────────────────────────────────

export function thelasthuntSlugFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)thelasthunt\.com$/i.test(u.hostname)) return null;
  return u.pathname.match(/^\/(?:en\/|fr\/)?p\/([a-z0-9-]+)\/?$/i)?.[1]?.toLowerCase() ?? null;
}

const cents = (v: unknown): number[] => (Array.isArray(v) ? v : [v]).map(Number).filter((n) => Number.isInteger(n) && n > 0);

/** Map a search answer for one slug. Pure. A style priced per colour quotes its lowest price. */
export function mapLastHuntHits(body: any, slug: string): LiveProduct | null {
  const h = (Array.isArray(body?.hits) ? body.hits : []).find((x: any) => String(x?.slug ?? "").toLowerCase() === slug);
  const title = String(h?.name ?? "").trim();
  if (!h || !title) return null;
  const prices = cents(h?.price?.CAD?.centAmount);
  const list = cents(h?.original_price?.CAD?.centAmount)[0] ?? 0;
  const price = prices.length ? Math.min(...prices) : list;
  if (!(price > 0)) return null;
  const attrs = h.attributes ?? {};
  const make = String(Array.isArray(attrs.brand_name) ? attrs.brand_name[0] ?? "" : attrs.brand_name ?? "").trim();
  const g = (Array.isArray(attrs.gender) ? attrs.gender : [attrs.gender]).filter((x: unknown) => x && x !== "NA");
  return {
    brand: "thelasthunt",
    externalId: String(h.objectID),
    name: make && !title.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${title}` : title,
    url: `https://www.thelasthunt.com/p/${slug}`,
    imageUrl: typeof h.image_url === "string" ? h.image_url : null,
    price,
    listPrice: list > price ? list : null,
    inStock: Number(h.quantity_left) > 0,
    category: String(attrs.product_type_name ?? "").trim() || null,
    type: null,
    gender: g.length === 1 ? (g[0] === "Women" ? "kadin" : g[0] === "Men" ? "erkek" : null) : null,
    colorName: null,
    country: "CA",
    currency: "CAD",
  };
}

export async function thelasthuntUrl(url: string): Promise<LiveProduct | null> {
  const slug = thelasthuntSlugFromUrl(url);
  if (!slug) return null;
  // The slug's tail is "<brand code>-<style code>"; searching the style code finds the record.
  const body = await algolia("2YG4O6L95L", "e8b31524fd0d708f603240f2bfaec48a", "PRODUCTS_TLH_en-CA_bestSeller", {
    query: slug.split("-").pop() ?? slug,
    hitsPerPage: "10",
    attributesToRetrieve: "objectID,slug,name,image_url,quantity_left,price,original_price,attributes.gender,attributes.brand_name,attributes.product_type_name",
    attributesToHighlight: "",
  });
  return mapLastHuntHits(body, slug);
}
