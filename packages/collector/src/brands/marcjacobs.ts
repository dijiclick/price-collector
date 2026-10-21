/**
 * Marc Jacobs (US) — the Salesforce grid fragment, `Search-UpdateGrid`
 * (2026-10-18).
 *
 * marcjacobs.com is Cloudflare in front of Akamai Bot Manager: every page
 * answers a browser UA (and `okhttp`) from a GitHub runner with a 403. The
 * grid endpoint answers an Apple networking-stack User-Agent
 * (`CFNetwork/… Darwin/…`, what an iOS app's URLSession sends) with the full
 * server-rendered grid, from a runner and from our Hetzner box (probe
 * 39135356161). No cookies are needed, but Global-E picks the price list from
 * the IP; a `GlobalE_Data` cookie pins the US/USD list so a non-US egress
 * cannot hand back euros (the currency is also asserted on the page).
 *
 * `cgid=sale-view-all` is the "Marcdown" sale (~350 style-colours), 48 tiles a
 * page, `data-page-next` says whether there is another. Each tile carries a
 * `data-gtm-product` JSON (style-colour id, colour, stock) and the SFRA price
 * block: `price-strike content="595.00"` then the selling `content="446.25"`.
 * Kept only when sale < strike.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { attrOf, decodeEntities, jsonOf } from "./_sfcchtml";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "marcjacobs";

const SITE = "https://www.marcjacobs.com";
const PAGE = 48;
const CAP = 1500;
const MAX_REQ = 25;

export const MJ_HEADERS: Record<string, string> = {
  "User-Agent": "CFNetwork/1490.0.4 Darwin/23.2.0",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Cookie: `GlobalE_Data=${encodeURIComponent(JSON.stringify({ countryISO: "US", cultureCode: "en-US", currencyCode: "USD", apiVersion: "2.1.4" }))}`,
};

/**
 * Canada (2026-10-21): the same grid under the `en_CA` locale is the Canadian
 * price list in CAD ("CA$ 790.00" vs "$595.00" in the US — its own list, not a
 * conversion), PDPs under /ca-en/. The locale decides it whatever the cookie
 * says; the CA Global-E cookie is sent anyway and the page is checked for CA$.
 */
const globalE = (countryISO: string, cultureCode: string, currencyCode: string) =>
  `GlobalE_Data=${encodeURIComponent(JSON.stringify({ countryISO, cultureCode, currencyCode, apiVersion: "2.1.4" }))}`;
export const MJ_MARKETS: Partial<Record<CountryCode, { locale: string; headers: Record<string, string> }>> = {
  US: { locale: "en_US", headers: MJ_HEADERS },
  CA: { locale: "en_CA", headers: { ...MJ_HEADERS, "Accept-Language": "en-CA,en;q=0.9", Cookie: globalE("CA", "en-CA", "CAD") } },
};

export const gridUrl = (start: number, sz = PAGE, country: CountryCode = "US") =>
  `${SITE}/on/demandware.store/Sites-mjsfra-Site/${(MJ_MARKETS[country] ?? MJ_MARKETS.US!).locale}/Search-UpdateGrid?cgid=sale-view-all&start=${start}&sz=${sz}`;

const num = (v: unknown): number | null => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** One `prod-l-g-tile` chunk of the grid → a record, or null. Pure. */
export function mapMjTile(tile: string, country: CountryCode = "US"): ProductRecord | null {
  const gtm = jsonOf<any>(attrOf(tile, "data-gtm-product") ?? "");
  const id = String(gtm?.item_color_id ?? "").trim();
  if (!id) return null;
  const linkTag = tile.match(/<a class="tile-link"[^>]*>/)?.[0] ?? "";
  const href = attrOf(linkTag, "href") ?? "";
  const name = decodeEntities(String(attrOf(linkTag, "data-product-name") ?? gtm?.item_name ?? "")).trim();
  if (!name || !href) return null;
  const info = tile.slice(Math.max(0, tile.indexOf('class="tile-info"')));
  const strike = num(info.match(/class="price-strike"\s+content="([\d.]+)"/)?.[1]);
  const after = info.slice(info.indexOf("price-strike") + 12);
  const sale = num(after.match(/<span content="([\d.]+)"/)?.[1]);
  if (strike == null || sale == null || sale >= strike) return null;
  // Gallery: the first (largest) candidate of each srcset, MAIN first.
  const shots = [...tile.matchAll(/srcset="\s*([^"\s]+)/g)].map((m) => decodeEntities(m[1]).replace(/preset=PLP_\d+/, "preset=PLP_1000"));
  const hero = shots.find((u) => /\/Sequence\/MAIN\//.test(u)) ?? shots[0] ?? null;
  const cat = String(gtm?.item_category2 ?? "").trim();
  return {
    brand,
    country,
    externalId: id,
    name,
    url: href.startsWith("http") ? href : `${SITE}${href}`,
    imageUrl: hero,
    images: cleanGallery(shots, hero),
    price: toMinor(sale),
    listPrice: toMinor(strike),
    currency: COUNTRIES[country].currency,
    inStock: !/out of stock/i.test(String(gtm?.item_stock ?? "")),
    category: cat && cat !== "undefined" ? cat : null,
    gender: null,
    variants: null,
    groupKey: gtm?.item_master_id ? `marcjacobs:${gtm.item_master_id}` : null,
    colorName: gtm?.item_color ? titleCase(String(gtm.item_color)) : null,
  };
}

/** Split a grid page into tiles. */
export const tilesOf = (html: string): string[] => html.split('<div class="prod-l-g-tile"').slice(1);

export async function listProducts(country: CountryCode = "US"): Promise<ProductRecord[]> {
  const m = MJ_MARKETS[country];
  if (!m) return [];
  const byId = new Map<string, ProductRecord>();
  for (let start = 0, req = 0; req < MAX_REQ && byId.size < CAP; start += PAGE, req++) {
    if (req) await new Promise((r) => setTimeout(r, 800));
    const html = await getText(gridUrl(start, PAGE, country), { country, headers: m.headers, timeoutMs: 30_000 });
    if (req === 0 && /class="price-strike"[^<]*<span[^>]*>[^<]*<\/span>\s*(?:&euro;|€|£)/.test(html)) throw new Error(`marcjacobs/${country}: grid not priced in ${COUNTRIES[country].currency}`);
    if (req === 0 && country === "CA" && /class="price-strike"/.test(html) && !/Regular Price<\/span>\s*CA\$/.test(html)) throw new Error("marcjacobs/CA: grid not priced in CA$");
    const tiles = tilesOf(html);
    let fresh = 0;
    for (const t of tiles) {
      const r = mapMjTile(t, country);
      if (r && !byId.has(r.externalId)) {
        byId.set(r.externalId, r);
        fresh++;
      }
    }
    const next = html.match(/data-page-next="([^"]*)"/)?.[1];
    if (!tiles.length || !fresh || !next || next === "null") break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
