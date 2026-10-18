/**
 * GUESS United States by url (`guess.com/en-us/…/<STYLE>-<COLOR>.html`). The
 * US site's own Algolia app (P3GWXCPFXL, index production__products__en_US —
 * not the EU app guess.eu uses), read by objectID, as the collector does
 * (packages/collector/src/brands/guess-us.ts). guess.com itself geo-redirects
 * non-US visitors; Algolia does not.
 */
import type { LiveProduct } from "../live-lookup";
import { countryFor, json, toMinor } from "../live-http";

const APP_ID = "P3GWXCPFXL";
const HEADERS = { "X-Algolia-Application-Id": APP_ID, "X-Algolia-API-Key": "e88593fcd7b28159782cd8ece0c3860d" };

export function guessUsIdFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)guess\.com$/i.test(u.hostname) || !/^\/en-us\//i.test(u.pathname)) return null;
  return u.pathname.match(/\/([A-Z0-9]{6,}-[A-Z0-9]{2,})\.html$/i)?.[1]?.toUpperCase() ?? null;
}

/** Map one en_US hit; full price resolves too (listPrice null). Pure. */
export function mapGuessUsHit(h: any): LiveProduct | null {
  const price = Number(h?.master_price);
  if (!h?.objectID || !h?.name || !Number.isFinite(price) || price <= 0) return null;
  if (h.currencyCode && h.currencyCode !== "USD") return null;
  const retail = Number(h.master_price_retail);
  const g = String(h.guess_gender ?? "").toLowerCase();
  return {
    brand: "guess",
    externalId: String(h.objectID),
    name: String(h.name).trim(),
    url: h.url ? `https://www.guess.com${h.url}` : "https://www.guess.com/en-us/",
    imageUrl: `https://img.guess.com/image/upload/f_auto,q_auto,fl_strip_profile,w_640,ar_2:3,c_fill/v1/NA/Style/ECOMM/${h.objectID}`,
    price: toMinor(price),
    listPrice: Number.isFinite(retail) && retail > price ? toMinor(retail) : null,
    inStock: h.in_stock !== false,
    category: null,
    type: null,
    gender: g.includes("junior") ? "cocuk" : g === "women" ? "kadin" : g === "men" ? "erkek" : null,
    colorName: h.guess_colorDisplayName ?? h.color ?? null,
    country: "US",
    currency: "USD",
  };
}

export async function guessUsUrl(url: string): Promise<LiveProduct | null> {
  const id = guessUsIdFromUrl(url);
  if (!id) return null;
  const h = await json<any>(
    `https://${APP_ID}-dsn.algolia.net/1/indexes/production__products__en_US/${encodeURIComponent(id)}`,
    HEADERS,
    countryFor("guess", "US"),
  );
  return h ? mapGuessUsHit(h) : null;
}
