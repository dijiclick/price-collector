/**
 * America Today (NL, BE, DE) — the Dames and Heren SALE grids (2026-11-10).
 *
 * america-today.com is Salesforce Commerce Cloud (site `AmericaToday`, one site,
 * a locale per market: nl_NL, nl_BE, de_DE — all EUR). The listing's own
 * "show more" button calls `Search-UpdateGrid?cgid=…&start=N&sz=48`, which
 * answers server-rendered tiles to anyone (no cookie, no wall on the Mac or on a
 * GitHub runner — probe runs in the report). 48 tiles a page is the ceiling.
 *
 * Each tile carries the product id ("2252002493 903" = style + colour), the PDP
 * path, both prices (`strike-through list` / `sales`, as `content="22.99"`) and
 * the photo slider. The page ends with the shop's own tag-manager object
 * (`var ecommerceObj = JSON.parse('…')`) holding, per item, the display name,
 * colour, product type and `size_chart` = the sizes that can be bought now.
 * The tile's price is the one the shopper sees (the tracking object's
 * `sale_price` lags behind promotions), so prices come from the tile only.
 *
 * Sale categories are shared by all locales: `sale_NL_959` women, `sale_NL_967`
 * men (kids skipped).
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import type { CountryCode } from "../../../../lib/countries";
import { decodeEntities } from "./_sfcchtml";

// `decodeEntities` knows the common named entities; these markets need a few more.
const EXTRA: Record<string, string> = { szlig: "ß", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", ugrave: "ù", igrave: "ì", ograve: "ò", acirc: "â", ocirc: "ô", icirc: "î", ucirc: "û", euml: "ë", iuml: "ï", atilde: "ã", otilde: "õ", Eacute: "É", rsquo: "’", ndash: "–", deg: "°" };
const decode = (s: string): string => decodeEntities(s.replace(/&([A-Za-z]+);/g, (m, e: string) => EXTRA[e] ?? m));

const ORIGIN = "https://www.america-today.com";
export const AMERICATODAY_MARKETS: Partial<Record<CountryCode, { locale: string; lang: string }>> = {
  NL: { locale: "nl_NL", lang: "nl-NL,nl;q=0.9" },
  BE: { locale: "nl_BE", lang: "nl-BE,nl;q=0.9" },
  DE: { locale: "de_DE", lang: "de-DE,de;q=0.9" },
};
export const AMERICATODAY_TREES: { cgid: string; gender: "kadin" | "erkek"; pages: number }[] = [
  { cgid: "sale_NL_959", gender: "kadin", pages: 22 },
  { cgid: "sale_NL_967", gender: "erkek", pages: 10 },
];
const PER_PAGE = 48;
const CAP = 1500;
const PAUSE_MS = Number(process.env.AMERICATODAY_PAUSE_MS ?? 400);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const gridUrl = (locale: string, cgid: string, start: number) =>
  `${ORIGIN}/on/demandware.store/Sites-AmericaToday-Site/${locale}/Search-UpdateGrid?cgid=${cgid}&start=${start}&sz=${PER_PAGE}`;

export interface AtTile {
  pid: string;
  path: string;
  name: string;
  price: number;
  was: number;
  inStock: boolean;
  images: string[];
}

const cents = (s: string | undefined): number => Math.round(parseFloat(s ?? "") * 100);

/** Every reduced tile of one grid page. Pure. */
export function parseTiles(html: string): AtTile[] {
  const starts = [...html.matchAll(/<div class="product" data-pid="/g)].map((m) => m.index!);
  const out: AtTile[] = [];
  for (let i = 0; i < starts.length; i++) {
    const seg = html.slice(starts[i], starts[i + 1] ?? html.length);
    const pid = seg.match(/^<div class="product" data-pid="([^"]+)"/)?.[1];
    const path = seg.match(/data-pdp-url="([^"]+)"/)?.[1];
    const name = seg.match(/<meta itemprop="name" content="([^"]*)"/)?.[1];
    const was = cents(seg.match(/strike-through list[^>]*>\s*<span class="value" content="([\d.]+)"/)?.[1]);
    const price = cents(seg.match(/<span class="sales[^"]*">\s*<span class="value" content="([\d.]+)"/)?.[1]);
    if (!pid || !path || !name || !(price > 0) || !(was > price)) continue;
    const images = [...seg.matchAll(/(?:src|data-lazy)="(https:\/\/www\.america-today\.com\/dw\/image\/[^"]+)"/g)]
      .map((m) => decode(m[1]))
      .filter((u) => !/_c\.jpg/.test(u)); // `_c` = the colour swatch
    out.push({
      pid: decode(pid),
      path: decode(path),
      name: decode(name),
      price,
      was,
      inStock: !/itemprop="availability" content="[^"]*OutOfStock/i.test(seg),
      images,
    });
  }
  return out;
}

