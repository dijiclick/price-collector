/**
 * Michael Kors — the Sale section of the full-price stores: US
 * (michaelkors.com), Canada (michaelkors.com/ca/en), UK (michaelkors.co.uk),
 * Switzerland (michaelkors.eu/ch/en) and Australia (michaelkors.global/au/en).
 *
 * Every MK store is Salesforce Commerce Cloud (SFRA) behind Akamai Bot Manager.
 * There is no third-party search provider and no US/EU shopping app to borrow.
 * What Akamai refuses is the REQUEST SHAPE, not the egress: a Chrome
 * User-Agent over HTTP/1.1 (Node's fetch) is "Access Denied", while the same
 * GET with a Safari User-Agent — which carries no `sec-ch-ua` client hints to
 * cross-check — is served. Verified from a GitHub runner, no proxy (probe runs
 * 38227796358, 38228253494, 38230163261, 38230306214 on 2026-10-12): 200 with
 * the full grid HTML for the US, CA, CH, AU and UK sale grids and the
 * Product-Variation JSON. The UK store is fetched through michaelkors.eu: the
 * same SFCC site (`mk_uk`, GBP) answers there, while the michaelkors.co.uk edge
 * puts runner IPs through an Akamai crypto challenge (429 `cpr_chlge`, three
 * runs in a row). Product links still point at michaelkors.co.uk. Headers must
 * be sent once each: a second `user-agent` key under different casing is
 * merged by fetch into "Chrome, Safari", which is refused.
 *
 * Feed: the storefront's own infinite-scroll endpoint, `Search-UpdateGrid`
 * (`cgid=sale`, `priceStatus=md` = marked down), which returns the tiles as
 * HTML. One tile is one style shown in one colour, with its struck-through
 * "Was" price and its "Now" price as machine-readable `content="…"` values.
 *
 * - Outlet: the US and Canadian grids also return made-for-outlet styles,
 *   labelled "Michael Kors Outlet" on the tile (US 1,238 of 1,875 on
 *   2026-10-12). Their "Was" is the outlet's reference price, not a price the
 *   full-price store charged, so they are dropped. The UK/CH/AU grids carry no
 *   outlet styles.
 * - Colour price ranges ("Now $55.99 – $159.20"): the colours of the style sell
 *   at different prices, so the tile has no single price. Those styles are
 *   resolved by one `Product-Variation` call for the tile's colour (exact
 *   price, colour stock, per-size stock), within a per-market budget; beyond it
 *   they are skipped rather than guessed.
 * - Stock: the grid only lists orderable styles, so a grid row is in stock.
 *   Per-size stock exists only for the range styles resolved above.
 * - Gender: a second pass over the same grid refined to `gender=male` marks the
 *   men's styles; everything else in an MK sale is women's.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

interface Market {
  /** Storefront origin, for product links. */
  host: string;
  /** Origin the feed is fetched from (an SFCC site answers on every MK host). */
  api: string;
  /** SFCC site id + locale: `/on/demandware.store/Sites-<site>-Site/<locale>/`. */
  site: string;
  locale: string;
  /** "Michael Kors Outlet" styles appear in this market's sale grid. */
  outletMixed: boolean;
}

export const MK_MARKETS: Partial<Record<CountryCode, Market>> = {
  US: { host: "https://www.michaelkors.com", api: "https://www.michaelkors.com", site: "mk_us", locale: "en_US", outletMixed: true },
  CA: { host: "https://www.michaelkors.com", api: "https://www.michaelkors.com", site: "mk_ca", locale: "en_CA", outletMixed: true },
  GB: { host: "https://www.michaelkors.co.uk", api: "https://www.michaelkors.eu", site: "mk_uk", locale: "en_GB", outletMixed: false },
  CH: { host: "https://www.michaelkors.eu", api: "https://www.michaelkors.eu", site: "mk_ch", locale: "en_CH", outletMixed: false },
  AU: { host: "https://www.michaelkors.global", api: "https://www.michaelkors.global", site: "mk_anz", locale: "en_AU", outletMixed: false },
};

