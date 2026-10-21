/**
 * Hunkemöller (hunkemoller.nl / .be) — Dutch lingerie chain on Salesforce
 * Commerce Cloud (PWA Kit). Same route as Kendra Scott: the storefront's own
 * SLAS private-client proxy (`/mobify/slas/private/.../oauth2/token`,
 * `grant_type=client_credentials`) hands out a guest token, and Shopper
 * Search on Salesforce's API host answers with it.
 *
 * The Bloomreach index the site also loads is NOT used: its `price` equals
 * `sale_price` on every single item, and its only "discounts" are product
 * sets whose `price` is the sum of the set against one piece's sale price.
 *
 * Markdown: the "Sale" and "Outlet" root categories (found by name in the
 * category tree, since ids differ per site — NL 193 / 1094). With
 * `perPricebook=true` every hit carries `priceRanges` for the `…-list` book
 * (the price the tile strikes through) and the `…-sale` book (charged), and
 * `c_prices {list, sale}`. Only list > sale is kept — the Outlet also holds
 * items at their full price. One hit = one style in one colour; the grid only
 * lists orderable products, so a hit is in stock. Measured 2026-10-21 (NL):
 * Sale 285 + Outlet 259 hits, ~96% marked down, ~6 requests.
 *
 * Names are Dutch/French; `category` carries an English product type mapped
 * from the name so the classifier (Turkish/English) can file it.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const API = "https://6lnpx80u.api.commercecloud.salesforce.com";
const ORG = "f_ecom_bchl_prd";
const PAGE = 100; // 200 with images times out (504) on this instance
const MAX_PAGES = 8;
const CAP = 1500;
const PAUSE_MS = Number(process.env.HUNKEMOLLER_PAUSE_MS ?? 500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Market { origin: string; site: string; locale: string; currency?: string }

export const HUNKEMOLLER_MARKETS: Partial<Record<CountryCode, Market>> = {
  NL: { origin: "https://www.hunkemoller.nl", site: "hunkemoller", locale: "nl-NL" },
  BE: { origin: "https://www.hunkemoller.be", site: "hunkemoller-be", locale: "nl-BE" },
  // 2026-10-21: same org, one site per country domain (siteId from each home page).
  DE: { origin: "https://www.hunkemoller.de", site: "hunkemoller-de", locale: "de-DE" },
  AT: { origin: "https://www.hunkemoller.at", site: "hunkemoller-at", locale: "de-AT" },
  FR: { origin: "https://www.hunkemoller.fr", site: "hunkemoller-fr", locale: "fr-FR" },
  ES: { origin: "https://www.hunkemoller.es", site: "hunkemoller-es", locale: "es-ES" },
  CH: { origin: "https://www.hunkemoller.ch", site: "hunkemoller-ch", locale: "de-CH", currency: "CHF" },
  SE: { origin: "https://www.hunkemoller.se", site: "hunkemoller-se", locale: "sv-SE", currency: "SEK" },
  NO: { origin: "https://www.hunkemoller.no", site: "hunkemoller-no", locale: "no-NO", currency: "NOK" },
  DK: { origin: "https://www.hunkemoller.dk", site: "hunkemoller-dk", locale: "da-DK", currency: "DKK" },
};

/** Root categories that hold the markdowns. */
const SALE_NAME = /^(sale|outlet|soldes|rebajas|rea|salg|udsalg)$/i;

/** Dutch/French product words → an English type the classifier knows. First match wins. */
const TYPES: [RegExp, string][] = [
  [/badpak|maillot de bain/i, "Swimsuit"],
  [/bikini/i, "Bikini"],
  [/pyjama/i, "Pyjamas"],
  [/nachthemd|nuisette|chemise de nuit|slipdress/i, "Nightdress"],
  [/badjas|ochtendjas|kimono|peignoir/i, "Robe"],
  [/body(?!wear)/i, "Bodysuit"],
  [/corset|bustier|korset/i, "Corset"],
  [/bralette/i, "Bralette"],
  [/\bbh\b|beha|soutien|\bbra\b/i, "Bra"],
  [/string|tanga/i, "Thong"],
  [/brazilian|slip|hipster|boxer|culotte|shorty/i, "Briefs"],
  [/panty|collant|kousen|panties/i, "Tights"],
  [/sok|chaussette/i, "Socks"],
  [/legging/i, "Leggings"],
  [/jurk|robe|dress/i, "Dress"],
  [/broek|pantalon|short/i, "Trousers"],
  [/vest|cardigan|hoodie|sweater|trui|pull/i, "Sweater"],
  [/hemd|top|shirt|camisole|caraco|débardeur/i, "Top"],
  [/jarretel|garter|porte-jarretelles/i, "Suspender belt"],
  [/slipper|pantoffel|chausson/i, "Slippers"],
  [/tas|sac|bag/i, "Bag"],
  // DE/ES/FR/Nordic words (2026-10-21), after the Dutch ones so NL/BE keep their matches.
  [/badeanzug|bañador|badedrakt|baddräkt|badedragt/i, "Swimsuit"],
  [/kleid|kjole|klänning|vestido/i, "Dress"],
  [/skirt|\brock\b|skjørt|kjol\b|falda|nederdel/i, "Skirt"],
  [/sujetador|bh\b/i, "Bra"],
  [/streng|thong/i, "Thong"],
  [/braguita|brasile|truss|trosa|truse|höschen/i, "Briefs"],
  [/strumpfhose|strømpebuks|strumpbyx|stocking|medias/i, "Tights"],
  [/\bhose\b|strandhose|pantal|bukse|byxor/i, "Trousers"],
  [/jakke|jacke|chaqueta|jacka/i, "Jacket"],
  [/antifaz|augenbinde|ögonbindel|øjenmaske|sovemaske|eye mask/i, "Sleep mask"],
];
export function hunkemollerType(name: string): string | null {
  for (const [re, t] of TYPES) if (re.test(name)) return t;
  return null;
}

