/**
 * Liu Jo — the women's OUTLET grid (IT, ES, FR, BE, DE, AT, NL, PT; all EUR),
 * 2026-11-10.
 *
 * liujo.com is one Salesforce Commerce Cloud site (`liujo-row`) with a locale
 * per country (/it/ it_IT, /es/ es_ES, /fr/ fr_FR, /be/ fr_BE, /de/ de_DE,
 * /at/ de_AT, /nl/ en_NL, /pt/ en_PT). The outlet page's "load more" button
 * calls
 *
 *   Search-UpdateGrid?cgid=women-outlet&prefn1=showProductCountry&prefv1=<CC>&start=N&sz=60
 *
 * which answers server-rendered tiles to anyone — no cookie, no wall on the Mac
 * or on a GitHub runner (probe run 42802174828, all eight locales 200 with
 * local product URLs and € prices). `sz=60` keeps a page at ~35 KB gzip; an uncached page
 * takes the server 8–13 s to render (a cached one 0.2 s), `sz=120` twice that.
 * The outlet is ~580 styles = 10 pages.
 * Switzerland has no outlet category (404) and is not collected.
 *
 * A tile carries the style-colour id, the PDP path, the photos, both prices as
 * `content="159.00"` (struck `list` + `sales`) and a button per size whose class
 * says whether it can be bought (`state-selectable` / `state-disable`). The
 * tiles show no Omnibus "lowest price" line. Men's and kids' are not in this
 * category; Liu Jo's outlet is essentially women's.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import type { CountryCode } from "../../../../lib/countries";
import { decodeEntities } from "./_sfcchtml";

// `decodeEntities` knows the common named entities; these markets need a few more.
const EXTRA: Record<string, string> = { szlig: "ß", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", ugrave: "ù", igrave: "ì", ograve: "ò", acirc: "â", ocirc: "ô", icirc: "î", ucirc: "û", euml: "ë", iuml: "ï", atilde: "ã", otilde: "õ", Eacute: "É", rsquo: "’", ndash: "–", deg: "°" };
const decode = (s: string): string => decodeEntities(s.replace(/&([A-Za-z]+);/g, (m, e: string) => EXTRA[e] ?? m));

const ORIGIN = "https://www.liujo.com";
export const LIUJO_MARKETS: Partial<Record<CountryCode, { locale: string; lang: string }>> = {
  IT: { locale: "it_IT", lang: "it-IT,it;q=0.9" },
  ES: { locale: "es_ES", lang: "es-ES,es;q=0.9" },
  FR: { locale: "fr_FR", lang: "fr-FR,fr;q=0.9" },
  BE: { locale: "fr_BE", lang: "fr-BE,fr;q=0.9" },
  DE: { locale: "de_DE", lang: "de-DE,de;q=0.9" },
  AT: { locale: "de_AT", lang: "de-AT,de;q=0.9" },
  NL: { locale: "en_NL", lang: "en-NL,en;q=0.9" },
  PT: { locale: "en_PT", lang: "en-PT,en;q=0.9" },
};
const PER_PAGE = 60;
const MAX_PAGES = 20;
const CAP = 1500;
const PAUSE_MS = Number(process.env.LIUJO_PAUSE_MS ?? 500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const gridUrl = (locale: string, country: string, start: number) =>
  `${ORIGIN}/on/demandware.store/Sites-liujo-row-Site/${locale}/Search-UpdateGrid?cgid=women-outlet&prefn1=showProductCountry&prefv1=${country}&start=${start}&sz=${PER_PAGE}`;

export interface LiujoTile {
  pid: string;
  path: string;
  name: string;
  price: number;
  was: number;
  images: string[];
  sizes: SizeVariant[];
}

const cents = (s: string | undefined): number => Math.round(parseFloat(s ?? "") * 100);

/** Every reduced tile of one grid page. Pure. */
export function parseTiles(html: string): LiujoTile[] {
  const starts = [...html.matchAll(/<div class="product-tile__presentation[^"]*" data-pid="/g)].map((m) => m.index!);
  const out: LiujoTile[] = [];
  for (let i = 0; i < starts.length; i++) {
    const seg = html.slice(starts[i], starts[i + 1] ?? html.length);
    const pid = seg.match(/data-pid="([^"]+)"/)?.[1];
    const link = seg.match(/<a class="link[^"]*pdp-link__anchor[^"]*"\s+href="([^"]+)">([^<]+)<\/a>/);
    const was = cents(seg.match(/strike-through list[^>]*>\s*<span class="value" content="([\d.]+)"/)?.[1]);
    const price = cents(seg.match(/<span class="sales[^"]*">\s*<span class="value" content="([\d.]+)"/)?.[1]);
    if (!pid || !link || !(price > 0) || !(was > price)) continue;
    const images = [...seg.matchAll(/data-src="(https:\/\/www\.liujo\.com\/dw\/image\/[^"]+)"/g)].map((m) => decode(m[1]));
    const sizes: SizeVariant[] = [];
    const seen = new Set<string>();
    for (const m of seg.matchAll(/class="product-tile__size-btn btn btn-link state-(selectable|disable)[^"]*"[^>]*?data-attr-value="([^"]+)"/g)) {
      const label = decode(m[2]).trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      sizes.push({ label, availability: m[1] === "selectable" ? "in_stock" : "out_of_stock" });
    }
    out.push({ pid, path: decode(link[1]), name: decode(link[2]).trim(), price, was, images, sizes });
  }
  return out;
}

export function toRecord(t: LiujoTile, country: CountryCode): ProductRecord {
  const image = t.images[0] ?? null;
  return {
    brand: "liujo",
    country,
    externalId: t.pid,
    name: t.name,
    url: `${ORIGIN}${t.path}`,
    imageUrl: image,
    images: cleanGallery(t.images, image),
    price: t.price,
    listPrice: t.was,
    currency: "EUR",
    // A tile with no size buttons is a one-size item still on the shelf.
    inStock: t.sizes.length === 0 || t.sizes.some((s) => s.availability === "in_stock"),
    category: null,
    gender: "kadin",
    variants: t.sizes.length ? { colors: [], sizes: t.sizes } : null,
  };
}

export async function listLiujo(
  country: CountryCode,
  fetchHtml: (u: string) => Promise<string> = (u) =>
    getText(u, { country, timeoutMs: 60_000, headers: { "X-Requested-With": "XMLHttpRequest", "Accept-Language": LIUJO_MARKETS[country]?.lang ?? "it-IT" } }),
): Promise<ProductRecord[]> {
  const mk = LIUJO_MARKETS[country];
  if (!mk) return [];
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (calls++) await sleep(PAUSE_MS);
    let html: string;
    try {
      html = await fetchHtml(gridUrl(mk.locale, country, page * PER_PAGE));
    } catch (err) {
      if (page === 0) throw err;
      break;
    }
    const tiles = parseTiles(html);
    if (page === 0 && tiles.length === 0) throw new Error("liujo: no reduced tiles on the first outlet page (markup changed?)");
    let fresh = 0;
    for (const t of tiles) {
      if (byId.has(t.pid)) continue;
      byId.set(t.pid, toRecord(t, country));
      fresh++;
    }
    // The grid's own "load more" link is not a reliable end marker (it repeats
    // `start=120` on later pages), so stop on a short page or one with nothing new.
    if (!fresh || tiles.length < PER_PAGE) break;
  }
  const all = [...byId.values()];
  const out = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
  console.log(`liujo/${country}: ${calls} pages, ${all.length} reduced, kept ${out.length}`);
  return out;
}
