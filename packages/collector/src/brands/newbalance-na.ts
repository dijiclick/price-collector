/**
 * New Balance US (newbalance.com) + Canada (newbalance.ca) — the sale grid of
 * NB's own Salesforce (SFRA) storefront, read through `Search-UpdateGrid`, the
 * endpoint the "Load more" button calls. Turkey is a different shop
 * (newbalance.ts) and is untouched.
 *
 * Why this works: Akamai answers every page navigation on both hosts with 403
 * — pages, robots.txt, sitemaps, OCAPI, and the SFCC origin
 * (`production-web-newbalance.demandware.net`, Cloudflare 403) — from GitHub
 * runners, from Turkey and from the Hetzner box (Germany). The grid endpoint
 * answers a US runner 200 when the request carries `X-Requested-With:
 * XMLHttpRequest`, as the site's own XHR does (probe 39136904202 / 39137256578:
 * US 228,502 B, CA 2,048,460 B at sz=200). It is still geo-walled outside
 * North America, so it only works from the collector's US egress.
 *
 * Sale trees: US `cgid=400143` (/sale/), CA `cgid=6000` (/en_ca/sale/), read
 * from the pages' own "Load more" urls. Each tile is one style family
 * (`data-pid` = master) with one swatch button per colour; the swatch carries
 * that colour's price as JSON (`data-style-price`: `sales` and, only when
 * reduced, `list`). One record per reduced colour; full-price colours of a
 * reduced family are dropped. The tile's tealium JSON gives name, gender and
 * product availability. The reduced price is the storefront's shelf price for
 * a guest (pricebook markdown or an automatic, no-code promotion shown on the
 * tile); coupon offers are never on the tile. No per-size stock in the grid.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "newbalance";

export interface NbMarket {
  origin: string;
  site: string;
  locale: string;
  cgid: string;
  currency: string;
  prefix: string;
  /** Grid pages walked (100 tiles each). */
  maxPages?: number;
  /** Grid pages in flight at once (the EU grid answers in 3–7 s a page). */
  parallel?: number;
}

/**
 * EUROPE (2026-10-21): every EU shop is ONE SFCC site, `Sites-NBEU-Site`, on
 * each country's own host; the locale picks the price book (fr_FR … EUR,
 * sv_SE → SEK, da_DK → DKK). Same `Search-UpdateGrid` route and the same tile
 * markup as North America, and here it answers a GitHub runner (probe
 * 39615272052: all twelve 200 with tiles; the hosts' pages are Akamai/Cloudflare
 * 403). The EU outlet categories are empty, so the walk reads the whole range
 * (`cgid=root`, ~3,270 tiles) and keeps only reduced colours — the EUR shops
 * strike ~60% of all styles today, SEK/DKK ~50% (measured on the Mac). NL, AT,
 * FI and DK live on `<cc>.newbalance.eu` (the .nl/.at/.fi/.dk domains redirect).
 */
const EU = (origin: string, locale: string, currency = "EUR"): NbMarket => ({
  origin, site: "Sites-NBEU-Site", locale, cgid: "root", currency, prefix: "", maxPages: 34, parallel: 4,
});

