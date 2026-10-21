/**
 * US/Canada Salesforce Commerce Cloud stores read from their own server-rendered
 * product grid — the fragment their infinite scroll loads (`Search-UpdateGrid`,
 * `Search-ShowAjax`, `?format=ajax`). Measured 2026-10-21 from a GitHub runner.
 *
 * All of them are asked with the app User-Agent `okhttp/4.12.0` (see
 * `_okgrid.ts`): Sally Beauty, Talbots and Boot Barn run PerimeterX, which
 * walls a browser UA from a datacenter IP (Talbots still answered one page in
 * ~6 with its error page in our probes; a walled page throws and is retried
 * once, so a refused run keeps its stored rows).
 *
 * Every store prints the struck price and the price charged now in the tile;
 * only those are used. A style whose colours or sizes differ prints a range
 * ("$109.00 - $129.00" over "$84.99 - $99.99"); it is folded conservatively —
 * the TOP of the current range against the BOTTOM of the struck one — and kept
 * only if that still shows a markdown. Checkout promotions ("Extra 30% off in
 * bag", BOGO, "2 for $X") are not prices on the tile and are ignored.
 *
 * Prices are read only when written in dollars; a page in another currency
 * (Global-e geolocation answers a non-US IP in £/€) throws instead of storing
 * a wrong-currency row.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { attrOf, decodeEntities } from "./_sfcchtml";
import { APP_UA, dollars, sleep, splitTiles } from "./_okgrid";

export type GridUscaBrand = "ariat" | "hottopic" | "ragandbone" | "saucony" | "bootbarn" | "talbots" | "sallybeauty";

type Gender = ProductRecord["gender"];
interface Section {
  /** Grid url for the item offset `start`. */
  url: (start: number) => string;
  gender: Gender;
  label: string | null;
  /** This section's share of the cap. */
  max: number;
}
interface Market {
  host: string;
  sections: Section[];
}
interface Prices {
  now: number;
  was: number;
}
interface Tile {
  id: string;
  name: string;
  href: string;
  images: string[];
  prices: Prices;
  gender?: Gender;
  category?: string | null;
  colorName?: string | null;
  groupKey?: string | null;
  maker?: string | null;
}
interface GridSite {
  markets: Partial<Record<CountryCode, Market>>;
  pageSize: number;
  maxCalls: number;
  cap: number;
  tileStart: RegExp;
  parse: (tile: string, host: string) => Tile | null;
  /** Per-request timeout (default 45 s). */
  timeoutMs?: number;
  /**
   * The wall serves an IP only `maxCalls` requests: the walk ends there, or at the
   * first wall after a good page, and keeps what it read instead of throwing.
   */
  quota?: boolean;
}

const PAUSE_MS = Number(process.env.SFCC_USCA_PAUSE_MS ?? 700);

// ─── shared tile helpers (pure) ────────────────────────────────────────────

/** Dollar amounts in a snippet of tile HTML: "$1,299.00", "C$84.99", "$84.99 - $99.99". */
export function dollarAmounts(html: string): number[] {
  const text = decodeEntities(html.replace(/<[^>]+>/g, " "));
  return [...text.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)/g)].map((m) => dollars(m[1])).filter((v) => v > 0);
}

/** The text of the element opened by the first match of `cls` (up to `span` chars, cut at the next price element). */
function elementAfter(tile: string, cls: RegExp, span = 600): string[] {
  const out: string[] = [];
  const re = new RegExp(cls.source, cls.flags.includes("g") ? cls.flags : cls.flags + "g");
  for (const m of tile.matchAll(re)) {
    const from = m.index! + m[0].length;
    const gt = tile.indexOf(">", from);
    if (gt < 0) continue;
    let chunk = tile.slice(gt + 1, gt + 1 + span);
    // Stop at the next price element so "was" never swallows "now".
    const next = chunk.search(/class="[^"]*(?:price|sales|strike|m-new|m-old)/);
    if (next > 0) chunk = chunk.slice(0, next);
    out.push(chunk.replace(/<span class="(?:sr-only|visually-hidden)">[\s\S]*?<\/span>|<small>[\s\S]*?<\/small>/g, " "));
  }
  return out;
}

/** Conservative fold of two price lists. */
export function fold(nowList: number[], wasList: number[]): Prices | null {
  if (!nowList.length || !wasList.length) return null;
  const now = Math.max(...nowList);
  const was = Math.min(...wasList);
  return now > 0 && was > now ? { now, was } : null;
}

