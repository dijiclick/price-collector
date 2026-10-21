/**
 * Pasted links for every Shopify store in ./shopify-sites.ts (2026-10-11).
 * `/products/<handle>.js` answers the product with prices in MINOR units plus
 * per-variant `available` — the same route derimod.ts uses. The market is the
 * one whose site host the link is on, so the currency is always the shop's own.
 */
import type { LiveProduct } from "../live-lookup";
import { COUNTRIES, type CountryCode } from "../countries";
import { UA } from "../live-http";
import type { ShopifySite } from "./shopify-sites";
import { ALL_SHOPIFY as SHOPIFY_STORES } from "./shopify-all";

const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");

/** The store, market and handle a link points at, or null. */
export function shopifyTarget(url: string): { store: ShopifySite; country: CountryCode; site: string; handle: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = bare(u.hostname);
  for (const store of SHOPIFY_STORES) {
    for (const [cc, site] of Object.entries(store.sites) as [CountryCode, string][]) {
      if (bare(new URL(site).hostname) !== host) continue;
      const h = u.pathname.match(/\/products\/([^/?#]+?)(?:\.js|\.json)?\/?$/)?.[1];
      return h ? { store, country: cc, site, handle: decodeURIComponent(h) } : null;
    }
  }
  return null;
}

/** Map a `/products/<handle>.js` body. Pure. */
export function mapShopifyJs(store: ShopifySite, country: CountryCode, site: string, p: any): LiveProduct | null {
  const vs: any[] = p?.variants ?? [];
  if (!p?.id || !p?.title) return null;
  const buyable = vs.filter((v) => v?.available === true && Number(v.price) > 0);
  const pool = (buyable.length ? buyable : vs).filter((v) => Number(v?.price) > 0);
  const pick = [...pool].sort((a, b) => Number(a.price) - Number(b.price))[0];
  const price = Math.round(Number(pick?.price ?? p.price));
  if (!Number.isFinite(price) || price <= 0) return null;
  const cmp = Math.round(Number(pick?.compare_at_price ?? p.compare_at_price));
  const colourIdx = (p.options ?? []).findIndex((o: any) => /renk|colou?r|shade/i.test(String(o?.name ?? o)));
  const colours = colourIdx >= 0 ? [...new Set(vs.map((v) => v?.[`option${colourIdx + 1}`]).filter(Boolean))] : [];
  const img = typeof p.featured_image === "string" ? p.featured_image : p.images?.[0];
  const t = `${Array.isArray(p.tags) ? p.tags.join(" ") : String(p.tags ?? "")} ${p.type ?? ""} ${p.title}`.toLowerCase();
  const gender = /\b(kids?|girls?|boys?|baby)\b/.test(t) ? "cocuk" : /\b(wom[ae]n'?s?|ladies)\b/.test(t) ? "kadin" : /\b(m[ae]n'?s?)\b/.test(t) ? "erkek" : store.defaultGender ?? null;
  const type = typeof p.type === "string" ? p.type.split(">").pop()!.trim() : "";
  return {
    brand: store.brand,
    externalId: String(p.id),
    name: String(p.title).trim(),
    url: `${site}/products/${p.handle}`,
    imageUrl: typeof img === "string" ? (img.startsWith("//") ? `https:${img}` : img) : null,
    price,
    listPrice: Number.isFinite(cmp) && cmp > price ? cmp : null,
    inStock: vs.length ? vs.some((v) => v?.available === true) : p.available === true,
    category: type || null,
    type: null,
    gender,
    colorName: colours.length === 1 ? String(colours[0]) : null,
    country,
    currency: COUNTRIES[country].currency,
  };
}

export async function shopifyUrl(url: string): Promise<LiveProduct | null> {
  const t = shopifyTarget(url);
  if (!t) return null;
  // Plain fetch, deliberately not live-http's json(): that one routes through
  // the paid proxy whenever it is configured, and these storefronts answer
  // directly (probe run 38118615770). Owner rule 2026-10-11: proxy only where
  // nothing else works.
  try {
    const r = await fetch(`${t.site}/products/${encodeURIComponent(t.handle)}.js`, {
      // Shopify Markets judges stock by the caller's country and Vercel runs in
      // the US — without this a store that ships only at home reads sold out.
      headers: { Accept: "application/json", "User-Agent": UA, cookie: `localization=${t.country}` },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    return mapShopifyJs(t.store, t.country, t.site, await r.json());
  } catch {
    return null;
  }
}

/** One resolver entry per Shopify brand, for EXTRA_RESOLVERS. */
export const SHOPIFY_RESOLVERS: Record<string, (url: string) => Promise<LiveProduct | null>> = Object.fromEntries(
  SHOPIFY_STORES.map((s) => [s.brand, shopifyUrl]),
);
