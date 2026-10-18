/**
 * Les Benjamins by url (`lesbenjamins.com/products/<handle>`, also under a
 * `/collections/<c>/products/<handle>` path). Shopify's `/products/<handle>.js`
 * answers in MINOR units (kuruş, the shop prices in TRY) with per-variant
 * `available`, through the shared Shopify mapper; the id is Shopify's product
 * id, as the collector's (packages/collector/src/brands/lesbenjamins.ts).
 */
import type { LiveProduct } from "../live-lookup";
import { UA } from "../live-http";
import { mapShopifyJs } from "./shopify";
import type { ShopifySite } from "./shopify-sites";

const SITE = "https://lesbenjamins.com";
const STORE: ShopifySite = { brand: "lesbenjamins", sites: { TR: SITE } };

export function lesbenjaminsHandleFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)lesbenjamins\.com$/.test(u.hostname.toLowerCase())) return null;
  const h = u.pathname.match(/\/products\/([^/?#]+?)(?:\.js|\.json)?\/?$/)?.[1];
  return h ? decodeURIComponent(h) : null;
}

/** Plain `women` / `men` / `unisex` / `kids` tags; both men and women = unisex. Same rule as the collector. */
function lbGender(p: any): LiveProduct["gender"] {
  const raw: string[] = Array.isArray(p?.tags) ? p.tags : typeof p?.tags === "string" ? p.tags.split(",") : [];
  const tags = new Set(raw.map((t) => String(t).trim().toLowerCase()));
  if (tags.has("kids")) return "cocuk";
  const w = tags.has("women");
  const m = tags.has("men");
  if (tags.has("unisex") || (w && m)) return null;
  return w ? "kadin" : m ? "erkek" : null;
}

/** Map a `/products/<handle>.js` body. Pure. */
export function mapLesbenjaminsJs(p: any): LiveProduct | null {
  const r = mapShopifyJs(STORE, "TR", SITE, p);
  return r ? { ...r, gender: lbGender(p) } : null;
}

export async function lesbenjaminsUrl(url: string): Promise<LiveProduct | null> {
  const handle = lesbenjaminsHandleFromUrl(url);
  if (!handle) return null;
  // Plain fetch, no proxy: the shop answers GitHub/Vercel (US) IPs directly in TRY.
  try {
    const r = await fetch(`${SITE}/products/${encodeURIComponent(handle)}.js`, {
      headers: { Accept: "application/json", "User-Agent": UA, cookie: "localization=TR" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    return mapLesbenjaminsJs(await r.json());
  } catch {
    return null;
  }
}