/** SFRA: `.strike-through .value[content]` (was) and `.sales .value[content]` (now). */
export function sfraPrices(tile: string): Prices | null {
  const block = (cls: RegExp) =>
    [...tile.matchAll(new RegExp(`class="${cls.source}[^"]*"[^>]*>[\\s\\S]{0,500}?content="([\\d.,]+)"`, "g"))].map((m) => dollars(m[1]));
  // A price written in another currency is not ours to read.
  if (/(?:&pound;|£|€|&euro;)\s*\d/.test(tile)) return null;
  return fold(block(/sales\b/), block(/strike-through\b/));
}

/** SiteGenesis: the text of the standard-price and sale-price elements. */
export function sgPrices(tile: string, nowCls: RegExp, wasCls: RegExp): Prices | null {
  const now = elementAfter(tile, nowCls).flatMap(dollarAmounts);
  const was = elementAfter(tile, wasCls).flatMap(dollarAmounts);
  return fold(now, was);
}

const firstMatch = (s: string, re: RegExp): string | null => s.match(re)?.[1] ?? null;
const clean = (s: string | null | undefined) => decodeEntities(String(s ?? "")).replace(/\s+/g, " ").trim();
const abs = (host: string, href: string) => (/^https?:/.test(href) ? href : `${host}${href.startsWith("/") ? "" : "/"}${href}`);
const uniq = (xs: string[]) => [...new Set(xs)];

function genderWord(s: string | null | undefined): Gender {
  const v = String(s ?? "").toLowerCase();
  if (/\b(kids?|girls?|boys?|youth|toddler|little kid|big kid)\b/.test(v)) return "cocuk";
  if (/\bwom[ae]n'?s?\b/.test(v)) return "kadin";
  if (/\bm[ae]n'?s?\b/.test(v)) return "erkek";
  return null;
}

// ─── per-store tile parsers ────────────────────────────────────────────────

/** Ariat: SFRA tile `product-tile-container` with id, master and name as attributes. */
export function parseAriatTile(tile: string, host: string): Tile | null {
  const head = tile.match(/^<div[^>]*>/)?.[0] ?? "";
  const id = attrOf(head, "data-pid");
  const master = attrOf(head, "data-master-id");
  const name = clean(attrOf(head, "data-product-name"));
  const href = firstMatch(tile, /<a class="js_pdp-link"[^>]*href="([^"]+)"/) ?? firstMatch(tile, /href="(https:\/\/www\.ariat\.com\/[^"]+\.html[^"]*)"/);
  const prices = sfraPrices(tile);
  if (!id || !name || !href || !prices) return null;
  const imgs = uniq([...tile.matchAll(/(?:data-)?src="(https:\/\/www\.ariat\.com\/dw\/image\/v2\/[^"?]+)\?/g)].map((m) => `${m[1]}?sw=800&sh=800`));
  const g = clean(firstMatch(tile, /class="product-gender_text">([^<]+)</));
  return {
    id,
    name,
    href: decodeEntities(href),
    images: imgs,
    prices,
    gender: genderWord(g) ?? (/unisex/i.test(g) ? null : genderWord(name)),
    groupKey: master ? `ariat:${master}` : null,
    colorName: clean(firstMatch(decodeEntities(href), /_color=([^&]+)/)) || null,
  };
}

/** Hot Topic: standard SFRA `div.product[data-pid]`; photos on Amplience. */
export function parseHotTopicTile(tile: string, host: string): Tile | null {
  const id = firstMatch(tile, /data-pid="([^"]+)"/);
  const link = tile.match(/<div class="pdp-link">\s*<a class="link" href="([^"]+)"[^>]*>([^<]+)<\/a>/);
  const prices = sfraPrices(tile);
  if (!id || !link || !prices) return null;
  const imgs = uniq([...tile.matchAll(/https:\/\/cdn\.media\.amplience\.net\/s\/hottopic\/([A-Za-z0-9_-]+)/g)].map((m) => `https://cdn.media.amplience.net/s/hottopic/${m[1]}?$productTileDesktop$&fmt=auto`));
  return { id, name: clean(link[2]), href: decodeEntities(link[1]), images: imgs, prices };
}

