/**
 * Furla — the OUTLET grid (IT, DE, AT, FR, BE, ES, NL, PT; all EUR), 2026-11-10.
 *
 * furla.com is one Salesforce Commerce Cloud site (`furla-emea`) with a locale
 * per country (/it/it it_IT, /de/de de_DE, /at/de de_AT, /fr/fr fr_FR,
 * /be/fr fr_BE, /es/es es_ES, /nl/en en_NL, /pt/pt pt_PT). The outlet listing
 * is
 *
 *   Search-UpdateGrid?cgid=Outlet&start=N&sz=120
 *
 * — server-rendered tiles, no cookie, no wall on the Mac or on a GitHub runner
 * (runner probe run in the report). The outlet is small (88 styles on
 * 2026-11-10), so one request covers a market.
 *
 * A tile has the style-colour id, the PDP path, the gallery (`data-images`, a
 * JSON list), the name and both prices as text: `product-tile__price--original`
 * struck and `product-tile__price--sales` ("€ 345" / "345 €"). The page ends
 * with the shop's tag-manager payload (`js-plp-gtm-payload`) — used only for the
 * colour name and the women/men flag (`item_type` "W"/"M"). Bags and small
 * leather goods are one-size; the tile lists no sizes. No Omnibus line on tiles.
 * Switzerland (CHF) is left out: the grid showed the same numbers as the euro
 * markets, which was not checked against the Swiss site.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import type { CountryCode } from "../../../../lib/countries";
import { decodeEntities, jsonOf } from "./_sfcchtml";

const ORIGIN = "https://www.furla.com";
export const FURLA_MARKETS: Partial<Record<CountryCode, string>> = {
  IT: "it_IT",
  DE: "de_DE",
  AT: "de_AT",
  FR: "fr_FR",
  BE: "fr_BE",
  ES: "es_ES",
  NL: "en_NL",
  PT: "pt_PT",
};
const PER_PAGE = 120;
const MAX_PAGES = 6;
const CAP = 1500;
const PAUSE_MS = Number(process.env.FURLA_PAUSE_MS ?? 500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const gridUrl = (locale: string, start: number) =>
  `${ORIGIN}/on/demandware.store/Sites-furla-emea-Site/${locale}/Search-UpdateGrid?cgid=Outlet&start=${start}&sz=${PER_PAGE}`;

/** "€ 345" / "345 €" / "€ 1.290,50" / "€ 1,290.50" → cents; null when it is not a single euro price. */
export function euroCents(text: string): number | null {
  const t = decodeEntities(text).replace(/\s+/g, " ").trim();
  const m = t.match(/^(?:€ ?)?(\d[\d.,]*)(?: ?€)?$/);
  if (!m || !t.includes("€")) return null;
  let n = m[1];
  const dec = n.match(/[.,](\d{2})$/);
  const whole = (dec ? n.slice(0, -3) : n).replace(/[.,]/g, "");
  if (!/^\d+$/.test(whole)) return null;
  return Number(whole) * 100 + (dec ? Number(dec[1]) : 0);
}

/** Every reduced tile of one grid page, as records. Pure. */
export function parseFurla(html: string, country: CountryCode): ProductRecord[] {
  const items = new Map<string, any>();
  const payload = jsonOf<any[]>(html.match(/<script type="application\/json" class="js-plp-gtm-payload">([\s\S]*?)<\/script>/)?.[1] ?? "");
  for (const ev of Array.isArray(payload) ? payload : []) for (const it of ev?.ecommerce?.items ?? []) if (it?.item_id) items.set(String(it.item_id), it);

  const starts = [...html.matchAll(/<div class="product-tile"\s+data-pid="/g)].map((m) => m.index!);
  const out: ProductRecord[] = [];
  for (let i = 0; i < starts.length; i++) {
    const seg = html.slice(starts[i], starts[i + 1] ?? html.length);
    const pid = seg.match(/data-pid="([^"]+)"/)?.[1];
    const href = seg.match(/class="product-tile__name-link"\s+href="([^"]+)"/)?.[1] ?? seg.match(/class="product-tile__image-link"\s+href="([^"]+)"/)?.[1];
    const name = decodeEntities(seg.match(/<p class="product-tile__name">\s*([^<]+?)\s*<\/p>/)?.[1] ?? "").trim();
    const was = euroCents(seg.match(/product-tile__price--original">\s*([^<]+?)\s*</)?.[1] ?? "");
    const price = euroCents(seg.match(/product-tile__price--sales">\s*([^<]+?)\s*</)?.[1] ?? "");
    if (!pid || !href || !name || price == null || was == null || !(price > 0) || !(was > price)) continue;
    const gallery = jsonOf<string[]>(decodeEntities(seg.match(/data-images="([^"]*)"/)?.[1] ?? "")) ?? [];
    const lead = decodeEntities(seg.match(/class="product-tile__img[^"]*"[^>]*data-src="([^"]+)"/)?.[1] ?? "") || gallery[0] || null;
    const it = items.get(pid);
    out.push({
      brand: "furla",
      country,
      externalId: pid,
      name,
      url: `${ORIGIN}${decodeEntities(href)}`,
      imageUrl: lead,
      images: cleanGallery(Array.isArray(gallery) ? gallery : [], lead),
      price,
      listPrice: was,
      currency: "EUR",
      inStock: true, // the outlet grid lists only what can be bought
      category: null,
      gender: it?.item_type === "M" ? "erkek" : "kadin",
      colorName: typeof it?.item_variant === "string" && it.item_variant ? it.item_variant : null,
    });
  }
  return out;
}

export async function listFurla(
  country: CountryCode,
  fetchHtml: (u: string) => Promise<string> = (u) => getText(u, { country, timeoutMs: 60_000, headers: { "X-Requested-With": "XMLHttpRequest" } }),
): Promise<ProductRecord[]> {
  const locale = FURLA_MARKETS[country];
  if (!locale) return [];
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (calls++) await sleep(PAUSE_MS);
    let html: string;
    try {
      html = await fetchHtml(gridUrl(locale, page * PER_PAGE));
    } catch (err) {
      if (page === 0) throw err;
      break;
    }
    const rows = parseFurla(html, country);
    if (page === 0 && rows.length === 0) throw new Error("furla: no reduced tiles on the first outlet page (markup changed?)");
    let fresh = 0;
    for (const r of rows) {
      if (byId.has(r.externalId)) continue;
      byId.set(r.externalId, r);
      fresh++;
    }
    const tiles = (html.match(/<div class="product-tile"\s+data-pid="/g) ?? []).length;
    if (!fresh || tiles < PER_PAGE) break;
  }
  const out = [...byId.values()].slice(0, CAP);
  console.log(`furla/${country}: ${calls} pages, kept ${out.length}`);
  return out;
}
