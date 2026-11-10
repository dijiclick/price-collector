/**
 * Parfumdreams Germany — the "SALE" rows of the /Angebote listing (2026-11-10).
 *
 * ROUTE. The listing is server-rendered: `https://www.parfumdreams.de/Angebote
 * ?AttPriceDisplayFlagsArray_ss=NearPriceSalesBadge&p=N` (the page's own "Sale"
 * filter; 30 tiles a page, "Seite 1 von 77", ~930 KB raw / ~80 KB gzip a page,
 * default order = most popular). Each tile is one product VARIATION (the
 * article's default size/shade) and carries its whole record as JSON in the
 * `data-props` attribute of its `data-behaviour="product-variation-view"` link:
 * brand lines, category 1–3, EAN, amount (`size` + `unit`), photo,
 * `retailPriceTC` (the price), `rrptc` (the maker's UVP the shop strikes),
 * `LowestPriceLast30DaysTC_f` (EU Omnibus), `available`, and the display flags.
 * A page past the end answers 200 with no tiles.
 *
 * WHAT COUNTS AS A DEAL. Nearly the whole catalogue sits under its UVP (12,865
 * of 23,733 variations are in /Angebote), so a price under UVP alone is not a
 * markdown. The shop's own SALE label is: "Angebote sind günstiger als der
 * niedrigste Preis, den wir für diesen Artikel innerhalb der letzten 30 Tage
 * verlangt haben" — flag `NearPriceSalesBadge`, 2,306 variations on 2026-11-10.
 * Only those rows are kept, and only while the 30-day lowest price is still
 * above the price. The struck price is the UVP, as the shop shows it (the
 * 30-day low is usually only cents above the price).
 *
 * MARKETS: Germany only. The country sites (.at .ch .fr .nl .be .it .es .pt,
 * all 200 to a runner, CHF on .ch) carry no 30-day lowest price (null on every
 * tile), their "UVP" is the German one converted (141.57, 144.64 …), and the
 * Sale flag covers almost everything there (AT: 17,280 variations; FR/NL/IT/ES/
 * PT have no Sale filter at all) — no way to tell a fresh markdown apart.
 *
 * RUNNER: probe run 42800512134 — page 1 and page 40 answer a GitHub runner
 * 200 via HAProxy with the full body (938,135 / 922,550 bytes; the Mac got
 * 931,762). The tiles start ~640 KB into the page, past what the probe keeps,
 * so the tile markup itself was read from the Mac.
 *
 * 60 pages (1,800 variations) a sweep, one request at a time.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { decodeEntities } from "./_sfcchtml";
import type { CountryCode } from "../../../../lib/countries";

const SITE = "https://www.parfumdreams.de";
const LISTING = `${SITE}/Angebote?AttPriceDisplayFlagsArray_ss=NearPriceSalesBadge`;
const SALE_FLAG = "NearPriceSalesBadge";
const MAX_PAGES = 60;
const CAP = 1800;
const PAUSE_MS = Number(process.env.PARFUMDREAMS_PAUSE_MS ?? 400);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const cents = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

export interface ParfumdreamsTile {
  href: string;
  props: any;
}

/** Every product tile of a listing page: its link and the decoded `data-props` JSON. Pure. */
export function parseTiles(html: string): ParfumdreamsTile[] {
  const out: ParfumdreamsTile[] = [];
  const re = /<a href="([^"]+)" data-behaviour="product-variation-view"[^>]*? data-props="([^"]*)"/g;
  for (const m of html.matchAll(re)) {
    try {
      const props = JSON.parse(decodeEntities(m[2]));
      if (props && typeof props === "object") out.push({ href: decodeEntities(m[1]), props });
    } catch {
      // a tile whose JSON does not parse is skipped
    }
  }
  return out;
}

/** "Seite 2 von 77" → 77; null when the pager is absent. */
export function pageCount(html: string): number | null {
  const m = html.match(/id="currentPage"[^>]*>[^<]*?(\d+)\s*<\/a>/);
  return m ? Number(m[1]) : null;
}

function genderOf(p: any): ProductRecord["gender"] {
  const c = `${clean(p.category2)} ${clean(p.category3)} ${clean(p.category1)} ${clean(p.brandLine2)}`.toLowerCase();
  if (/damen/.test(c)) return "kadin";
  if (/herren|männer/.test(c)) return "erkek";
  return null;
}

/** One tile → record, or null when it is not a row the shop itself labels SALE. Pure. */
export function mapTile(t: ParfumdreamsTile): ProductRecord | null {
  const p = t.props;
  const id = Number(p?.id);
  const article = Number(p?.idArticle);
  if (!Number.isInteger(id) || !Number.isInteger(article) || !t.href.startsWith("/")) return null;
  const flags: unknown[] = Array.isArray(p.PriceDisplayFlagsArray_ss) ? p.PriceDisplayFlagsArray_ss : [];
  if (!flags.includes(SALE_FLAG)) return null;
  const price = cents(p.retailPriceTC);
  const uvp = cents(p.rrptc);
  if (!(price > 0) || !(uvp > price)) return null;
  // EU Omnibus: a row that was already this cheap within 30 days is not a fresh markdown.
  const low = cents(p.LowestPriceLast30DaysTC_f);
  if (Number.isFinite(low) && low > 0 && low <= price) return null;
  // A multi-pack ("quantity" > 1) is priced against a single unit's UVP.
  if (Number(p.quantity ?? 1) !== 1) return null;

  const maker = clean(p.ProductBrandUi_s) || clean(p.brandLine1);
  const line = clean(p.ProductNameUi_s) || clean(p.brandLine3);
  const type = clean(p.articleDescription) || clean(p.ProductTypeUi_s);
  const amount = Number(p.size) > 0 && clean(p.unit) ? `${String(p.size).replace(".", ",")} ${clean(p.unit)}` : "";
  const color = clean(p.color);
  // "Everstrong" + "Everstrong Oil" → the type alone already names the line.
  const lead = line && type.toLowerCase().startsWith(line.toLowerCase()) ? "" : line;
  const name = [maker, lead, type, color, amount].filter(Boolean).join(" ");
  if (!maker || !name) return null;
  const img = typeof p.image?.url === "string" && p.image.url.startsWith("https://") ? `${p.image.url}?box=600` : null;
  return {
    brand: "parfumdreams",
    country: "DE",
    externalId: String(id),
    name,
    url: `${SITE}${t.href.split("#")[0]}#variation=${id}`,
    imageUrl: img,
    images: cleanGallery([img], img),
    price,
    listPrice: uvp,
    currency: "EUR",
    inStock: p.available === true,
    barcodes: /^\d{8,14}$/.test(clean(p.ean)) ? [clean(p.ean)] : null,
    category: clean(p.category3) || clean(p.category2) || clean(p.category1) || null,
    maker,
    gender: genderOf(p),
    variants: null,
    groupKey: `parfumdreams:${article}`,
    colorName: color || null,
  };
}

export async function listParfumdreams(
  country: CountryCode,
  fetchHtml: (u: string) => Promise<string> = (u) =>
    getText(u, { country, timeoutMs: 60_000, headers: { "Accept-Language": "de-DE,de;q=0.9" } }),
): Promise<ProductRecord[]> {
  if (country !== "DE") return [];
  const byId = new Map<string, ProductRecord>();
  let pages = 0;
  let last = MAX_PAGES;
  for (let page = 1; page <= Math.min(last, MAX_PAGES); page++) {
    if (pages) await sleep(PAUSE_MS);
    let html: string;
    try {
      html = await fetchHtml(page > 1 ? `${LISTING}&p=${page}` : LISTING);
    } catch (err) {
      if (page === 1) throw err;
      break;
    }
    pages++;
    const tiles = parseTiles(html);
    if (page === 1 && tiles.length === 0) throw new Error("parfumdreams: no tiles on the sale listing (markup changed?)");
    if (tiles.length === 0) break;
    if (page === 1) last = pageCount(html) ?? MAX_PAGES;
    let fresh = 0;
    for (const t of tiles) {
      const r = mapTile(t);
      if (!r || byId.has(r.externalId)) continue;
      byId.set(r.externalId, r);
      fresh++;
    }
    // The Sale filter stopped filtering (every tile rejected) — do not walk the catalogue.
    if (page === 1 && fresh === 0) throw new Error("parfumdreams: the sale listing has no SALE-labelled rows");
  }
  const all = [...byId.values()];
  const out = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
  console.log(`parfumdreams/${country}: ${pages} pages, ${all.length} reduced, kept ${out.length}`);
  return out;
}
