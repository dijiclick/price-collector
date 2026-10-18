/**
 * Daniel Wellington Türkiye by url (`tr.danielwellington.com/products/<handle>`,
 * also via `/collections/<c>/products/<handle>`). Shopify's
 * `/products/<handle>.js` answers in MINOR units; the generic Shopify mapper
 * does the rest. Two DW rules on top, the same as the collector's:
 * a gift set's compare-at is the sum of its parts, not a former price, so it
 * is never quoted; and a watch's title gets "Kol Saati" so it is filed as one.
 */
import type { LiveProduct } from "../live-lookup";
import { UA } from "../live-http";
import { mapShopifyJs } from "./shopify";
import type { ShopifySite } from "./shopify-sites";

const SITE = "https://tr.danielwellington.com";
const STORE: ShopifySite = { brand: "danielwellington", sites: { TR: SITE } };

const SHELF: Record<string, string> = {
  watch: "Saat",
  "smartwatch strap": "Saat Kordonu",
  strap: "Saat Kordonu",
  "watch-charm": "Saat Aksesuarı",
  "watch case": "Saat Kutusu",
  bracelet: "Bileklik",
  necklace: "Kolye",
  earrings: "Küpe",
  ring: "Yüzük",
  charm: "Charm",
  "jewelry box": "Takı Kutusu",
};

export function danielwellingtonHandleFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname.toLowerCase() !== "tr.danielwellington.com") return null;
  const h = u.pathname.match(/\/products\/([^/?#]+?)(?:\.js|\.json)?\/?$/)?.[1];
  return h ? decodeURIComponent(h) : null;
}

/** Map a `/products/<handle>.js` body. Pure. */
export function mapDanielWellingtonJs(p: any): LiveProduct | null {
  const r = mapShopifyJs(STORE, "TR", SITE, p);
  if (!r) return null;
  const type = String(p?.type ?? "").trim().toLowerCase();
  const tags: string[] = Array.isArray(p?.tags) ? p.tags.map((t: unknown) => String(t).toLowerCase()) : [];
  const bundle =
    /gift ?set|bundle/.test(type) ||
    tags.includes("bundle") ||
    (p?.variants ?? []).some((v: any) => String(v?.sku ?? "").includes("|"));
  return {
    ...r,
    name: type === "watch" && !/watch|saat/i.test(r.name) ? `${r.name} Kol Saati` : r.name,
    category: SHELF[type] ?? r.category,
    gender: tags.includes("female") ? "kadin" : tags.includes("male") ? "erkek" : r.gender,
    listPrice: bundle ? null : r.listPrice,
  };
}

export async function danielwellingtonUrl(url: string): Promise<LiveProduct | null> {
  const handle = danielwellingtonHandleFromUrl(url);
  if (!handle) return null;
  // Direct, like the other Shopify stores: it answers US egress (probe run 39124158963).
  try {
    const r = await fetch(`${SITE}/products/${encodeURIComponent(handle)}.js`, {
      headers: { Accept: "application/json", "User-Agent": UA, cookie: "localization=TR" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    return mapDanielWellingtonJs(await r.json());
  } catch {
    return null;
  }
}
