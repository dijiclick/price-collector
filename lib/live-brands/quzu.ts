/**
 * QUZU by url (`quzu.com.tr/products/<handle>`, also under a
 * `/collections/<c>/products/<handle>` path). Shopify's `/products/<handle>.js`
 * answers in MINOR units (kuruş) with per-variant `available`, through the
 * shared Shopify mapper; the id is Shopify's product id, as the collector's
 * (packages/collector/src/brands/quzu.ts). Women's-only label: gender is fixed.
 */
import type { LiveProduct } from "../live-lookup";
import { UA } from "../live-http";
import { mapShopifyJs } from "./shopify";
import type { ShopifySite } from "./shopify-sites";

const SITE = "https://quzu.com.tr";
const STORE: ShopifySite = { brand: "quzu", sites: { TR: SITE }, defaultGender: "kadin" };

export function quzuHandleFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)quzu\.com\.tr$/.test(u.hostname.toLowerCase())) return null;
  const h = u.pathname.match(/\/products\/([^/?#]+?)(?:\.js|\.json)?\/?$/)?.[1];
  return h ? decodeURIComponent(h) : null;
}

/** Map a `/products/<handle>.js` body. Pure. */
export function mapQuzuJs(p: any): LiveProduct | null {
  const r = mapShopifyJs(STORE, "TR", SITE, p);
  // "Mini Boy Etek" is a length, not kidswear: never trust the English heuristic here.
  return r ? { ...r, gender: "kadin" } : null;
}

export async function quzuUrl(url: string): Promise<LiveProduct | null> {
  const handle = quzuHandleFromUrl(url);
  if (!handle) return null;
  // Plain fetch, no proxy: the shop answers GitHub/Vercel (US) IPs directly in TRY.
  try {
    const r = await fetch(`${SITE}/products/${encodeURIComponent(handle)}.js`, {
      headers: { Accept: "application/json", "User-Agent": UA, cookie: "localization=TR" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    return mapQuzuJs(await r.json());
  } catch {
    return null;
  }
}
