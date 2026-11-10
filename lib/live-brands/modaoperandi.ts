/**
 * Moda Operandi by url (`modaoperandi.com/<women|men>/p/<designer>/<slug>/<variant id>`).
 * One record of the site's public Algolia index (the collector's source,
 * packages/collector/src/brands/modaoperandi.ts) by objectID `201-<variant id>`.
 * A link carries no market, so the quote is the US price list (USD).
 */
import type { LiveProduct } from "../live-lookup";
import { UA } from "../live-http";

const APP_ID = "Z8CHXVEJ2D";
const SEARCH_KEY = "51e8050565d2891eb06cf113aefd3f8d";
const INDEX = "Search_production_by_inventory_available";

export function modaIdFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)modaoperandi\.com$/i.test(u.hostname)) return null;
  return u.pathname.match(/^\/(?:women|men)\/p\/[^/]+\/[^/]+\/(\d{4,})\/?$/i)?.[1] ?? null;
}

/** Map one index record. Pure. */
export function mapModaProduct(h: any, id: string, url: string): LiveProduct | null {
  const title = String(h?.name ?? "").trim();
  if (!h || String(h.variant_id) !== id || !title) return null;
  const own = (Array.isArray(h.variants_data) ? h.variants_data : []).find((v: any) => String(v?.id) === id);
  const regular = Math.round(Number(own?.retail_price_usd) * 100);
  const marked = Math.round(Number(h.markdown_price_usd) * 100);
  const price = marked > 0 ? marked : regular;
  if (!(price > 0)) return null;
  const make = String(h.designer_name ?? "").trim();
  const cats = String(h.gender_cat_subcat_attrs ?? "").split("|").filter(Boolean);
  const section = String(h.href ?? "").split("/")[1];
  return {
    brand: "modaoperandi",
    externalId: id,
    name: make && !title.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${title}` : title,
    url,
    imageUrl: typeof h.master_preview_image_url === "string" ? h.master_preview_image_url.replace(/\/([^/?]+\.jpe?g)(\?.*)?$/i, "/large_$1$2") : null,
    price,
    listPrice: regular > price ? regular : null,
    inStock: Number(h.availability) === 1 && own?.sold_out !== true,
    category: cats.length > 1 ? cats[cats.length - 1].replace(/[-_]/g, " ") : null,
    type: null,
    gender: section === "men" ? "erkek" : section === "women" ? "kadin" : null,
    colorName: typeof h.color === "string" && h.color.trim() ? h.color.trim() : null,
    country: "US",
    currency: "USD",
  };
}

export async function modaoperandiUrl(url: string): Promise<LiveProduct | null> {
  const id = modaIdFromUrl(url);
  if (!id) return null;
  const clean = (() => { const u = new URL(url); u.search = ""; u.hash = ""; return u.toString(); })();
  try {
    const r = await fetch(`https://${APP_ID}-dsn.algolia.net/1/indexes/${INDEX}/201-${id}`, {
      headers: { Accept: "application/json", "User-Agent": UA, "X-Algolia-Application-Id": APP_ID, "X-Algolia-API-Key": SEARCH_KEY },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    return mapModaProduct(await r.json(), id, clean);
  } catch (err) {
    console.warn(`live-lookup: moda operandi index unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
