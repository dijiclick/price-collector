/**
 * Parfois (parfois.com) — Portuguese bags/accessories/clothing chain, Salesforce
 * Commerce Cloud (SFRA) with Constructor.io search.
 *
 * Constructor's index (key_rUB94w6uACGrInGl) carries no prices, so the feed is
 * the storefront's own infinite-scroll endpoint, `Search-UpdateGrid`, which
 * returns the product tiles as HTML: 200 from a GitHub runner through
 * Cloudflare with a plain browser UA (probe run 39612079467, 2026-10-21).
 *
 * The markdown shelf is "Special Prices" (`cgid=2919`, "Saldos" sort rule):
 * every tile there shows a struck `strike-through list` price and a `sales`
 * price. (The "REBAJAS" group, 3150, is a seasonal label and currently shows
 * full prices — not read.) One tile = one style in one colour (`data-pid`
 * 249584_BN). The grid lists only sellable styles, so a tile is in stock; the
 * quick-buy buttons give per-size stock where the style has sizes
 * (`lastUnits` = low stock).
 *
 * One SFCC site serves several markets, each with its own locale, URL prefix
 * and price book (all EUR): PAR_ES (es_ES), PAR_PT (pt_PT), PAR_SE (fr_FR,
 * it_IT, en_NL, fr_BE, en_IE) and PAR_NE (de_DE, de_AT, en_FI). Verified from
 * the Mac 2026-10-21; same category id everywhere.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { attrOf, decodeEntities, jsonOf } from "./_sfcchtml";

const ORIGIN = "https://www.parfois.com";
const CGID = "2919";
const PAGE = 100;
const MAX_PAGES = 15;
const CAP = 1500;
const PAUSE_MS = Number(process.env.PARFOIS_PAUSE_MS ?? 400);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Market {
  site: string;
  locale: string;
  /** Storefront path prefix, `/<lang>/<country>`. */
  path: string;
}

export const PARFOIS_MARKETS: Partial<Record<CountryCode, Market>> = {
  ES: { site: "PAR_ES", locale: "es_ES", path: "/es/es" },
  PT: { site: "PAR_PT", locale: "pt_PT", path: "/pt/pt" },
  FR: { site: "PAR_SE", locale: "fr_FR", path: "/fr/fr" },
  IT: { site: "PAR_SE", locale: "it_IT", path: "/it/it" },
  NL: { site: "PAR_SE", locale: "en_NL", path: "/en/nl" },
  BE: { site: "PAR_SE", locale: "fr_BE", path: "/fr/be" },
  IE: { site: "PAR_SE", locale: "en_IE", path: "/en/ie" },
  DE: { site: "PAR_NE", locale: "de_DE", path: "/de/de" },
  AT: { site: "PAR_NE", locale: "de_AT", path: "/de/at" },
  FI: { site: "PAR_NE", locale: "en_FI", path: "/en/fi" },
};

export const gridUrl = (m: Market, start: number): string =>
  `${ORIGIN}/on/demandware.store/Sites-${m.site}-Site/${m.locale}/Search-UpdateGrid?cgid=${CGID}&start=${start}&sz=${PAGE}`;

const TILE = '<div class="product js_product"';
const clean = (s: unknown): string => (typeof s === "string" ? decodeEntities(s).replace(/\s+/g, " ").trim() : "");
const num = (s: string | undefined): number => (s ? parseFloat(s) : NaN);

/** Split a grid page into its product tiles. Pure. */
export function parfoisTiles(html: string): string[] {
  return html.split(TILE).slice(1).map((t) => TILE + t);
}

/** One tile → a record, or null when it carries no struck price. Pure. */
export function mapParfoisTile(tile: string, country: CountryCode = "ES"): ProductRecord | null {
  const head = tile.slice(0, tile.indexOf(">") + 1);
  const pid = attrOf(head, "data-pid");
  const name = clean(attrOf(head, "data-cnstrc-item-name"));
  const was = num(tile.match(/strike-through list"[^>]*>\s*<span class="value" content="([0-9.]+)"/)?.[1]);
  const price = num(tile.match(/class="sales"[^>]*>\s*<span class="value" content="([0-9.]+)"/)?.[1]);
  if (!pid || !name || !Number.isFinite(price) || price <= 0 || !Number.isFinite(was) || was <= price) return null;
  const href = tile.match(/<a class="js_click_detail[^"]*"[^>]*\shref="([^"]+)"/)?.[1];
  if (!href) return null;
  const gtm = jsonOf<any>(attrOf(head, "data-gtmdata") ?? "")?.ecommerce?.items?.[0] ?? {};
  const imgs = jsonOf<any[]>(decodeEntities(tile.match(/var images = "(\[[^"]*\])"/)?.[1] ?? "")) ?? [];
  const images = cleanGallery(imgs.map((i) => i?.url));
  const sizes: SizeVariant[] = [];
  for (const m of tile.matchAll(/<button class="[^"]*js-plp-quick-buy[^"]*"[^>]*>\s*<span class="(notLastUnits|lastUnits)">([^<]*)<\/span>/g)) {
    const label = clean(m[2]);
    if (label && !sizes.some((s) => s.label === label)) sizes.push({ label, availability: m[1] === "lastUnits" ? "low_on_stock" : "in_stock" });
  }
  const style = pid.split("_")[0];
  // The tile's own colour is the swatch whose value is the pid's suffix ("_BN").
  const code = pid.slice(style.length).replace(/[^A-Za-z0-9_]/g, "");
  const color = code ? clean(tile.match(new RegExp(`data-color-value="${code}"[^>]*?data-color-display="([^"]*)"`))?.[1] ?? "") : "";
  return {
    brand: "parfois",
    country,
    externalId: pid,
    name,
    url: `${ORIGIN}${decodeEntities(href)}`,
    imageUrl: images?.[0] ?? null,
    images,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: "EUR",
    inStock: true,
    category: clean(gtm.item_category2) || clean(gtm.item_category) || clean(decodeEntities(href).split("/")[3]) || null,
    gender: "kadin",
    variants: { colors: color ? [color] : [], sizes },
    groupKey: `parfois-${style}`,
    colorName: color || null,
  };
}

/** Register as `listParfois(country)`. ES, PT, FR, IT, NL, BE, IE, DE, AT, FI. */
export async function listParfois(country: CountryCode): Promise<ProductRecord[]> {
  const m = PARFOIS_MARKETS[country];
  if (!m) return [];
  const byId = new Map<string, ProductRecord>();
  for (let page = 0; page < MAX_PAGES && byId.size < CAP; page++) {
    if (page > 0) await sleep(PAUSE_MS);
    const html = await getText(gridUrl(m, page * PAGE), { country, timeoutMs: 60_000 });
    const tiles = parfoisTiles(html);
    for (const t of tiles) {
      const r = mapParfoisTile(t, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (tiles.length < PAGE) break;
  }
  return [...byId.values()].slice(0, CAP);
}