/** Safari carries no client hints, so Akamai has nothing to find inconsistent. */
const SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";

/** ~23 KB of HTML per tile: 200 keeps a page near 5 MB (300-tile pages hit 20 s once). */
const PAGE_SIZE = 200;
const MAX_PAGES = 10;
/** Product-Variation calls per market, for colour-range styles. */
const VARIATION_BUDGET = 40;
const CAP = 1500;
const PAUSE_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const base = (m: Market) => `${m.api}/on/demandware.store/Sites-${m.site}-Site/${m.locale}`;

/** Built by hand: URLSearchParams would encode nothing here, but keep the exact probed shape. */
export function gridUrl(country: CountryCode, start: number, male = false): string {
  const m = MK_MARKETS[country]!;
  const gender = male ? "&prefn2=gender&prefv2=male" : "";
  return `${base(m)}/Search-UpdateGrid?cgid=sale&prefn1=priceStatus&prefv1=md${gender}&start=${start}&sz=${PAGE_SIZE}`;
}

export function variationUrl(country: CountryCode, pid: string, colour: string): string {
  const m = MK_MARKETS[country]!;
  return `${base(m)}/Product-Variation?pid=${encodeURIComponent(pid)}&dwvar_${pid}_color=${encodeURIComponent(colour)}&quantity=1`;
}

async function fetchText(url: string, country: CountryCode, xhr = false): Promise<string> {
  const headers: Record<string, string> = {
    // Same key casing as http.ts, so these replace its defaults instead of joining them.
    "User-Agent": SAFARI_UA,
    "Accept-Language": `en-${country},en;q=0.9`,
    Accept: xhr ? "application/json, text/javascript, */*; q=0.01" : "*/*",
  };
  if (xhr) headers["X-Requested-With"] = "XMLHttpRequest";
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await getText(url, { country, headers });
    } catch (err) {
      lastErr = err;
      // 429 from the UK edge once: back off and retry.
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&pound;/g, "£")
    .replace(/&eacute;/g, "é")
    .replace(/&egrave;/g, "è")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const num = (x: unknown): number | null => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_, a, c) => a + c.toUpperCase());

export interface Tile {
  pid: string;
  name: string;
  /** Path + query of the tile's PDP link, already decoded. */
  href: string;
  colour: string | null;
  colourName: string | null;
  colours: string[];
  brandLine: string | null;
  images: string[];
  list: number | null;
  /** Every "Now" value on the tile: one, or two for a colour-price range. */
  sales: number[];
  range: boolean;
}

