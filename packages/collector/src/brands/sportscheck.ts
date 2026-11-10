/**
 * SportScheck — DE, AT, CH sale (clothing + shoes) from the SFCC grid fragment (2026-11-10).
 *
 * The storefront pages time out for a GitHub runner (www.sportscheck.com/ and
 * /damen/sale/ never answered, probe runs 42799416687 / 42800460434), but the
 * SFCC controller the listing itself calls answers a runner when the request
 * carries `X-Requested-With: XMLHttpRequest` (without the header the same URL
 * also timed out): probe runs 42801737998 and 42802867759 — DE and AT 200.
 * CH (`Sites-SPS-CH-Site`, CHF) was only run from the Mac — NOT runner-verified.
 *
 *   GET https://www.sportscheck.<tld>/on/demandware.store/Sites-SPS-<CC>-Site/de_<CC>/
 *       Search-UpdateGrid?cgid=hauptkatalog_kleidung|hauptkatalog_schuhe
 *       &prefn1=customSale&prefv1=Sale&prefn2=pimGeschlecht&prefv2=Damen|Herren&page=N&sz=120
 *
 * Paging is `page=N` (1-based) with `sz` as the page size; `start=` is ignored
 * (every `start` answers page 1). Past the last page the body is empty.
 * Measured 2026-11-10 (DE): women clothing 4,155, women shoes 684, men clothing
 * 3,612, men shoes 714 sale styles. 15 requests per market, ~50 KB gzip each.
 *
 * Prices: every sale tile is struck against the maker's "UVP" (recommended
 * price) — SportScheck shows no other reference. Where the tile also prints
 * the EU Omnibus "30-Tage Bestpreis", a best price at or below the current
 * price means the row is not a fresh markdown and it is dropped; a best price
 * between the two becomes the struck price (same rule as `_scayle.ts`).
 * The grid has no size list, so no per-size stock; tiles are listed only
 * while sellable. One tile = one colour (`data-pid`), colour in the photo title.
 */
import { type ProductRecord } from "../types";
import { getText } from "../http";
import type { CountryCode } from "../../../../lib/countries";

