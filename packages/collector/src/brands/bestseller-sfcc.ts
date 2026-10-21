/**
 * BESTSELLER's Salesforce storefronts — VILA (vila.com) and PIECES
 * (pieces.com), Sweden / Finland / Denmark, 2026-10-21. These two are NOT on
 * the `/api/catalog` API that ONLY / VERO MODA / JACK & JONES use (404 there,
 * see `_bestseller.ts`); they run SFRA, whose own grid endpoint answers
 * server-rendered tiles to a plain request (no key, cookie or proxy):
 *
 *   GET /on/demandware.store/Sites-{vl|pc}-Site/{sv_SE|fi_FI|da_DK}/Search-UpdateGrid
 *       ?cgid={vl-sale|pc-greatoffers}&start=N&sz=60
 *
 * The locale picks the price book (SEK / EUR / DKK), not geo-IP. Each tile
 * carries `data-product-info` JSON with `price` (ordinary) and `salesPrice`
 * (current) as the site shows them — the strike-through "price" and the red
 * "sales--discounted" price on the card. Only rows with salesPrice < price are
 * kept. `sz` above 60 is ignored by the shop, so a page is 60 tiles (~1.1 MB).
 * No per-size stock in the grid (one representative size only), so variants
 * stay null; `inStockFlag` gives stock.
 */
import type { ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { jsonOf, decodeEntities } from "./_sfcchtml";

/**
 * Nordic letters, case-sensitive: the shared `decodeEntities` looks names up
 * lower-cased and has no å/ø/æ, so `L&Aring;NG&Auml;RMAD` would come out as
 * `L&Aring;NGäRMAD`. Decode these first, then hand the rest to it.
 */
const NORDIC: Record<string, string> = {
  aring: "å", Aring: "Å", auml: "ä", Auml: "Ä", ouml: "ö", Ouml: "Ö", oslash: "ø", Oslash: "Ø",
  aelig: "æ", AElig: "Æ", uuml: "ü", Uuml: "Ü", eacute: "é", Eacute: "É",
};
export const decodeNordic = (s: string): string =>
  decodeEntities(s.replace(/&([A-Za-z]+);/g, (m, e: string) => NORDIC[e] ?? m));

export type BestsellerSfccBrand = "vila" | "pieces";

export const BESTSELLER_SFCC: Record<BestsellerSfccBrand, { origin: string; site: string; cgid: string }> = {
  vila: { origin: "https://www.vila.com", site: "Sites-vl-Site", cgid: "vl-sale" },
  // Pieces has no "sale" category; "Erbjudanden" (pc-greatoffers) is its markdown list.
  pieces: { origin: "https://www.pieces.com", site: "Sites-pc-Site", cgid: "pc-greatoffers" },
};

export const BESTSELLER_SFCC_LOCALES: Partial<Record<CountryCode, string>> = { SE: "sv_SE", FI: "fi_FI", DK: "da_DK" };

const PAGE = 60;
const MAX_PAGES = Number(process.env.BESTSELLER_SFCC_PAGES ?? 25);
const CAP = 1500;
const PAUSE_MS = Number(process.env.BESTSELLER_SFCC_PAUSE_MS ?? 700);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function gridUrl(brand: BestsellerSfccBrand, country: CountryCode, start: number): string {
  const s = BESTSELLER_SFCC[brand];
  const loc = BESTSELLER_SFCC_LOCALES[country]!;
  return `${s.origin}/on/demandware.store/${s.site}/${loc}/Search-UpdateGrid?cgid=${s.cgid}&start=${start}&sz=${PAGE}`;
}

/** Split a grid answer into one HTML chunk per tile. */
export function tiles(html: string): string[] {
  const idx = [...html.matchAll(/<div class="product"\s/g)].map((m) => m.index!);
  return idx.map((a, i) => html.slice(a, idx[i + 1] ?? html.length));
}

/** Map one tile. Pure. Returns only reduced rows. */
export function mapBestsellerSfcc(brand: BestsellerSfccBrand, country: CountryCode, tile: string): ProductRecord | null {
  const s = BESTSELLER_SFCC[brand];
  const pid = /data-pid="([^"]+)"/.exec(tile)?.[1];
  const info = jsonOf<any>(decodeNordic(/data-product-info="([^"]*)"/.exec(tile)?.[1] ?? ""));
  const href = /href="([^"]+\.html)"/.exec(tile)?.[1];
  if (!pid || !info || !href) return null;
  const price = Number(info.salesPrice);
  const list = Number(info.price);
  if (!(price > 0) || !(list > price)) return null;
  const imgs = [
    ...new Set(
      [...tile.matchAll(/data-srcset="([^"]+)"/g)]
        .map((m) => decodeEntities(m[1]).split(/\s/)[0].replace(/\?.*$/, "?sw=900&sh=1200"))
        .filter((u) => /^https:\/\//.test(u)),
    ),
  ];
  const g = String(info.gender ?? "");
  return {
    brand,
    country,
    externalId: pid,
    name: String(info.name ?? "").trim() || pid,
    url: `${s.origin}${decodeEntities(href)}`,
    imageUrl: imgs[0] ?? null,
    images: imgs.length ? imgs.slice(0, 8) : null,
    price: toMinor(price),
    listPrice: toMinor(list),
    currency: COUNTRIES[country].currency,
    inStock: Number(info.inStockFlag) !== 0,
    category: info.category ? String(info.category) : null,
    gender: /^female$/i.test(g) ? "kadin" : /^male$/i.test(g) ? "erkek" : "kadin",
    variants: null,
    colorName: info.colorFamily ? String(info.colorFamily) : null,
    groupKey: info.articleNumber ? `${brand}:${info.articleNumber}` : null,
  };
}

/** The price book the page was rendered in (from the card's price markup). */
export function pageCurrency(html: string): "EUR" | "KR" | null {
  if (/content="[\d.]+">\s*&euro;/.test(html) || /content="[\d.]+">\s*€/.test(html)) return "EUR";
  if (/content="[\d.]+">[^<]*\bkr\b/i.test(html)) return "KR";
  return null;
}

export async function listBestsellerSfcc(brand: BestsellerSfccBrand, country: CountryCode): Promise<ProductRecord[]> {
  if (!BESTSELLER_SFCC_LOCALES[country]) return [];
  const want = COUNTRIES[country].currency === "EUR" ? "EUR" : "KR";
  const byId = new Map<string, ProductRecord>();
  for (let page = 0; page < MAX_PAGES && byId.size < CAP * 1.2; page++) {
    if (page > 0) await sleep(PAUSE_MS);
    const html = await getText(gridUrl(brand, country, page * PAGE), {
      country,
      headers: { "X-Requested-With": "XMLHttpRequest", Accept: "text/html" },
      timeoutMs: 30_000,
    });
    const ts = tiles(html);
    if (page === 0 && !ts.length) throw new Error(`${brand}/${country}: sale grid returned no tiles`);
    const cur = pageCurrency(html);
    if (cur && cur !== want) throw new Error(`${brand}/${country}: page priced in ${cur}, want ${want}`);
    let fresh = 0;
    for (const t of ts) {
      const r = mapBestsellerSfcc(brand, country, t);
      if (r && !byId.has(r.externalId)) {
        byId.set(r.externalId, r);
        fresh++;
      }
    }
    if (ts.length < PAGE || fresh === 0) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
