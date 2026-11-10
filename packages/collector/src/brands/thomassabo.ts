/**
 * THOMAS SABO (thomassabo.com) — jewellery, charms, watches, sunglasses.
 * Salesforce Commerce Cloud (SFRA) behind Cloudflare, no challenge.
 *
 * Route: `Search-UpdateGrid?cgid=<listing>&start=N&sz=48` with the XHR header
 * the site's own "load more" sends. `sz` is capped at 48 by the server (120 and
 * 1000 both answer 48). One site per currency: `TS_EURO` (EUR, every euro
 * country is a LOCALE of it: de_DE, de_AT, fr_FR, es_ES, fr_BE, en_NL, en_IT,
 * en_PT …) and `TS_CH` (CHF). The locale is in the URL, so a US runner is not
 * geo-redirected; `nl_NL` does not exist and silently answers the INT site, so
 * every tile is checked against the market's currency and `/EU/<locale>/` path
 * and the run throws when a page has tiles but none of ours.
 *
 * Listings: `outlet` (permanent, small — 57 tiles on 2026-11-10, 52 struck)
 * then `blackfriday` (seasonal — 1,286 tiles, 1,110 struck, mostly −25 %; it
 * answers an empty grid or an error outside the campaign, which just ends that
 * walk). Spain shows the Black Friday listing without struck prices (1 of 47
 * on its first page) — only rows with a struck price are kept, so ES is mostly
 * the outlet.
 *
 * A tile carries the price paid (`data-prod-price-local`), the struck price
 * (`oldprice-text`, formatted per locale: "98 €", "€ 1.490", "1 490 €",
 * "CHF 1’715") and `data-prod-availability`. Sold-out tiles show
 * "bald wieder verfügbar" and no struck price — they are dropped with the
 * other unreduced tiles. Ring/bracelet sizes are behind one request per
 * product (`Tile-LoadVariation`), so sizes are not collected.
 * `data-imp-master` is the model number shared by a product's platings/stones
 * ("2 Varianten" on the tile) → `groupKey`.
 *
 * Measured 2026-11-10 from this Mac (DE: 29 requests, 1,286+57 tiles) and from
 * a GitHub runner with the exact headers below — probe run 42801932996: all 9
 * markets 200, EUR (CHF for CH) and local `/EU/<locale>/pd/…` URLs.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { decodeEntities as baseDecode } from "./_sfcchtml";

/** Named entities the shared decoder lacks (ß, capitals — it lower-cases the name —, French/Spanish accents). */
const EXTRA: Record<string, string> = {
  szlig: "ß", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", Eacute: "É", Egrave: "È", Agrave: "À", Ccedil: "Ç", Ntilde: "Ñ",
  acirc: "â", icirc: "î", ocirc: "ô", ucirc: "û", ugrave: "ù", euml: "ë", iuml: "ï", oelig: "œ",
  rsquo: "’", lsquo: "‘", ndash: "–", mdash: "—", hellip: "…", deg: "°", iexcl: "¡", iquest: "¿",
};
const decodeEntities = (s: string): string => baseDecode(s.replace(/&([A-Za-z]+);/g, (m, e: string) => EXTRA[e] ?? m));

interface Site { site: string; locale: string; path: string; currency: string }

const HOST = "https://www.thomassabo.com";
const eu = (locale: string): Site => ({ site: "TS_EURO", locale, path: `/EU/${locale}`, currency: "EUR" });

export const THOMASSABO_SITES: Partial<Record<CountryCode, Site>> = {
  DE: eu("de_DE"),
  AT: eu("de_AT"),
  FR: eu("fr_FR"),
  ES: eu("es_ES"),
  BE: eu("fr_BE"),
  NL: eu("en_NL"),
  IT: eu("en_IT"),
  PT: eu("en_PT"),
  CH: { site: "TS_CH", locale: "de_CH", path: "/CH/de_CH", currency: "CHF" },
};

/** Deepest markdowns first; the seasonal listing fills the rest. */
const LISTINGS = ["outlet", "blackfriday"];
const PAGE = 48;
const MAX_PAGES = 34;
const CAP = 1500;

export function thomasSaboGridUrl(country: CountryCode, cgid: string, start: number): string | null {
  const s = THOMASSABO_SITES[country];
  if (!s) return null;
  return `${HOST}/on/demandware.store/Sites-${s.site}-Site/${s.locale}/Search-UpdateGrid?cgid=${encodeURIComponent(cgid)}&start=${start}&sz=${PAGE}`;
}