export const NB_MARKETS: Partial<Record<CountryCode, NbMarket>> = {
  US: { origin: "https://www.newbalance.com", site: "Sites-NBUS-Site", locale: "en_US", cgid: "400143", currency: "USD", prefix: "" },
  CA: { origin: "https://www.newbalance.ca", site: "Sites-NBCA-Site", locale: "en_CA", cgid: "6000", currency: "CAD", prefix: "/en_ca" },
  FR: EU("https://www.newbalance.fr", "fr_FR"),
  DE: EU("https://www.newbalance.de", "de_DE"),
  ES: EU("https://www.newbalance.es", "es_ES"),
  NL: EU("https://nl.newbalance.eu", "nl_NL"),
  BE: EU("https://www.newbalance.be", "nl_BE"),
  IE: EU("https://www.newbalance.ie", "en_IE"),
  SE: EU("https://www.newbalance.se", "sv_SE", "SEK"),
  IT: EU("https://www.newbalance.it", "it_IT"),
  AT: EU("https://at.newbalance.eu", "de_AT"),
  PT: EU("https://www.newbalance.pt", "pt_PT"),
  FI: EU("https://fi.newbalance.eu", "fi_FI"),
  DK: EU("https://dk.newbalance.eu", "da_DK", "DKK"),
  // Britain (2026-10-21) is its own site, `Sites-NBUK-Site` (GBP), on the same
  // markup; no sale category answers (cgid=sale → 0), so it walks the whole
  // range like the EU shops — ~3,400–3,500 tiles (start=3300 full, 3600 empty;
  // probes 39655522243 / 39655617493), hence 38 pages. Runner 200 (probes
  // 39653951827, 39654819380: 18 of 57 colours in the first 24 tiles reduced,
  // ~1 s a page); 403 from the Mac and Hetzner.
  GB: { ...EU("https://www.newbalance.co.uk", "en_GB", "GBP"), site: "Sites-NBUK-Site", maxPages: 38 },
};

const PAGE = 100;
const MAX_PAGES = 15;
const CAP = 1500;
const PAUSE_MS = Number(process.env.NB_NA_PAUSE_MS ?? 400);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function nbGridUrl(country: CountryCode, start: number, sz = PAGE): string {
  const m = NB_MARKETS[country]!;
  return `${m.origin}/on/demandware.store/${m.site}/${m.locale}/Search-UpdateGrid?cgid=${m.cgid}&start=${start}&sz=${sz}`;
}

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decode(m[1]) : null;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function genderOf(g: unknown): ProductRecord["gender"] {
  const s = String(g ?? "");
  if (/kid|boy|girl|infant|toddler|youth|grade|pre-?school|little|big/i.test(s)) return "cocuk";
  // Some EU locales name the gender in their own language (es "Hombre/Mujer/Niños",
  // sv "Män/Kvinnor/Barn", it, pt, da …) — measured 2026-10-21.
  if (/^\s*(ni[ñn][oa]s?|barn|b[øo]rn|bambin[oi]|crian[çc]as?|kinder|enfants?|lapset)\b/i.test(s)) return "cocuk";
  if (/^\s*(mujer|kvinnor|kvinder|donna|mulher|damen|femmes?|naiset|dames)\b/i.test(s)) return "kadin";
  if (/^\s*(hombre|m[äæ]nn?(d|er)?|uomo|homem|herren|hommes?|miehet|heren)(\b|$)/i.test(s)) return "erkek";
  if (/women/i.test(s)) return "kadin";
  if (/^\s*men/i.test(s)) return "erkek";
  return null;
}

