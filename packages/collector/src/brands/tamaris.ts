/**
 * Tamaris (tamaris.com) — Germany's biggest women's shoe brand (Wortmann), with
 * bags, accessories and a small clothing line. Salesforce Commerce Cloud;
 * Cloudflare in front without a challenge. Added 2026-11-10 for DE, AT and CH.
 *
 * The sale categories are server-rendered pages, 48 tiles at most:
 *   GET https://tamaris.com/<de-DE|de-AT|de-CH>/sale-schuhe/?start=N&sz=48
 * (`sz` above 48 answers 48; the path redirects to the shop's canonical
 * "alle-sale-schuhe" / "sale-alle-schuhe"). Each tile has a `data-product` JSON
 * with the colour's id, style name, `priceGross`, `listPrice`, `stock`,
 * `currency`, photo and product URL — EUR in Germany and Austria, CHF in
 * Switzerland, by the locale path (not geo-IP). A GitHub runner gets the page:
 * probe run 42799416687 (200 via Cloudflare, 919 KB). On 2026-11-10: shoes
 * 951 / 941 / 919 (DE / AT / CH), accessories 351, clothing 89.
 *
 * The French site answers 410 and the Dutch one is another platform, so those
 * are not listed. The tile carries no size list.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { attrValues, jsonOf } from "./_sfcchtml";

const ORIGIN = "https://tamaris.com";
const PAGE = 48;
const CAP = 1500;
const PAUSE_MS = Number(process.env.TAMARIS_PAUSE_MS ?? 500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const TAMARIS_MARKETS: Partial<Record<CountryCode, { locale: string; currency: string }>> = {
  DE: { locale: "de-DE", currency: "EUR" },
  AT: { locale: "de-AT", currency: "EUR" },
  CH: { locale: "de-CH", currency: "CHF" },
};

/** Sale trees in walk order, with a page budget each. */
export const TAMARIS_TREES: { path: string; pages: number }[] = [
  { path: "sale-schuhe", pages: 22 },
  { path: "sale-accessoires", pages: 8 },
  { path: "sale-bekleidung", pages: 3 },
];

export const tamarisUrl = (locale: string, path: string, start: number) => `${ORIGIN}/${locale}/${path}/?start=${start}&sz=${PAGE}`;

/** The `data-product` objects of one listing page. Pure. */
export function parseTamaris(html: string): any[] {
  return attrValues(html, "data-product").map((v) => jsonOf(v)).filter((p) => p && typeof p === "object" && p.id);
}

/** One tile → a record; null unless reduced, in this market's currency and on this market's site. Pure. */
export function mapTamaris(p: any, country: CountryCode): ProductRecord | null {
  const m = TAMARIS_MARKETS[country];
  if (!m || !p?.id) return null;
  const price = Number(p.priceGross);
  const list = Number(p.listPrice);
  if (!(price > 0) || !(list > price)) return null;
  if (p.currency && p.currency !== m.currency) return null;
  const url = typeof p.url === "string" ? p.url : "";
  if (!url.startsWith(`${ORIGIN}/${m.locale}/`)) return null;
  const style = typeof p.styleName === "string" ? p.styleName.trim() : "";
  const title = String(p.productName ?? "").trim();
  if (!title) return null;
  const [what, colour] = title.split(/\s+-\s+/);
  const img = typeof p.productImageUrl === "string" ? p.productImageUrl.replace(/\?.*$/, "?sw=800&sm=fit") : null;
  return {
    brand: "tamaris",
    country,
    externalId: String(p.id),
    name: style ? `${what} ${style}` : what,
    url,
    imageUrl: img,
    images: cleanGallery([img], img),
    price: toMinor(price),
    listPrice: toMinor(list),
    currency: m.currency,
    inStock: Number(p.stock) > 0,
    category: String(p.subCategory1Name ?? p.categoryName ?? "").split("|")[0].trim() || null,
    gender: /^men/i.test(String(p.gender ?? "")) ? "erkek" : /kid|child/i.test(String(p.gender ?? "")) ? "cocuk" : "kadin",
    variants: null,
    groupKey: p.masterID ? `tamaris:${p.masterID}` : null,
    colorName: colour?.trim() || null,
  };
}

export async function listTamaris(country: CountryCode, fetchHtml: (url: string) => Promise<string> = (u) => fetchPage(u, country)): Promise<ProductRecord[]> {
  const m = TAMARIS_MARKETS[country];
  if (!m) return [];
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const tree of TAMARIS_TREES) {
    const seen = new Set<string>();
    for (let page = 0; page < tree.pages && byId.size < CAP * 1.2; page++) {
      if (calls++) await sleep(PAUSE_MS);
      let html: string;
      try {
        html = await fetchHtml(tamarisUrl(m.locale, tree.path, page * PAGE));
      } catch (err) {
        if (calls === 1) throw err; // first page of the first tree: the route is down
        break;
      }
      const tiles = parseTamaris(html);
      if (calls === 1 && !tiles.length) throw new Error(`tamaris/${country}: the sale page has no product tiles`);
      let fresh = 0;
      for (const p of tiles) {
        const id = String(p.id);
        if (seen.has(id)) continue;
        seen.add(id);
        fresh++;
        const r = mapTamaris(p, country);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      // The first page holds 47 tiles (a banner takes a slot), later ones 48.
      if (fresh === 0 || tiles.length < PAGE - 1) break;
    }
  }
  const all = [...byId.values()];
  const out = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
  console.log(`tamaris/${country}: ${calls} pages, ${all.length} reduced, kept ${out.length}`);
  return out;
}

function fetchPage(url: string, country: CountryCode): Promise<string> {
  return getText(url, { country, retries: 2, timeoutMs: 45_000, headers: { "Accept-Language": "de-DE,de;q=0.9", Accept: "text/html,application/xhtml+xml" } });
}