const num = (x: unknown): number | null => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The struck price (list book) and the charged price (sale book / hit price). Major units. */
export function hunkemollerPrices(h: any): { price: number; list: number } | null {
  const ranges: any[] = Array.isArray(h?.priceRanges) ? h.priceRanges : [];
  const book = (suffix: string) => ranges.find((r) => String(r?.pricebook ?? "").endsWith(suffix));
  const listR = book("-list");
  const saleR = book("-sale");
  // A range (min ≠ max) inside one book means different sizes cost different
  // amounts — not a single strike price for this tile; skip it.
  if (listR && num(listR.minPrice) !== num(listR.maxPrice)) return null;
  if (saleR && num(saleR.minPrice) !== num(saleR.maxPrice)) return null;
  const list = num(listR?.maxPrice) ?? num(h?.c_prices?.list);
  const price = num(h?.price) ?? num(saleR?.minPrice) ?? num(h?.c_prices?.sale);
  if (list == null || price == null || list <= price) return null;
  return { price, list };
}

/** One search hit → a record, or null when it is not marked down. Pure. */
export function mapHunkemollerHit(h: any, country: CountryCode): ProductRecord | null {
  const id = String(h?.productId ?? "");
  const name = String(h?.productName ?? "").trim();
  const url = typeof h?.c_url === "string" && /^https:\/\//.test(h.c_url) ? h.c_url : null;
  if (!id || !name || !url) return null;
  // Product sets (`c_productSetProductsIDs` with the hit itself as one member is
  // fine) are priced per piece here; a pid that is itself a set is not.
  if (/-set$/i.test(id) || h?.hitType === "set") return null;
  const p = hunkemollerPrices(h);
  if (!p) return null;
  const main = h?.c_images?.main ?? null;
  const images = cleanGallery([h?.c_images?.main, h?.c_images?.back, h?.image?.disBaseLink], main);
  const colour = typeof h?.c_colourName === "string" && h.c_colourName.trim() ? h.c_colourName.trim() : null;
  return {
    brand: "hunkemoller",
    country,
    externalId: id,
    name,
    url,
    imageUrl: images?.[0] ?? null,
    images,
    price: toMinor(p.price),
    listPrice: toMinor(p.list),
    currency: String(h?.currency ?? "EUR"),
    inStock: h?.orderable !== false,
    category: hunkemollerType(name),
    gender: "kadin",
    groupKey: typeof h?.c_masterId === "string" && h.c_masterId ? `hunkemoller-${h.c_masterId}` : null,
    colorName: colour,
  };
}

async function guestToken(m: Market, country: CountryCode): Promise<string> {
  const t = await getJson<any>(`${m.origin}/mobify/slas/private/shopper/auth/v1/organizations/${ORG}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=client_credentials&channel_id=${m.site}`,
    country,
  });
  if (!t?.access_token) throw new Error(`hunkemoller ${country}: no guest token`);
  return t.access_token as string;
}

export function hunkemollerSearchUrl(m: Market, cgid: string, offset: number): string {
  const q = new URLSearchParams({
    siteId: m.site,
    refine: `cgid=${cgid}`,
    limit: String(PAGE),
    offset: String(offset),
    currency: m.currency ?? "EUR",
    locale: m.locale,
    expand: "prices,images",
    perPricebook: "true",
  });
  return `${API}/search/shopper-search/v1/organizations/${ORG}/product-search?${q}`;
}

/** Register as `listHunkemoller(country)`. NL BE DE AT FR ES CH SE NO DK. */
export async function listHunkemoller(country: CountryCode): Promise<ProductRecord[]> {
  const m = HUNKEMOLLER_MARKETS[country];
  if (!m) return [];
  const token = await guestToken(m, country);
  const headers = { Authorization: `Bearer ${token}` };
  const tree = await getJson<any>(
    `${API}/product/shopper-products/v1/organizations/${ORG}/categories/root?levels=1&siteId=${m.site}&locale=${m.locale}`,
    { country, headers },
  );
  const cgids: string[] = (tree?.categories ?? []).filter((c: any) => SALE_NAME.test(String(c?.name ?? "").trim())).map((c: any) => String(c.id));
  if (!cgids.length) throw new Error(`hunkemoller ${country}: no Sale/Outlet category in the tree`);
  const byId = new Map<string, ProductRecord>();
  for (const cgid of cgids) {
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) throw new Error(`hunkemoller ${country}: cgid ${cgid} has more than ${MAX_PAGES} pages`);
      await sleep(PAUSE_MS);
      const j = await getJson<any>(hunkemollerSearchUrl(m, cgid, page * PAGE), { country, headers, retries: 3 });
      const hits: any[] = Array.isArray(j?.hits) ? j.hits : [];
      for (const h of hits) {
        const r = mapHunkemollerHit(h, country);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (!hits.length || (page + 1) * PAGE >= Number(j?.total ?? 0)) break;
    }
  }
  if (!byId.size) throw new Error(`hunkemoller ${country}: 0 marked-down hits`);
  return [...byId.values()].slice(0, CAP);
}