/** The grid HTML split into product tiles. */
export function nbTiles(html: string): string[] {
  return html.split(/(?=<div class="pgptiles)/).filter((t) => t.startsWith('<div class="pgptiles'));
}

/** One grid tile → one record per reduced colour. Pure. */
export function mapNewBalanceTile(tile: string, country: CountryCode): ProductRecord[] {
  const m = NB_MARKETS[country];
  if (!m) return [];
  const raw = tile.match(/data-tealium-product-tile-data="([^"]*)"/)?.[1];
  let td: any = null;
  try { td = raw ? JSON.parse(decode(raw)) : null; } catch { td = null; }
  const master = String(td?.masterProductId ?? td?.productId ?? tile.match(/class="product[^"]*"[^>]*data-pid="([^"]+)"/)?.[1] ?? "");
  const pname = tile.match(/class="link[^"]*pname[^"]*" href="([^"]*)">([^<]*)</);
  const name = decode(String(td?.productName ?? pname?.[2] ?? "")).replace(/\s+/g, " ").trim();
  if (!master || !name) return [];
  const category = decode(tile.match(/<span class="category-name[^"]*">([\s\S]*?)<\/span>/)?.[1] ?? "").replace(/\s+/g, " ").trim() || null;
  const avail = String(td?.productAvailability ?? "IN_STOCK").toUpperCase();
  const inStock = avail === "IN_STOCK" || avail === "PREORDER" || avail === "BACKORDER";
  const out: ProductRecord[] = [];
  for (const b of tile.match(/<button data-style="[\s\S]*?<\/button>/g) ?? []) {
    const open = b.slice(0, b.indexOf(">") + 1);
    const style = attr(open, "data-style");
    let pr: any = null;
    try { pr = JSON.parse(attr(open, "data-style-price") ?? "null"); } catch { pr = null; }
    const sale = num(pr?.sales?.value);
    const list = num(pr?.list?.value);
    if (!style || sale == null || list == null || !(sale < list)) continue;
    if ((pr.sales.currency && pr.sales.currency !== m.currency) || (pr.list.currency && pr.list.currency !== m.currency)) continue;
    const img = b.match(/<img[\s\S]*?\/>/)?.[0] ?? "";
    const big = (u: string | null | undefined) => (u ? u.split(/\s+/)[0].replace(/wid=\d+&hei=\d+/, "wid=880&hei=880") : null);
    const first = big(attr(img, "data-large-src"));
    const next = big(attr(img, "data-large-srcset-next"));
    const href = attr(open, "href") ?? `${m.prefix}/pd/-/${master}.html?dwvar_${master}_style=${style}`;
    const colour = attr(img, "data-full-color-name");
    out.push({
      brand,
      country,
      externalId: style,
      name,
      url: `${m.origin}${href.startsWith("/") ? "" : "/"}${href}`,
      imageUrl: first,
      images: cleanGallery([first, next], first),
      price: toMinor(sale),
      listPrice: toMinor(list),
      currency: m.currency,
      inStock,
      category,
      gender: genderOf(td?.gender),
      variants: colour ? { colors: [colour], sizes: [] } : null,
      groupKey: `nb:${master}`,
      colorName: colour,
    });
  }
  return out;
}

export async function listNewBalanceNa(country: CountryCode): Promise<ProductRecord[]> {
  const m = NB_MARKETS[country];
  if (!m) return [];
  const byId = new Map<string, ProductRecord>();
  const refused: string[] = [];
  let pagesOk = 0;
  let tiles = 0;
  const maxPages = m.maxPages ?? MAX_PAGES;
  const wave = Math.max(1, m.parallel ?? 1);
  const fetchPage = (page: number) =>
    getText(nbGridUrl(country, page * PAGE), {
      country,
      timeoutMs: 30_000,
      headers: { "X-Requested-With": "XMLHttpRequest", Accept: "text/html, */*; q=0.01", Referer: `${m.origin}${m.prefix}/sale/` },
    }).catch((e) => {
      refused.push(`start ${page * PAGE}: ${String(e?.message ?? e).slice(0, 80)}`);
      return null;
    });
  // North America: one page at a time (wave 1, as before). Europe: a few at once.
  walk: for (let first = 0; first < maxPages && byId.size < CAP; first += wave) {
    if (first) await sleep(PAUSE_MS);
    const pages = Array.from({ length: Math.min(wave, maxPages - first) }, (_, i) => first + i);
    const htmls = await Promise.all(pages.map(fetchPage));
    for (const html of htmls) {
      if (html == null) break walk;
      pagesOk++;
      const ts = nbTiles(html);
      tiles += ts.length;
      for (const t of ts) for (const r of mapNewBalanceTile(t, country)) if (!byId.has(r.externalId)) byId.set(r.externalId, r);
      if (ts.length < PAGE) break walk;
    }
  }
  if (refused.length) console.warn(`newbalance/${country}: ${refused.join("; ")}`);
  if (pagesOk === 0) throw new Error(`newbalance/${country}: sale grid refused (${refused.join("; ")})`);
  const rows = [...byId.values()];
  if (!rows.length) throw new Error(`newbalance/${country}: 0 reduced colours in ${tiles} sale tiles — the grid changed shape or the sale ended`);
  rows.sort((a, b) => Number(b.inStock) - Number(a.inStock));
  return rows.slice(0, CAP);
}

export const listProducts = listNewBalanceNa;
