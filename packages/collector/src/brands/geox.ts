/**
 * Geox — the OUTLET grid (IT, ES, PT, DE, AT, CH, FR, BE, NL), 2026-11-10.
 *
 * geox.com is Salesforce Commerce Cloud, four sites by language area, a locale
 * per country: `xcom-latino` (it_IT, es_ES, pt_PT), `xcom-dach` (de_DE, de_AT,
 * de_CH — CHF), `xcom-francese` (fr_FR, fr_BE), `xcom-uk` (nl_NL). The outlet
 * page pages through
 *
 *   Search-UpdateGrid?cgid=OUTLET&start=N&sz=120
 *
 * which answers server-rendered tiles to anyone — no cookie, no wall on the Mac
 * or on a GitHub runner (probe run 42802174828: all nine locales 200, local
 * product URLs, EUR — CHF for Switzerland). The outlet is small (Italy: 166
 * styles on 2026-11-10), so two requests cover a market.
 *
 * A tile's opening tag carries the shop's own tracking JSON (`data-gtmdata`:
 * id, colour, `item_category` = "outlet-outlet_donna|uomo|bambini",
 * `size_instock` = "9/11"); the body has the product type, the photo and both
 * prices as `content="132.93"` — the outlet price and the struck "Prezzo di
 * listino" (list price). No per-size list on the tile and no Omnibus line.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import type { CountryCode } from "../../../../lib/countries";
import { decodeEntities, jsonOf } from "./_sfcchtml";

// `decodeEntities` knows the common named entities; these markets need a few more.
const EXTRA: Record<string, string> = { szlig: "ß", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", ugrave: "ù", igrave: "ì", ograve: "ò", acirc: "â", ocirc: "ô", icirc: "î", ucirc: "û", euml: "ë", iuml: "ï", atilde: "ã", otilde: "õ", Eacute: "É", rsquo: "’", ndash: "–", deg: "°" };
const decode = (s: string): string => decodeEntities(s.replace(/&([A-Za-z]+);/g, (m, e: string) => EXTRA[e] ?? m));

const ORIGIN = "https://www.geox.com";
export const GEOX_MARKETS: Partial<Record<CountryCode, { site: string; locale: string; currency: string }>> = {
  IT: { site: "xcom-latino", locale: "it_IT", currency: "EUR" },
  ES: { site: "xcom-latino", locale: "es_ES", currency: "EUR" },
  PT: { site: "xcom-latino", locale: "pt_PT", currency: "EUR" },
  DE: { site: "xcom-dach", locale: "de_DE", currency: "EUR" },
  AT: { site: "xcom-dach", locale: "de_AT", currency: "EUR" },
  CH: { site: "xcom-dach", locale: "de_CH", currency: "CHF" },
  FR: { site: "xcom-francese", locale: "fr_FR", currency: "EUR" },
  BE: { site: "xcom-francese", locale: "fr_BE", currency: "EUR" },
  NL: { site: "xcom-uk", locale: "nl_NL", currency: "EUR" },
};
const PER_PAGE = 120;
const MAX_PAGES = 8;
const CAP = 1500;
const PAUSE_MS = Number(process.env.GEOX_PAUSE_MS ?? 500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const gridUrl = (site: string, locale: string, start: number) =>
  `${ORIGIN}/on/demandware.store/Sites-${site}-Site/${locale}/Search-UpdateGrid?cgid=OUTLET&start=${start}&sz=${PER_PAGE}`;

const cents = (s: string | undefined): number => Math.round(parseFloat(s ?? "") * 100);

/** "outlet-outlet_donna" → women; the ids are the same in every locale. */
export function genderOf(itemCategory: unknown): ProductRecord["gender"] {
  const c = String(itemCategory ?? "").toLowerCase();
  if (/donna/.test(c)) return "kadin";
  if (/uomo/.test(c)) return "erkek";
  if (/bambin|junior|kid/.test(c)) return "cocuk";
  return null;
}