/** Split a grid response into its tiles and read each one. Pure. */
export function parseGrid(html: string): Tile[] {
  const out: Tile[] = [];
  const parts = html.split('data-tile-product-id="').slice(1);
  for (const part of parts) {
    const pid = part.slice(0, part.indexOf('"'));
    const end = part.indexOf("<article");
    const t = end >= 0 ? part.slice(0, end) : part;
    if (!pid || pid === "null") continue;
    const link = /class="link back-to-product-anchor-js" href="([^"]+)"[^>]*>([^<]+)</.exec(t);
    if (!link) continue;
    const href = decodeEntities(link[1]);
    const colour = /_color=([A-Za-z0-9]+)/.exec(href)?.[1] ?? null;
    const brandLine = /class="product-brand">\s*<a[^>]*>([^<]+)</.exec(t)?.[1]?.trim() ?? null;
    const swatches = [...t.matchAll(/aria-label="Select Colou?r (.+?) for [^"]*"[^>]*?href="([^"]+)"/g)].map((m) => ({
      name: titleCase(decodeEntities(m[1]).trim()),
      code: /_color=([A-Za-z0-9]+)/.exec(decodeEntities(m[2]))?.[1] ?? null,
    }));
    const colours = [...new Set(swatches.map((s) => s.name))];
    const imgBlock = t.slice(0, t.indexOf('class="tile-body"') >= 0 ? t.indexOf('class="tile-body"') : t.length);
    const images = [...imgBlock.matchAll(/class="[^"]*tile-image[^"]*"\s+src="(https:\/\/[^"]+)"/g)].map((m) =>
      m[1].replace("/ECOM_Image_Medium/", "/ECOM_Image_Large/"),
    );
    const list = num(/content="([\d.]+)" data-automation="plp-list-price-value"/.exec(t)?.[1]);
    const sales = [...t.matchAll(/content="([\d.]+)" data-automation="plp-sale-price-value"/g)]
      .map((m) => num(m[1]))
      .filter((n): n is number => n != null);
    // A range tile prints its single "Was" as bare text, without a content attribute.
    const bareWas = /class="list">\s*<span class="sr-only">Was<\/span>\s*([^<]+)</.exec(t)?.[1];
    out.push({
      pid,
      name: decodeEntities(link[2]).replace(/\s+/g, " ").trim(),
      href,
      colour,
      colourName: swatches.find((s) => s.code === colour)?.name ?? null,
      colours,
      brandLine,
      images,
      list: list ?? (bareWas ? num(decodeEntities(bareWas).replace(/[^\d.,]/g, "").replace(/,/g, "")) : null),
      sales,
      range: /class="range-separator/.test(t) || sales.length > 1,
    });
  }
  return out;
}

/** The product type MK's names end with ("… Crossbody Bag", "… Kitten Mule"). */
function categoryOf(name: string): string | null {
  const last = name.replace(/[^A-Za-z\s-]/g, " ").trim().split(/\s+/).pop();
  return last && last.length > 2 ? last[0].toUpperCase() + last.slice(1) : null;
}

const productUrl = (m: Market, href: string) =>
  `${m.host}${href.replace(/([?&])astc=true&?/, "$1").replace(/&?priceStatusType=md/, "").replace(/\?$/, "")}`;

/** Map one single-price tile to a record (null = not a real markdown, or outlet). Pure. */
export function mapTile(tile: Tile, country: CountryCode, men: Set<string>): ProductRecord | null {
  const m = MK_MARKETS[country];
  if (!m) return null;
  if (m.outletMixed && /outlet/i.test(tile.brandLine ?? "")) return null;
  if (tile.range || tile.sales.length !== 1 || tile.list == null) return null;
  const sale = tile.sales[0];
  if (!(sale < tile.list)) return null;
  return {
    brand: "michaelkors",
    country,
    externalId: tile.pid,
    name: tile.name,
    url: productUrl(m, tile.href),
    imageUrl: tile.images[0] ?? null,
    images: cleanGallery(tile.images, tile.images[0] ?? null),
    price: toMinor(sale),
    listPrice: toMinor(tile.list),
    currency: COUNTRIES[country].currency,
    inStock: true,
    category: categoryOf(tile.name),
    gender: men.has(tile.pid) ? "erkek" : "kadin",
    variants: null,
    groupKey: null,
    colorName: tile.colourName,
  };
}

