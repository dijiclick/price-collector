/**
 * Marc Jacobs (US) by url (`marcjacobs.com/us-en/<slug>/<style>-<colour>.html`).
 * The storefront's own SFRA `Product-Variation` JSON, asked with an Apple
 * networking-stack User-Agent (`CFNetwork/…`) — the only one marcjacobs.com's
 * Cloudflare/Akamai pair lets through to the controllers — and a Global-E
 * cookie that pins the US/USD price list (packages/collector/src/brands/
 * marcjacobs.ts). The id is the style-colour, as the collector stores it.
 */
import type { LiveProduct } from "../live-lookup";
import { countryFor, json } from "../live-http";
import { mapSfccVariation, type SfccShop } from "./_sfccvariation";

export const MARCJACOBS_SHOP: SfccShop = { brand: "marcjacobs", web: "https://www.marcjacobs.com", site: "Sites-mjsfra-Site/en_US" };

const HEADERS: Record<string, string> = {
  "User-Agent": "CFNetwork/1490.0.4 Darwin/23.2.0",
  "X-Requested-With": "XMLHttpRequest",
  Accept: "application/json",
  Cookie: `GlobalE_Data=${encodeURIComponent(JSON.stringify({ countryISO: "US", cultureCode: "en-US", currencyCode: "USD", apiVersion: "2.1.4" }))}`,
};

export function marcjacobsIdFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)marcjacobs\.com$/i.test(u.hostname)) return null;
  return u.pathname.match(/\/([A-Z0-9]{8,}-[A-Z0-9]{3})\.html$/i)?.[1]?.toUpperCase() ?? null;
}

export async function marcjacobsUrl(url: string): Promise<LiveProduct | null> {
  const id = marcjacobsIdFromUrl(url);
  if (!id) return null;
  const body = await json<any>(
    `${MARCJACOBS_SHOP.web}/on/demandware.store/${MARCJACOBS_SHOP.site}/Product-Variation?pid=${encodeURIComponent(id)}`,
    HEADERS,
    countryFor("marcjacobs", "US"),
  );
  if (!body) return null;
  if (body?.product?.price?.sales?.currency && body.product.price.sales.currency !== "USD") return null;
  const r = mapSfccVariation(MARCJACOBS_SHOP, body, url.split(/[?#]/)[0], id, JSON.stringify(body), false);
  // The variation's image block has no absolute url; the media server builds
  // every photo from the style and colour codes, as the grid does.
  return r && !r.imageUrl ? { ...r, imageUrl: marcjacobsImage(id) } : r;
}

export function marcjacobsImage(id: string): string {
  const [style, colour] = id.split("-");
  return `https://media.marcjacobs.com/match/Product_Style_Code/${style}/NRF/${colour}/Sequence/MAIN/?preset=PLP_1000`;
}