export const SPORTSCHECK_MARKETS: Partial<Record<CountryCode, { host: string; site: string; locale: string; currency: string }>> = {
  DE: { host: "https://www.sportscheck.com", site: "Sites-SPS-DE-Site", locale: "de_DE", currency: "EUR" },
  AT: { host: "https://www.sportscheck.at", site: "Sites-SPS-AT-Site", locale: "de_AT", currency: "EUR" },
  CH: { host: "https://www.sportscheck.ch", site: "Sites-SPS-CH-Site", locale: "de_CH", currency: "CHF" },
};
export const SPORTSCHECK_TREES: { cgid: string; sex: "Damen" | "Herren"; gender: "kadin" | "erkek"; pages: number }[] = [
  { cgid: "hauptkatalog_kleidung", sex: "Damen", gender: "kadin", pages: 7 },
  { cgid: "hauptkatalog_schuhe", sex: "Damen", gender: "kadin", pages: 3 },
  { cgid: "hauptkatalog_kleidung", sex: "Herren", gender: "erkek", pages: 3 },
  { cgid: "hauptkatalog_schuhe", sex: "Herren", gender: "erkek", pages: 2 },
];
const SZ = 120;
const CAP = 1500;
const PAUSE_MS = Number(process.env.SPORTSCHECK_PAUSE_MS ?? 500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function gridUrl(country: CountryCode, cgid: string, sex: string, page: number): string {
  const m = SPORTSCHECK_MARKETS[country]!;
  return `${m.host}/on/demandware.store/${m.site}/${m.locale}/Search-UpdateGrid?cgid=${cgid}&prefn1=customSale&prefv1=Sale&prefn2=pimGeschlecht&prefv2=${sex}&page=${page}&sz=${SZ}`;
}

const decode = (s: string) =>
  s
    .replace(/&nbsp;| /g, " ")
    .replace(/&middot;/g, "·")
    .replace(/&euro;/g, "€")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** "158,99 €" / "CHF 1'153,99" / "1.158,99 €" → minor units; null when no amount. */
export function amount(s: string): number | null {
  const m = decode(s).match(/(\d{1,3}(?:[.'’]\d{3})*|\d+),(\d{2})/);
  if (!m) return null;
  const n = Number(m[1].replace(/[.'’]/g, "")) * 100 + Number(m[2]);
  return n > 0 ? n : null;
}

export interface SportScheckTile {
  pid: string;
  path: string;
  brand: string | null;
  name: string;
  type: string | null;
  image: string | null;
  colour: string | null;
  price: number;
  uvp: number | null;
  /** EU Omnibus 30-day lowest price, when the tile prints one. */
  best: number | null;
}

const text = (html: string, re: RegExp): string | null => {
  const m = html.match(re);
  return m ? decode(m[1].replace(/<[^>]*>/g, " ")) || null : null;
};

export function parseTiles(html: string): SportScheckTile[] {
  const out: SportScheckTile[] = [];
  for (const part of html.split(/<article\b/).slice(1)) {
    const pid = part.match(/data-pid="([^"]+)"/)?.[1];
    const path = part.match(/class="cc-tile__url-absolute[^"]*"\s+href="([^"]+)"/)?.[1];
    if (!pid || !path || !path.startsWith("/")) continue;
    // The live price block; the colour swatches carry entity-escaped copies of other colours' prices.
    const priceText = text(part, /<span class="cc-product__price cc-product__price--sale[^"]*">([\s\S]*?)<\/span>/);
    // "ab 104,97 €" is a starting price across sizes, not one price.
    const price = priceText && !/^ab\b/i.test(priceText) ? amount(priceText) : null;
    if (!price) continue;
    const uvpText = text(part, /<span class="cc-product__price cc-product__price--recommended[^"]*">([\s\S]*?)<\/span>/);
    const bestText = text(part, /<span class="cc-product__omnibus-price[^"]*">([\s\S]*?)<\/span>/);
    const info = text(part, /cc-tile__product-info__product-name"[^>]*>([\s\S]*?)<\/span>/);
    const type = text(part, /cc-tile__product-info__product-type"[^>]*>([\s\S]*?)<\/span>/);
    const img = part.match(/<img class="cc-tile__image-selected[^>]*>/)?.[0] ?? "";
    const alt = img.match(/\salt="([^"]*)"/)?.[1];
    const title = img.match(/\stitle="([^"]*)"/)?.[1];
    const src = img.match(/\ssrc="([^"]+)"/)?.[1];
    const full = alt ? decode(alt) : null;
    const [brand, model] = info && info.includes(" · ") ? info.split(" · ", 2) : [null, info];
    const name = full ?? [brand, model, type?.split(" · ")[0]].filter(Boolean).join(" ");
    if (!name) continue;
    const t = title ? decode(title) : "";
    out.push({
      pid,
      path: decode(path),
      brand: brand?.trim() || null,
      name,
      type: type ? type.split(" · ")[0].trim() || null : null,
      image: src ? decode(src).replace(/([?&])w=\d+/, "$1w=800") : null,
      colour: full && t.startsWith(`${full} - `) ? t.slice(full.length + 3).trim() || null : null,
      price,
      uvp: uvpText && /^UVP\b/.test(uvpText) ? amount(uvpText) : null,
      best: bestText && /Bestpreis/.test(bestText) ? amount(bestText) : null,
    });
  }
  return out;
}

export function toRecord(t: SportScheckTile, gender: ProductRecord["gender"], country: CountryCode): ProductRecord | null {
  const m = SPORTSCHECK_MARKETS[country];
  if (!m || !t.uvp || t.uvp <= t.price) return null;
  // Omnibus: already this cheap within 30 days → not a fresh markdown.
  if (t.best && t.best <= t.price) return null;
  const listPrice = t.best && t.best < t.uvp ? t.best : t.uvp;
  return {
    brand: "sportscheck",
    country,
    externalId: t.pid,
    name: t.name,
    url: `${m.host}${t.path}`,
    imageUrl: t.image,
    images: null,
    price: t.price,
    listPrice,
    currency: m.currency,
    inStock: true,
    category: t.type,
    maker: t.brand,
    gender,
    variants: null,
    groupKey: null,
    colorName: t.colour,
  };
}

export async function listSportScheck(
  country: CountryCode,
  fetchHtml: (u: string) => Promise<string> = (u) =>
    getText(u, { country, timeoutMs: 60_000, headers: { "X-Requested-With": "XMLHttpRequest", "Accept-Language": "de-DE,de;q=0.9" } }),
): Promise<ProductRecord[]> {
  if (!SPORTSCHECK_MARKETS[country]) throw new Error(`sportscheck: no market ${country}`);
  const byId = new Map<string, ProductRecord>();
  let first = true;
  for (const tree of SPORTSCHECK_TREES) {
    for (let page = 1; page <= tree.pages; page++) {
      let tiles: SportScheckTile[];
      let shown = 0;
      try {
        const html = await fetchHtml(gridUrl(country, tree.cgid, tree.sex, page));
        // A sale page also lists colours that are not reduced; count every tile to know if the page was full.
        shown = (html.match(/data-test="plp\.product\.tile"/g) ?? []).length;
        tiles = parseTiles(html);
      } catch (e) {
        if (first) throw e;
        break;
      }
      if (first && !tiles.length) throw new Error(`sportscheck/${country}: no tiles on the first page`);
      first = false;
      for (const t of tiles) {
        const rec = toRecord(t, tree.gender, country);
        if (rec && !byId.has(rec.externalId)) byId.set(rec.externalId, rec);
      }
      if (shown < SZ) break;
      await sleep(PAUSE_MS);
    }
  }
  return [...byId.values()].slice(0, CAP);
}
