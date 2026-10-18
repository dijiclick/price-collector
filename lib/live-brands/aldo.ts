/**
 * ALDO Turkey by url (`www.aldoshoes.com.tr/products/<handle>`, also under a
 * `/collections/<c>/products/<handle>` path). Shopify's `/products/<handle>.js`
 * answers in MINOR units (kuruş) with per-variant `available`, through the
 * shared Shopify mapper; the id is Shopify's product id, as the collector's
 * (packages/collector/src/brands/aldo.ts). Only the Turkish shop — the US/CA
 * aldoshoes.com is a different Shopify store with other ids.
 */
import type { LiveProduct } from "../live-lookup";
import { UA } from "../live-http";
import { mapShopifyJs } from "./shopify";
import type { ShopifySite } from "./shopify-sites";

const SITE = "https://www.aldoshoes.com.tr";
const STORE: ShopifySite = { brand: "aldo", sites: { TR: SITE } };

export function aldoHandleFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)aldoshoes\.com\.tr$/.test(u.hostname.toLowerCase())) return null;
  const h = u.pathname.match(/\/products\/([^/?#]+?)(?:\.js|\.json)?\/?$/)?.[1];
  return h ? decodeURIComponent(h) : null;
}

const fold = (s: string) =>
  s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").replace(/[Şş]/g, "s").toLowerCase();

/** Gender from the `Kadın > Ayakkabılar > …` type path, else the title. Same rule as the collector. */
function aldoGender(p: any): LiveProduct["gender"] {
  for (const s of String(p?.type ?? "").split(">").map((x) => fold(x.trim()))) {
    if (/^(cocuk|kiz cocuk|erkek cocuk)$/.test(s)) return "cocuk";
    if (s === "kadin") return "kadin";
    if (s === "erkek") return "erkek";
  }
  const t = fold(String(p?.title ?? ""));
  if (/\bunisex\b/.test(t)) return null;
  if (/\bcocuk\b/.test(t)) return "cocuk";
  if (/\bkadin\b/.test(t)) return "kadin";
  if (/\berkek\b/.test(t)) return "erkek";
  return null;
}

/** Map a `/products/<handle>.js` body. Pure. */
export function mapAldoJs(p: any): LiveProduct | null {
  const r = mapShopifyJs(STORE, "TR", SITE, p);
  return r ? { ...r, gender: aldoGender(p) } : null;
}

export async function aldoUrl(url: string): Promise<LiveProduct | null> {
  const handle = aldoHandleFromUrl(url);
  if (!handle) return null;
  // Plain fetch, no proxy: the shop answers GitHub/Vercel (US) IPs directly in TRY.
  try {
    const r = await fetch(`${SITE}/products/${encodeURIComponent(handle)}.js`, {
      headers: { Accept: "application/json", "User-Agent": UA, cookie: "localization=TR" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    return mapAldoJs(await r.json());
  } catch {
    return null;
  }
}
