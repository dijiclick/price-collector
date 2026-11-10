/**
 * CHRIST (christ.de / christ.at) — jewellery + watches, multi-brand (2026-11-10).
 *
 * SAP Commerce, server-rendered, unwalled: a GitHub runner gets the sale lists
 * 200 for .de and .at (probe run 42800932272, same ~1.1 MB pages as from the
 * Mac). christ-swiss.ch answers the runner AND the Mac 403 (DataDome), so
 * Switzerland is not collected.
 *
 * Sale lists: /category/special-offer-sale/f/<damenschmuck|damenuhren|
 * herrenschmuck|herrenuhren>-sale/index.html, 60 tiles a page, `?page=N`
 * zero-based (the pager's own next link; DE 2026-11-10: 63 / 14 / 8 / 14
 * pages). Each tile (`data-is="product-tile"`) holds a `<wishlist-link>` with
 * `data-brand`, `data-category` ("../Uhren/Damenuhr"), `data-name`,
 * `data-price`, `data-oldprice`, `data-product-code`; the product link
 * (`/product/<variant>/<slug>/index.html`); the photo (`data-src` on
 * assets.chrimg.com, `product_md…` → `product_lg…` is the bigger rendition);
 * `data-product-buyable`; and the visible price block.
 *
 * The struck price comes in two kinds and the price block says which:
 *   - a plain struck price = CHRIST's own former price (mostly CHRIST's own
 *     jewellery lines, JETTE, Daniel Wellington): kept;
 *   - "UVP**" = the maker's recommended price (nearly every watch, Fossil,
 *     Michael Kors, Swarovski, Thomas Sabo…; ~75 % of the tiles): NOT a former
 *     price, skipped like Breuninger's UVP rows — unless CHRIST_INCLUDE_UVP=1.
 * "ab 99,00 €" tiles (a price range over variants) are always skipped.
 *
 * Requests per market: 42 list pages (30 + 3 + 6 + 3) for ~260–310 rows with a
 * real former price (2026-11-10: DE 313, AT 260); with UVP rows 26 pages give
 * ~1,350–1,400. ~1.1 MB a page.
 *
 * Gender: the list it came from; "Unisex…" product types get null. The tile has
 * no sizes (ring sizes live in a per-product overlay call), so none are set.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import type { CountryCode } from "../../../../lib/countries";

export const CHRIST_MARKETS: Partial<Record<CountryCode, { origin: string; lang: string }>> = {
  DE: { origin: "https://www.christ.de", lang: "de-DE,de;q=0.9" },
  AT: { origin: "https://www.christ.at", lang: "de-AT,de;q=0.9" },
};

const LIST = (f: string) => `/category/special-offer-sale/f/${f}/index.html`;
/**
 * Pages read per list. `pages` when only CHRIST's own former prices count (the
 * watch lists are ~97 % UVP, so they get little); `uvpPages` when UVP rows are
 * kept too.
 */