/** Every reduced tile of one grid page, as records. Pure. */
export function parseGeox(html: string, country: CountryCode, currency: string): ProductRecord[] {
  const starts = [...html.matchAll(/<div class="product"\s+data-href="/g)].map((m) => m.index!);
  const out: ProductRecord[] = [];
  for (let i = 0; i < starts.length; i++) {
    const seg = html.slice(starts[i], starts[i + 1] ?? html.length);
    const href = seg.match(/data-href="([^"]+)"/)?.[1];
    const pid = seg.match(/data-pid="([^"]+)"/)?.[1];
    const gtm = jsonOf<any>(decode(seg.match(/data-gtmdata="([^"]*)"/)?.[1] ?? "")) ?? {};
    const price = cents(seg.match(/<span class="sales[^"]*">\s*<span class="value" content="([\d.]+)"/)?.[1]);
    const was = cents(seg.match(/<del>[\s\S]{0,200}?<span class="value" content="([\d.]+)"/)?.[1]);
    if (!href || !pid || !(price > 0) || !(was > price)) continue;
    if (gtm.currencyCode && gtm.currencyCode !== currency) continue;
    const img = seg.match(/<img class="tile-image"\s+src="(https:\/\/[^"]+)"\s+alt="([^"]*)"/);
    const type = decode(seg.match(/<div class="category">([^<]*)</)?.[1] ?? "").trim();
    const model = decode(seg.match(/<a class="link" href="[^"]*">([^<]+)<\/a>/)?.[1] ?? "").trim();
    const alt = decode(img?.[2] ?? "").replace(/\s*\|\s*GEOX\s*$/i, "").trim();
    const name = alt || [type, model].filter(Boolean).join(" ");
    if (!name) continue;
    const image = img ? decode(img[1]) : null;
    const [have] = String(gtm.size_instock ?? "").split("/");
    out.push({
      brand: "geox",
      country,
      externalId: pid,
      name,
      url: `${ORIGIN}${decode(href)}`,
      imageUrl: image,
      images: cleanGallery([image], image),
      price,
      listPrice: was,
      currency,
      inStock: gtm.item_availability ? gtm.item_availability === "available" && have !== "0" : true,
      category: type || null,
      gender: genderOf(gtm.item_category),
      colorName: typeof gtm.item_variant === "string" && gtm.item_variant ? gtm.item_variant : null,
    });
  }
  return out;
}

export async function listGeox(
  country: CountryCode,
  fetchHtml: (u: string) => Promise<string> = (u) => getText(u, { country, timeoutMs: 60_000, headers: { "X-Requested-With": "XMLHttpRequest" } }),
): Promise<ProductRecord[]> {
  const mk = GEOX_MARKETS[country];
  if (!mk) return [];
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (calls++) await sleep(PAUSE_MS);
    let html: string;
    try {
      html = await fetchHtml(gridUrl(mk.site, mk.locale, page * PER_PAGE));
    } catch (err) {
      if (page === 0) throw err;
      break;
    }
    const rows = parseGeox(html, country, mk.currency);
    if (page === 0 && rows.length === 0) throw new Error("geox: no reduced tiles on the first outlet page (markup changed?)");
    let fresh = 0;
    for (const r of rows) {
      if (byId.has(r.externalId)) continue;
      byId.set(r.externalId, r);
      fresh++;
    }
    const tiles = (html.match(/<div class="product"\s+data-href="/g) ?? []).length;
    if (!fresh || tiles < PER_PAGE) break;
  }
  const all = [...byId.values()];
  // Women's first, then men's, kids last; in-stock before sold-out within that.
  const rank = (r: ProductRecord) => (r.inStock ? 0 : 10) + (r.gender === "kadin" ? 0 : r.gender === "erkek" ? 1 : 2);
  const out = all.sort((a, b) => rank(a) - rank(b)).slice(0, CAP);
  console.log(`geox/${country}: ${calls} pages, ${all.length} reduced, kept ${out.length}`);
  return out;
}