/** rag & bone: `section.b-product_tile` with name/id attributes and an analytics JSON. */
export function parseRagBoneTile(tile: string, host: string): Tile | null {
  const head = tile.match(/^<section[\s\S]*?>/)?.[0] ?? "";
  const id = attrOf(head, "data-pid");
  const name = clean(attrOf(head, "data-product-name"));
  const href = firstMatch(tile, /class="b-product_tile-image_link"[\s\S]{0,300}?href="([^"]+)"/);
  const was = elementAfter(tile, /class="b-price-item m-old\b/, 200).flatMap(dollarAmounts);
  const now = elementAfter(tile, /class="b-price-item m-new\b/, 200).flatMap(dollarAmounts);
  const prices = fold(now, was);
  if (!id || !name || !href || !prices) return null;
  let a: any = {};
  try {
    a = JSON.parse(attrOf(head, "data-analytics") ?? "{}");
  } catch {
    a = {};
  }
  const cats = [a.item_category, a.item_category2, a.item_category3, a.item_category4].map(String).join(" ");
  const gender: Gender = /wom[ae]n/i.test(cats) ? "kadin" : /\bmens?\b|-mens?\b|sale-men/i.test(cats) ? "erkek" : null;
  const imgs = uniq([...tile.matchAll(/https:\/\/cdn\.media\.amplience\.net\/i\/rb\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/g)].map((m) => `https://cdn.media.amplience.net/i/rb/${m[1]}/${m[2]}?$medium$&fmt=auto`));
  const colour = clean(firstMatch(tile, /m-selected[^"]*"[\s\S]{0,200}?data-color-name="([^"]+)"/)) || null;
  return {
    id: colour ? `${id}-${firstMatch(tile, /m-selected[^"]*"[\s\S]{0,200}?data-color-id="([^"]+)"/) ?? colour}` : id,
    name,
    href: decodeEntities(href),
    images: imgs,
    prices,
    gender,
    category: typeof a.item_category === "string" ? a.item_category.replace(/-sale$/, "").replace(/-/g, " ") : null,
    colorName: colour,
    groupKey: `ragandbone:${id}`,
  };
}

/** Saucony (Wolverine SiteGenesis): one tile per style colour (`data-itemid` + `data-color`). */
export function parseSauconyTile(tile: string, host: string): Tile | null {
  const head = tile.match(/^<div[^>]*>/)?.[0] ?? "";
  const pid = attrOf(head, "data-itemid");
  const link = tile.match(/<a class="name-link" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
  const prices = sgPrices(tile, /class="product-sales-price"/, /class="product-standard-price"/);
  if (!pid || !link || !prices) return null;
  const href = decodeEntities(link[1]);
  const colour = firstMatch(href, /_color=([^&]+)/);
  const imgs = uniq([...tile.matchAll(/https:\/\/thekit\.wolverineworldwide\.com\/match\/media_lookup\/([A-Za-z0-9_-]+)\//g)].map((m) => `https://thekit.wolverineworldwide.com/match/media_lookup/${m[1]}/?preset=dw-large`));
  const name = clean(link[2]);
  return {
    id: colour ? `${pid}-${colour}` : pid,
    name,
    href,
    images: imgs,
    prices,
    gender: genderWord(name),
    groupKey: `saucony:${pid}`,
  };
}

/** Boot Barn (SiteGenesis behind Global-e): `product-standard-price` over `product-total-price`. */
export function parseBootBarnTile(tile: string, host: string): Tile | null {
  const id = firstMatch(tile, /data-itemid="([^"]+)"/);
  const link = tile.match(/<a class="name-link" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
  const prices = sgPrices(tile, /class="product-total-price\b/, /class="product-standard-price"/);
  if (!id || !link || !prices) return null;
  let gtm: any = {};
  try {
    gtm = JSON.parse(attrOf(tile.match(/<div class="productCardMetadata[^>]*>/)?.[0] ?? "", "data-product-gtm-json") ?? "{}");
  } catch {
    gtm = {};
  }
  const imgs = uniq([...tile.matchAll(/https:\/\/www\.bootbarn\.com\/dw\/image\/v2\/[^"'?\s]+_P1\.JPG/gi)].map((m) => `${m[0]}?sw=800&sh=800&sm=fit`));
  const name = clean(link[2]);
  return {
    id,
    name,
    href: decodeEntities(link[1]).split("?")[0],
    images: imgs,
    prices,
    gender: genderWord(name),
    maker: typeof gtm.brand === "string" && gtm.brand.trim() ? gtm.brand.trim() : null,
    category: typeof gtm.category === "string" ? gtm.category : null,
  };
}

/** Talbots (SiteGenesis): ranges per style, `product-standard-price` over `product-sales-price`. */
export function parseTalbotsTile(tile: string, host: string): Tile | null {
  const id = firstMatch(tile, /data-itemid="([^"]+)"/);
  const link = tile.match(/<a class="name-link" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
  // The hidden duplicate blocks (regularpriceprice / hardmarkprice) repeat the same prices.
  const pricing = tile.slice(tile.indexOf('class="product-pricing"'));
  const prices = sgPrices(pricing, /class="product-sales-price\b/, /class="product-standard-price"/);
  if (!id || !link || !prices) return null;
  const u = new URL(decodeEntities(link[1]), host);
  u.searchParams.delete("cgid");
  const colour = [...u.searchParams.entries()].find(([k]) => /_color$/.test(k))?.[1] ?? null;
  // Product photos are `/images/<style>/<style>_<colour>.jpg`; bare `/images/<colour>.jpg` are swatches.
  const photos = [...tile.matchAll(/https:\/\/www\.talbots\.com\/dw\/image\/v2\/[^"'?\s]+\/images\/\d+\/(\d+_\d+)\.jpg/g)];
  const shown = photos[0]?.[1].split("_")[1];
  const imgs = uniq(photos.filter((m) => m[1].endsWith(`_${shown}`)).map((m) => `${m[0]}?sw=740&sh=980&sm=fit`));
  return { id, name: clean(link[2]), href: u.toString(), images: imgs, prices, gender: "kadin", colorName: colour ? clean(colour) : null };
}

/** Sally Beauty (SFRA): `grid-tile[data-pid]` with gtm attributes; the brand is the maker. */
export function parseSallyTile(tile: string, host: string): Tile | null {
  const head = tile.match(/<div class="grid-tile"[^>]*>/)?.[0] ?? "";
  const id = attrOf(head, "data-pid");
  const link = tile.match(/<a class="link\s+pdp-link__name[^"]*" href="([^"]+)"[^>]*>([^<]+)<\/a>/);
  const prices = sfraPrices(tile);
  if (!id || !link || !prices) return null;
  const imgs = uniq([...tile.matchAll(/https:\/\/www\.sallybeauty\.com\/dw\/image\/v2\/[^"'?\s]+\.(?:jpg|png)/gi)].map((m) => `${m[0]}?sw=600&sh=600&sfrm=png`));
  return {
    id,
    name: clean(link[2]),
    href: decodeEntities(link[1]),
    images: imgs,
    prices,
    maker: clean(firstMatch(tile, /<p class="pdp-link__brand">([^<]+)<\/p>/)) || null,
    category: clean(attrOf(head, "data-gtm-category")) || null,
  };
}

// ─── the stores ────────────────────────────────────────────────────────────

const sfraGrid = (host: string, site: string, locale: string, action: string, cgid: string, size: number, extra = "") => (start: number) =>
  `${host}/on/demandware.store/Sites-${site}-Site/${locale}/${action}?cgid=${cgid}${extra}&start=${start}&sz=${size}`;

export const GRID_USCA: Record<GridUscaBrand, GridSite> = {
  ariat: {
    // 1,163 clearance styles (Oct 2026); there is no Canadian store. The grid
    // answers 24 tiles whatever `sz` asks for.
    markets: {
      US: {
        host: "https://www.ariat.com",
        sections: [{ url: sfraGrid("https://www.ariat.com", "Ariat", "default", "Search-UpdateGrid", "clearance", 24), gender: null, label: null, max: 1500 }],
      },
    },
    pageSize: 24,
    maxCalls: 60,
    cap: 1500,
    tileStart: /<div class="product-tile-container js-product-tile\b/,
    parse: parseAriatTile,
  },
  hottopic: {
    // Clearance by section; the all-clearance tree also holds figures, home and
    // collectibles, which these sections leave out.
    markets: {
      US: {
        host: "https://www.hottopic.com",
        sections: [
          ["sale-girls", "kadin", "Girls", 700],
          ["sale-guys", "erkek", "Guys", 450],
          ["sale-accessories", null, "Accessories", 250],
          ["sale-bags-and-wallets", null, "Bags", 50],
          ["sale-backpacks", null, "Backpacks", 50],
        ].map(([cgid, gender, label, max]) => ({
          url: sfraGrid("https://www.hottopic.com", "hottopic", "default", "Search-ShowAjax", cgid as string, 60),
          gender: gender as Gender,
          label: label as string,
          max: max as number,
        })),
      },
    },
    pageSize: 60,
    maxCalls: 40,
    cap: 1500,
    tileStart: /<div class="product" data-pid=/,
    parse: parseHotTopicTile,
  },
  ragandbone: {
    markets: {
      US: {
        host: "https://www.rag-bone.com",
        sections: [{ url: sfraGrid("https://www.rag-bone.com", "ragandbone", "en_US", "Search-UpdateGrid", "sale", 48), gender: null, label: null, max: 1500 }],
      },
    },
    pageSize: 48,
    maxCalls: 34,
    cap: 1500,
    tileStart: /<section\s+class="b-product_tile\b/,
    parse: parseRagBoneTile,
  },
  saucony: {
    markets: {
      US: {
        host: "https://www.saucony.com",
        sections: [{ url: (s) => `https://www.saucony.com/en/sale/?prefn1=isOnSale&prefv1=true&start=${s}&sz=48&format=ajax`, gender: null, label: null, max: 1500 }],
      },
      CA: {
        host: "https://www.saucony.com",
        sections: [{ url: (s) => `https://www.saucony.com/CA/en_CA/saucony-sale/?prefn1=isOnSale&prefv1=true&start=${s}&sz=48&format=ajax`, gender: null, label: null, max: 1500 }],
      },
    },
    pageSize: 48,
    maxCalls: 34,
    cap: 1500,
    tileStart: /<div class="product-tile" id=/,
    parse: parseSauconyTile,
  },
  bootbarn: {
    // Clearance only: the /sale tree is mostly "2 for $X" and "$99 boots"
    // promotions without a struck price. PerimeterX walls a browser UA from a
    // runner; the app UA gets the `format=ajax` grid fragment.
    markets: {
      US: {
        host: "https://www.bootbarn.com",
        sections: [
          ["womens-clearance", "kadin", "Women", 600],
          ["mens-clearance", "erkek", "Men", 600],
          ["kids-clearance", "cocuk", "Kids", 150],
          ["clearance-accessories", null, "Accessories", 150],
        ].map(([slug, gender, label, max]) => ({
          url: (s: number) => `https://www.bootbarn.com/sale/clearance/${slug}/?sz=48&start=${s}&format=ajax`,
          gender: gender as Gender,
          label: label as string,
          max: max as number,
        })),
      },
    },
    pageSize: 48,
    maxCalls: 40,
    cap: 1500,
    tileStart: /<div class="product-tile" id=/,
    parse: parseBootBarnTile,
  },
  talbots: {
    // 1,917 sale styles (Oct 2026). Same PerimeterX rule as Boot Barn, and a quota:
    // a runner IP gets three grid pages, every later call is a 302 to PX-Show, at any
    // pace and UA (probes 39674470505, 39678163885, 39684561862, 39685263884 on
    // 2026-10-21: requests 1-3 served, 4+ walled, with 10 s pauses too). So three
    // 500-tile pages (= the cap). A deep big page renders slowly (start=1000&sz=500:
    // 44 s to first byte from the Mac), hence the long timeout.
    markets: {
      US: {
        host: "https://www.talbots.com",
        sections: [{ url: (s) => `https://www.talbots.com/sale?start=${s}&sz=500&format=ajax`, gender: "kadin", label: null, max: 1500 }],
      },
    },
    pageSize: 500,
    maxCalls: 3,
    timeoutMs: 90_000,
    quota: true,
    cap: 1500,
    tileStart: /<div class="product-tile "/,
    parse: parseTalbotsTile,
  },
  sallybeauty: {
    markets: {
      US: {
        host: "https://www.sallybeauty.com",
        // `clear` is the Clearance tree (an unknown cgid silently answers the whole catalogue).
        sections: [{ url: sfraGrid("https://www.sallybeauty.com", "SA", "default", "Search-UpdateGrid", "clear", 48), gender: null, label: null, max: 1500 }],
      },
    },
    pageSize: 48,
    maxCalls: 34,
    cap: 1500,
    tileStart: /<div class="product-grid-tile"/,
    parse: parseSallyTile,
  },
};

// ─── fetching ──────────────────────────────────────────────────────────────

const WALL = /px-captcha|PX-Show|_pxCaptcha|Access to this page has been denied|cf-chl|challenge-platform|Just a moment\.\.\./i;

/** GET one grid page. Throws on a wall, a redirect or a non-200, so a refused run keeps its stored rows. */
async function getGrid(url: string, site: GridSite): Promise<string> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": APP_UA, "X-Requested-With": "XMLHttpRequest", Accept: "text/html, */*; q=0.01", "Accept-Language": "en-US,en;q=0.9" },
        redirect: "manual",
        signal: AbortSignal.timeout(site.timeoutMs ?? 45_000),
      });
      if (res.status !== 200) throw new Error(`HTTP ${res.status} for ${url}${res.headers.get("location") ? ` → ${res.headers.get("location")!.slice(0, 60)}` : ""}`);
      const html = await res.text();
      if (WALL.test(html.slice(0, 20_000)) && !site.tileStart.test(html)) throw new Error(`bot wall for ${url}`);
      if (/^\s*<!DOCTYPE html/i.test(html.slice(0, 200))) throw new Error(`wall page (full document) for ${url}`);
      return html;
    } catch (e) {
      last = e;
      if (attempt === 0) await sleep(1500);
    }
  }
  throw last;
}

/** Map a parsed tile into a record. Pure. */
export function tileRecord(brand: GridUscaBrand, country: CountryCode, host: string, t: Tile, section: Section): ProductRecord {
  return {
    brand,
    country,
    externalId: t.id,
    name: t.name,
    url: abs(host, t.href),
    imageUrl: t.images[0] ?? null,
    images: cleanGallery(t.images, t.images[0] ?? null),
    price: toMinor(t.prices.now),
    listPrice: toMinor(t.prices.was),
    currency: COUNTRIES[country].currency,
    // Grids list orderable styles only; none of these tiles carries per-size stock.
    inStock: true,
    category: t.category ?? section.label,
    maker: t.maker ?? null,
    gender: t.gender ?? section.gender,
    variants: null,
    groupKey: t.groupKey ?? null,
    colorName: t.colorName ?? null,
  };
}

/** Register as `listGridUsca("<brand>", country)`. */
export async function listGridUsca(brand: GridUscaBrand, country: CountryCode): Promise<ProductRecord[]> {
  const site = GRID_USCA[brand];
  const market = site.markets[country];
  if (!market) return [];
  const byId = new Map<string, ProductRecord>();
  const seenRaw = new Set<string>();
  let calls = 0;
  let tilesSeen = 0;
  let quotaHit = false;
  for (const section of market.sections) {
    let taken = 0;
    for (let start = 0; taken < section.max && byId.size < site.cap && !quotaHit; ) {
      if (calls >= site.maxCalls) {
        if (site.quota) {
          quotaHit = true;
          break;
        }
        throw new Error(`${brand}/${country}: request budget (${site.maxCalls}) spent before the cap`);
      }
      if (calls++ > 0) await sleep(PAUSE_MS);
      let html: string;
      try {
        html = await getGrid(section.url(start), site);
      } catch (err) {
        if (!site.quota || !byId.size) throw err;
        console.warn(`${brand}/${country}: walled after ${calls - 1} pages, keeping ${byId.size} rows — ${String(err)}`);
        quotaHit = true;
        break;
      }
      const tiles = splitTiles(html, site.tileStart);
      if (!tiles.length) {
        if (start === 0) throw new Error(`${brand}/${country}: no tiles at ${section.url(0)}`);
        break;
      }
      tilesSeen += tiles.length;
      // Global-e geolocates a non-US egress into £/€ prices: refuse rather than page on.
      if (/(?:&pound;|£|&euro;|€)\s*\d/.test(tiles.join(""))) throw new Error(`${brand}/${country}: prices not in dollars at ${section.url(start)}`);
      let fresh = 0;
      for (const raw of tiles) {
        const key = raw.match(/data-(?:pid|itemid)="([^"]+)"/)?.[1] ?? raw.slice(0, 400);
        if (!seenRaw.has(key)) {
          seenRaw.add(key);
          fresh++;
        }
        const t = site.parse(raw, market.host);
        if (!t || byId.has(t.id)) continue;
        byId.set(t.id, tileRecord(brand, country, market.host, t, section));
        if (++taken >= section.max || byId.size >= site.cap) break;
      }
      start += tiles.length;
      // Past the end a grid comes back short, empty, or repeats its last page.
      if (tiles.length < site.pageSize || (fresh === 0 && start > site.pageSize)) break;
    }
  }
  if (!byId.size) {
    throw new Error(`${brand}/${country}: ${tilesSeen} tiles but no markdown in dollars (wrong currency or layout change?)`);
  }
  return [...byId.values()].slice(0, site.cap);
}