/** "98 €" / "€ 1.490" / "1 490 €" / "40,50 €" / "CHF 1’715" / "CHF 57.50" → major units. */
export function saboMoney(raw: string): number {
  const s = decodeEntities(raw).replace(/[^0-9.,]/g, "");
  if (!s) return NaN;
  const dec = s.match(/^(.*)[.,](\d{1,2})$/);
  const n = dec ? parseFloat(`${dec[1].replace(/[.,]/g, "")}.${dec[2]}`) : parseFloat(s.replace(/[.,]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

const attr = (block: string, name: string): string | null => {
  const m = block.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decodeEntities(m[1]).trim() : null;
};

/** Rebel at Heart is the men's line; watches and sunglasses say who they are for in the name, else unisex. */
function genderOf(line: string | null, group: string | null, name: string): ProductRecord["gender"] {
  if (/\b(herren|men|homme|hombre|him)\b/i.test(name)) return "erkek";
  if (/\b(damen|women|femme|mujer)\b/i.test(name)) return "kadin";
  if (line === "Rebel at Heart") return "erkek";
  if (group && /watches|eyewear/i.test(group)) return null;
  return "kadin";
}

export interface SaboPage { rows: ProductRecord[]; tiles: number; ours: number }

/** Parse one grid page. Pure. Keeps only this market's tiles with a struck price above the price paid. */
export function parseThomasSaboGrid(country: CountryCode, html: string): SaboPage {
  const s = THOMASSABO_SITES[country];
  const rows: ProductRecord[] = [];
  if (!s) return { rows, tiles: 0, ours: 0 };
  const blocks = html.split(/class="product-tile-item js-product-tile-selector"/).slice(1);
  let ours = 0;
  for (const block of blocks) {
    const id = attr(block, "data-variant-representative") ?? attr(block, "data-imp-id");
    const href = block.match(/<a href="([^"]+)"\s+class="[^"]*js-pdp-link/)?.[1];
    if (!id || !href) continue;
    const path = decodeEntities(href).split("?")[0];
    const currency = attr(block, "data-prod-currency") ?? attr(block, "data-currency");
    if (!path.startsWith(`${s.path}/`) || currency !== s.currency) continue;
    ours++;
    const paid = parseFloat(block.match(/class="price-text[^"]*"[^>]*?data-prod-price-local="([0-9.]+)"/)?.[1] ?? "");
    const was = saboMoney(block.match(/class="oldprice-text">([^<]+)</)?.[1] ?? "");
    if (!(paid > 0) || !(was > paid)) continue;
    const name = attr(block, "data-imp-name") ?? attr(block, "data-prod-name");
    if (!name) continue;
    const imgs = [...new Set([...block.matchAll(/data-src="(https:[^"]+)"/g)].map((m) => decodeEntities(m[1]).replace(/([?&]sw=)\d+/, "$1764")))];
    const line = attr(block, "data-imp-cat1");
    const group = attr(block, "data-prod-cat") ?? null;
    const master = attr(block, "data-imp-master");
    rows.push({
      brand: "thomassabo",
      country,
      externalId: id,
      name,
      url: `${HOST}${path}`,
      imageUrl: imgs[0] ?? null,
      images: cleanGallery(imgs, imgs[0] ?? null),
      price: toMinor(paid),
      listPrice: toMinor(was),
      currency: s.currency,
      inStock: attr(block, "data-prod-availability") !== "false" && !block.includes("out-of-stock-text"),
      category: attr(block, "data-imp-cat3") || null,
      gender: genderOf(line, group, name),
      variants: null,
      groupKey: master ? `thomassabo:${master}` : null,
      colorName: null,
    });
  }
  return { rows, tiles: blocks.length, ours };
}

const pause = () => new Promise((r) => setTimeout(r, 500));

export async function listThomasSabo(country: CountryCode): Promise<ProductRecord[]> {
  const s = THOMASSABO_SITES[country];
  if (!s) return [];
  const byId = new Map<string, ProductRecord>();
  let first = true;
  for (const cgid of LISTINGS) {
    for (let page = 0; page < MAX_PAGES && byId.size < CAP; page++) {
      let parsed: SaboPage;
      try {
        if (!first) await pause();
        const html = await getText(thomasSaboGridUrl(country, cgid, page * PAGE)!, {
          country,
          timeoutMs: 45_000,
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            "Accept-Language": `${s.locale.replace("_", "-")},${s.locale.slice(0, 2)};q=0.9`,
            Referer: `${HOST}${s.path}/${cgid}`,
          },
        });
        parsed = parseThomasSaboGrid(country, html);
        // Tiles, but none in this market's currency/locale: another storefront answered.
        if (first && parsed.tiles > 0 && parsed.ours === 0) throw new Error(`thomassabo ${country}: grid answered another storefront`);
      } catch (e) {
        if (first) throw e;
        break;
      }
      first = false;
      for (const r of parsed.rows) if (!byId.has(r.externalId)) byId.set(r.externalId, r);
      if (parsed.tiles < PAGE) break;
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