export interface AtItem {
  item_id: string;
  item_name?: string;
  color_detail?: string;
  size_chart?: string;
  item_id_master?: string;
  item_category3?: string;
  item_category2?: string;
}

/** The page's tag-manager items, by product id. Pure; empty when the block is absent. */
export function parseItems(html: string): Map<string, AtItem> {
  const out = new Map<string, AtItem>();
  const raw = html.match(/var ecommerceObj = JSON\.parse\('([\s\S]*?)'\);/)?.[1];
  if (!raw) return out;
  try {
    const j = JSON.parse(raw.replace(/\\'/g, "'").replace(/\\\\/g, "\\"));
    for (const it of j?.ecommerce?.items ?? []) if (it?.item_id) out.set(String(it.item_id), it);
  } catch {
    /* sizes and type are optional */
  }
  return out;
}

export function toRecord(t: AtTile, item: AtItem | undefined, gender: ProductRecord["gender"], country: CountryCode): ProductRecord {
  const sizes = (item?.size_chart ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  const image = t.images[0] ?? null;
  return {
    brand: "americatoday",
    country,
    externalId: t.pid.replace(/\s+/g, "-"),
    name: (item?.item_name ?? t.name).trim(),
    url: `${ORIGIN}${t.path}`,
    imageUrl: image,
    images: cleanGallery(t.images, image),
    price: t.price,
    listPrice: t.was,
    currency: "EUR",
    inStock: t.inStock,
    category: item?.item_category3 || item?.item_category2 || null,
    gender,
    variants: sizes.length ? { colors: [], sizes: sizes.map((label) => ({ label, availability: "in_stock" as const })) } : null,
    // `size_chart` lists only the sizes on the shelf.
    sizesInStockOnly: sizes.length ? true : undefined,
    groupKey: item?.item_id_master ? `americatoday:${item.item_id_master}` : null,
    colorName: item?.color_detail?.trim() || null,
  };
}

export async function listAmericaToday(
  country: CountryCode,
  fetchHtml: (u: string) => Promise<string> = (u) =>
    getText(u, { country, timeoutMs: 45_000, headers: { "X-Requested-With": "XMLHttpRequest", "Accept-Language": AMERICATODAY_MARKETS[country]?.lang ?? "nl-NL" } }),
): Promise<ProductRecord[]> {
  const mk = AMERICATODAY_MARKETS[country];
  if (!mk) return [];
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const tree of AMERICATODAY_TREES) {
    for (let page = 0; page < tree.pages; page++) {
      if (calls++) await sleep(PAUSE_MS);
      let html: string;
      try {
        html = await fetchHtml(gridUrl(mk.locale, tree.cgid, page * PER_PAGE));
      } catch (err) {
        if (calls === 1) throw err;
        break;
      }
      const tiles = parseTiles(html);
      if (calls === 1 && tiles.length === 0) throw new Error("americatoday: no reduced tiles on the first sale page (markup changed?)");
      const items = parseItems(html);
      let fresh = 0;
      for (const t of tiles) {
        const r = toRecord(t, items.get(t.pid), tree.gender, country);
        if (byId.has(r.externalId)) continue;
        byId.set(r.externalId, r);
        fresh++;
      }
      // The grid offers "show more" (a next `start=`) until the last page.
      if (!fresh || !new RegExp(`start=${(page + 1) * PER_PAGE}&(?:amp;)?sz=`).test(html)) break;
    }
  }
  const all = [...byId.values()];
  const out = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
  console.log(`americatoday/${country}: ${calls} pages, ${all.length} reduced, kept ${out.length}`);
  return out;
}