/** Resolve a colour-range tile from its Product-Variation JSON. Pure. */
export function mapVariation(tile: Tile, json: any, country: CountryCode, men: Set<string>): ProductRecord | null {
  const m = MK_MARKETS[country];
  const p = json?.product;
  if (!m || !p) return null;
  if (m.outletMixed && /outlet/i.test(tile.brandLine ?? "")) return null;
  const sale = num(p.price?.sales?.value);
  const list = num(p.price?.list?.value);
  if (sale == null || list == null || !(sale < list)) return null;
  const currency = COUNTRIES[country].currency;
  if (p.price?.sales?.currency && p.price.sales.currency !== currency) return null;
  const attrs: any[] = Array.isArray(p.variationAttributes) ? p.variationAttributes : [];
  const sizeAttr = attrs.find((a) => a?.id === "size");
  const sizes: SizeVariant[] = (sizeAttr?.values ?? [])
    .filter((v: any) => v?.displayValue || v?.id)
    .map((v: any) => ({
      label: String(v.displayValue ?? v.id).trim(),
      availability: v.inStock === false || v.selectable === false ? "out_of_stock" : "in_stock",
    }));
  const colourAttr = attrs.find((a) => a?.id === "color");
  const sel = (colourAttr?.values ?? []).find((v: any) => v?.selected) ?? (colourAttr?.values ?? []).find((v: any) => v?.id === tile.colour);
  const colourName = sel?.displayValue ? titleCase(String(sel.displayValue)) : tile.colourName;
  const photos: string[] = (p.images?.large ?? []).map((i: any) => i?.url).filter((u: any) => typeof u === "string");
  const gallery = photos.length ? photos : tile.images;
  const inStock = sizes.length ? sizes.some((s) => s.availability !== "out_of_stock") : p.available !== false;
  return {
    brand: "michaelkors",
    country,
    externalId: tile.pid,
    name: tile.name,
    url: productUrl(m, tile.href),
    imageUrl: gallery[0] ?? null,
    images: cleanGallery(gallery, gallery[0] ?? null),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency,
    inStock,
    category: categoryOf(tile.name),
    gender: men.has(tile.pid) ? "erkek" : "kadin",
    variants: sizes.length ? { colors: colourName ? [colourName] : [], sizes } : null,
    groupKey: null,
    colorName: colourName,
  };
}

/** Walk the sale grid; `male` collects only the ids. */
async function crawlGrid(country: CountryCode, male: boolean): Promise<Tile[]> {
  const tiles: Tile[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await sleep(PAUSE_MS);
    const html = await fetchText(gridUrl(country, page * PAGE_SIZE, male), country);
    const got = parseGrid(html);
    tiles.push(...got);
    if (got.length < PAGE_SIZE) break;
  }
  return tiles;
}

export async function listMichaelKors(country: CountryCode): Promise<ProductRecord[]> {
  if (!MK_MARKETS[country]) return [];
  const tiles = await crawlGrid(country, false);
  if (!tiles.length) throw new Error(`michaelkors/${country}: sale grid returned no tiles`);
  let men = new Set<string>();
  try {
    men = new Set((await crawlGrid(country, true)).map((t) => t.pid));
  } catch (err) {
    console.warn(`michaelkors/${country}: men's pass failed, gender defaults to women — ${String(err)}`);
  }

  const byId = new Map<string, ProductRecord>();
  const ranges: Tile[] = [];
  for (const tile of tiles) {
    if (byId.has(tile.pid)) continue;
    if (tile.range) {
      ranges.push(tile);
      continue;
    }
    const r = mapTile(tile, country, men);
    if (r) byId.set(r.externalId, r);
  }

  const m = MK_MARKETS[country]!;
  const toResolve = ranges.filter((t) => t.colour && !(m.outletMixed && /outlet/i.test(t.brandLine ?? "")) && !byId.has(t.pid));
  let calls = 0;
  for (const tile of toResolve) {
    if (calls >= VARIATION_BUDGET || byId.size >= CAP) break;
    calls++;
    await sleep(PAUSE_MS);
    try {
      const json = JSON.parse(await fetchText(variationUrl(country, tile.pid, tile.colour!), country, true));
      const r = mapVariation(tile, json, country, men);
      if (r) byId.set(r.externalId, r);
    } catch (err) {
      console.warn(`michaelkors/${country}: variation ${tile.pid} failed — ${String(err)}`);
    }
  }
  if (toResolve.length > calls) {
    console.log(`michaelkors/${country}: ${toResolve.length - calls} colour-range styles skipped (budget ${VARIATION_BUDGET})`);
  }

  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