export const CHRIST_TREES: { path: string; gender: "kadin" | "erkek"; pages: number; uvpPages: number; cap: number }[] = [
  { path: LIST("damenschmuck-sale"), gender: "kadin", pages: 30, uvpPages: 12, cap: 800 },
  { path: LIST("damenuhren-sale"), gender: "kadin", pages: 3, uvpPages: 7, cap: 400 },
  { path: LIST("herrenschmuck-sale"), gender: "erkek", pages: 6, uvpPages: 3, cap: 150 },
  { path: LIST("herrenuhren-sale"), gender: "erkek", pages: 3, uvpPages: 4, cap: 250 },
];
const PAUSE_MS = Number(process.env.CHRIST_PAUSE_MS ?? 700);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const decode = (s: string) =>
  s
    .replace(/&nbsp;| /g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&apos;/g, "'")
    .replace(/&auml;/g, "ä").replace(/&ouml;/g, "ö").replace(/&uuml;/g, "ü")
    .replace(/&Auml;/g, "Ä").replace(/&Ouml;/g, "Ö").replace(/&Uuml;/g, "Ü").replace(/&szlig;/g, "ß")
    .replace(/&eacute;/g, "é").replace(/&egrave;/g, "è")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const attr = (seg: string, name: string): string | null => {
  const m = seg.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decode(m[1]) : null;
};
const cents = (s: string | null): number | null => {
  const n = Number(s);
  return s && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

export interface ChristTile {
  code: string;
  brand: string;
  name: string;
  /** Product type, e.g. "Damenuhr". */
  type: string | null;
  path: string;
  image: string | null;
  price: number;
  was: number;
  /** The struck price is the maker's UVP, not CHRIST's former price. */
  uvp: boolean;
  buyable: boolean;
}

/** Every reduced, single-price tile on a list page. Pure. */
export function parseTiles(html: string): ChristTile[] {
  const out: ChristTile[] = [];
  const segs = html.split('data-is="product-tile"');
  for (let i = 1; i < segs.length; i++) {
    const seg = segs[i];
    const wl = seg.match(/<wishlist-link[^>]*>/)?.[0];
    if (!wl) continue;
    const code = attr(wl, "data-product-code");
    const brand = attr(wl, "data-brand");
    const rawName = attr(wl, "data-name");
    const price = cents(attr(wl, "data-price"));
    const was = cents(attr(wl, "data-oldprice"));
    const path = seg.match(/href="(\/product\/[^"]+)"/)?.[1];
    if (!code || !brand || !rawName || !path || price == null || was == null || was <= price) continue;
    const block = seg.match(/data-is="product-prices"[\s\S]*?<\/a>/)?.[0] ?? "";
    const text = decode(block.replace(/<[^>]+>/g, " ").replace(/^[^>]*>/, ""));
    // "ab 99,00 €": a range over variants — neither price is one number.
    if (/(^|\s)ab\s/.test(text)) continue;
    const img = seg.match(/data-src="(https:\/\/assets\.chrimg\.com\/[^"]+)"/)?.[1] ?? null;
    const type = (attr(wl, "data-category") ?? "").split("/").filter((x) => x && x !== "..").pop() ?? null;
    out.push({
      code,
      brand,
      name: rawName.endsWith(` ${code}`) ? rawName.slice(0, -code.length - 1) : rawName,
      type,
      path: decode(path),
      image: img ? img.replace(/\/product_md(_extend\d+)?\//, "/product_lg$1/") : null,
      price,
      was,
      uvp: /UVP/.test(text),
      buyable: seg.slice(0, 600).match(/data-product-buyable="([^"]*)"/)?.[1] !== "false",
    });
  }
  return out;
}

export function toRecord(t: ChristTile, gender: ProductRecord["gender"], country: CountryCode = "DE"): ProductRecord {
  const origin = CHRIST_MARKETS[country]?.origin ?? CHRIST_MARKETS.DE!.origin;
  return {
    brand: "christ",
    country,
    externalId: t.code,
    name: t.name.toLowerCase().startsWith(t.brand.toLowerCase()) ? t.name : `${t.brand} ${t.name}`,
    url: `${origin}${t.path}`,
    imageUrl: t.image,
    images: cleanGallery([t.image], t.image),
    price: t.price,
    listPrice: t.was,
    currency: "EUR",
    inStock: t.buyable,
    maker: t.brand,
    category: t.type,
    gender: t.type && /unisex/i.test(t.type) ? null : gender,
    variants: null,
  };
}

export async function listChrist(
  country: CountryCode,
  fetchHtml: (u: string) => Promise<string> = (u) => getText(u, { country, timeoutMs: 60_000, headers: { "Accept-Language": CHRIST_MARKETS[country]?.lang ?? "de-DE,de;q=0.9" } }),
  includeUvp: boolean = process.env.CHRIST_INCLUDE_UVP === "1",
): Promise<ProductRecord[]> {
  const mk = CHRIST_MARKETS[country];
  if (!mk) return [];
  const seen = new Set<string>();
  const out: ProductRecord[] = [];
  let calls = 0;
  let tilesSeen = 0;
  for (const tree of CHRIST_TREES) {
    const rows: ProductRecord[] = [];
    const pages = includeUvp ? tree.uvpPages : tree.pages;
    for (let page = 0; page < pages && rows.length < tree.cap; page++) {
      if (calls++) await sleep(PAUSE_MS);
      let html: string;
      try {
        html = await fetchHtml(`${mk.origin}${tree.path}${page ? `?page=${page}` : ""}`);
      } catch (err) {
        if (tree === CHRIST_TREES[0] && page === 0) throw err;
        break;
      }
      const tiles = parseTiles(html);
      if (tree === CHRIST_TREES[0] && page === 0 && tiles.length === 0) throw new Error("christ: no reduced tiles on the sale page (markup changed?)");
      tilesSeen += tiles.length;
      for (const t of tiles) {
        if (seen.has(t.code) || (t.uvp && !includeUvp)) continue;
        seen.add(t.code);
        rows.push(toRecord(t, tree.gender, country));
      }
      if (!/rel="next"/.test(html)) break;
    }
    out.push(...[...rows.filter((r) => r.inStock), ...rows.filter((r) => !r.inStock)].slice(0, tree.cap));
  }
  console.log(`christ/${country}: ${calls} pages, ${tilesSeen} reduced tiles, kept ${out.length}${includeUvp ? " (UVP rows included)" : ""}`);
  return out;
}
