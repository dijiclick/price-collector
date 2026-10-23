/**
 * Nişantaşı Shoes by url (`nisantasishoes.com/products/<handle>`, also under a
 * `/collections/<c>/products/<handle>` path). Shopify's `/products/<handle>.js`
 * answers in MINOR units (kuruş) with per-variant `available` and the product's
 * tags; the id is Shopify's product id, as the collector's
 * (packages/collector/src/brands/nisantasishoes.ts).
 *
 * The shop never sets a compare-at price. Its reductions are BASKET discounts
 * the theme prints under the shelf price ("Sepette %20 İndirim" + the basket
 * price), driven by product tags — measured on 37 product pages across every
 * tag group (2026-10-23):
 *   - `indirimNN`  → NN % off (5, 10, 20, 25, 30, 40, 50 seen),
 *   - else `KIŞK` (the winter season) → 5 % off,
 *   - else (summer `YAZK` / untagged) → no reduction.
 * The basket price is the shelf price × (100 − NN) / 100, rounded half-up to
 * the kuruş (1.469,90 at 25 % → 1.102,43). As with DeFacto / LCW / Altınbaş,
 * the basket price is stored as the price and the shelf price as the list price.
 */
import type { LiveProduct } from "../live-lookup";
import { UA } from "../live-http";
import { mapShopifyJs } from "./shopify";
import type { ShopifySite } from "./shopify-sites";

const SITE = "https://www.nisantasishoes.com";
const STORE: ShopifySite = { brand: "nisantasishoes", sites: { TR: SITE }, defaultGender: "kadin" };

/** The basket discount (whole percent) the theme shows for these tags, or 0. Pure. */
export function basketPercent(tags: unknown): number {
  const list: string[] = Array.isArray(tags) ? tags.map(String) : typeof tags === "string" ? tags.split(",") : [];
  for (const t of list) {
    const m = t.trim().match(/^indirim(\d{1,2})$/i);
    if (m && Number(m[1]) > 0) return Number(m[1]);
  }
  return list.some((t) => t.trim() === "KIŞK") ? 5 : 0;
}

/** Shelf price (kuruş) → basket price (kuruş), half-up like the shop's own label. Pure. */
export const basketPrice = (shelf: number, pct: number): number => Math.round((shelf * (100 - pct)) / 100);

export function nisantasiHandleFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)nisantasishoes\.com$/.test(u.hostname.toLowerCase())) return null;
  const h = u.pathname.match(/\/products\/([^/?#]+?)(?:\.js|\.json)?\/?$/)?.[1];
  return h ? decodeURIComponent(h) : null;
}

/** Map a `/products/<handle>.js` body. Pure. */
export function mapNisantasiJs(p: any): LiveProduct | null {
  const r = mapShopifyJs(STORE, "TR", SITE, p);
  if (!r) return null;
  const pct = basketPercent(p?.tags);
  const shelf = r.price;
  return {
    ...r,
    price: pct ? basketPrice(shelf, pct) : shelf,
    listPrice: pct ? r.listPrice ?? shelf : r.listPrice,
    category: r.category ? r.category.replace(/_/g, " ") : null,
    // Women's shoes and bags only; every title says "Kadın".
    gender: "kadin",
  };
}

export async function nisantasishoesUrl(url: string): Promise<LiveProduct | null> {
  const handle = nisantasiHandleFromUrl(url);
  if (!handle) return null;
  // Plain fetch, no proxy (Turkey rule): the shop answers GitHub/Vercel (US) IPs directly in TRY.
  try {
    const r = await fetch(`${SITE}/products/${encodeURIComponent(handle)}.js`, {
      headers: { Accept: "application/json", "User-Agent": UA, cookie: "localization=TR" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    return mapNisantasiJs(await r.json());
  } catch {
    return null;
  }
}
