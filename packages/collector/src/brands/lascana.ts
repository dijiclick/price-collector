/**
 * LASCANA Germany — the /sale/ listing (2026-11-10).
 *
 * ROUTE. lascana.de is an OXID shop with a server-rendered list:
 * `https://www.lascana.de/sale/` then `/sale/N/` (48 tiles a page; the list is
 * capped by the shop at "2500 Produkte gefunden" = 52 pages; page 60 answers
 * 200 with no tiles). ~740–900 KB raw / ~60 KB gzip a page. Each tile is a
 * `<figure data-productid data-variantid data-artnr>` (link, photo, `<del>`
 * price) followed by one `window.productService.tracking.products.push({...})`
 * JSON for the same variant: `bundleId` (the product), `id` (the variant),
 * `artNr` ("832331_32" = colour article + size), colour, brand, title,
 * `price`, `retailPrice`, `sale`, `availability`.
 *
 * One product shows once per colour on sale, so the row id is product +
 * colour article and `groupKey` is the product. The price pair is the tracked
 * variant's own (a tile reading "ab 59,99 €" spans sizes; the JSON does not).
 * The list carries no size run, so `variants` stays null.
 *
 * Besides LASCANA the shop sells its house labels and a few others (Vivance,
 * H.I.S, s.Oliver, Venice Beach, Elbsand …) — `maker` is the tile's brand.
 * Women's shop: every row is "kadin" unless the title says Herren.
 *
 * MARKETS. Germany as above. lascana.at (EUR) and lascana.ch (CHF) are a
 * different platform — the Otto group's "empiriecom" Next.js shop (the one
 * baur.de runs on) — read by the second half of this file: `/sale/?p=N`, 72
 * styles a page, whose React flight data (`self.__next_f.push([1,"…"])`)
 * holds one `StylePreviewItem` per style: `styleId`, `styleName`, brand, and
 * the primary colour group with photo, article number, `price.currentPrice`
 * (minor units), `price.discount.previousPrice`, `discount.wasMsrp` and the
 * size list with a delivery text each. `wasMsrp: true` is the maker's UVP
 * (shown unstruck, "UVP 37,99 €") and is skipped; `false` is the shop's own
 * struck "statt" price. Measured 2026-11-10: AT 241 sale styles (~55% with a
 * "statt" price), CH 674 (all "statt"). `isStartPrice` rows ("ab 29,90 €",
 * the cheapest size, with the shop's own "statt"/percent beside it) are kept.
 * There is no .nl/.be/.fr shop (lascana.nl redirects to an info page).
 * baur.de itself was looked at and left out: ~98% of its fashion sale is
 * UVP-only (`wasMsrp: true`), see `listEmpiriecom` if that ever changes.
 *
 * RUNNER: probe run 42801443706 — lascana.de /sale/2/ and /sale/52/ answer a
 * GitHub runner 200 (735,242 / 906,152 bytes) with the tiles, `<del> 49,99
 * </del> <strong> 29,99 €` and `priceCurrency: EUR`; lascana.at and lascana.ch
 * /sale/bekleidung/ answer 200 via istio-envoy (1,380,091 / 1,424,762 bytes)
 * with `priceCurrency` EUR / CHF and local /p/ URLs in the page's ItemList
 * (the flight data sits ~1 MB into the page, past what the probe keeps, so
 * its shape was read from the Mac).
 *
 * DE: 32 pages a sweep (≈1,500 rows). AT ≤4, CH ≤10 pages. One request at a time.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { decodeEntities } from "./_sfcchtml";
import type { CountryCode } from "../../../../lib/countries";

const SITE = "https://www.lascana.de";
const MAX_PAGES = 32;
const CAP = 1500;
const PAUSE_MS = Number(process.env.LASCANA_PAUSE_MS ?? 400);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const cents = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const clean = (v: unknown): string => (typeof v === "string" ? decodeEntities(v).replace(/\s+/g, " ").trim() : "");

export interface LascanaTile {
  productId: string;
  variantId: string;
  artNr: string;
  href: string | null;
  image: string | null;
  /** The tile's own tracking record (same variant), or null when it is missing. */
  track: any | null;
}

/** Every tile of a list page, each with the tracking JSON that follows it. Pure. */
export function parseTiles(html: string): LascanaTile[] {
  const starts = [...html.matchAll(/<figure data-productid="(\d+)" data-variantid="(\d+)" data-artnr="([^"]*)">/g)];
  const out: LascanaTile[] = [];
  for (let i = 0; i < starts.length; i++) {
    const m = starts[i];
    const seg = html.slice(m.index!, starts[i + 1]?.index ?? m.index! + 40000);
    const href = seg.match(/<a class="product-link" href="([^"]+)"/)?.[1] ?? null;
    // The first photo is this variant's; prefer the largest JPEG rendition.
    const first = seg.slice(0, seg.indexOf("</picture>") + 1 || seg.length);
    const image =
      first.match(/srcset="(https:\/\/bilder\.lascana\.de\/styles\/569x812\/[^"]+\.jpg)"/)?.[1] ??
      first.match(/<img class="[^"]*product-image[^"]*" src="(https:\/\/[^"]+)"/)?.[1] ??
      null;
    let track: any = null;
    const js = seg.match(/tracking\.products\.push\((\{.*?\})\);/s)?.[1];
    if (js) {
      try {
        track = JSON.parse(js);
      } catch {
        track = null;
      }
    }
    out.push({ productId: m[1], variantId: m[2], artNr: m[3], href: href ? decodeEntities(href) : null, image, track });
  }
  return out;
}

/** One tile → record, or null when it is not a real struck-price row. Pure. */
export function mapTile(t: LascanaTile): ProductRecord | null {
  const k = t.track;
  if (!k || String(k.id) !== t.variantId || String(k.bundleId) !== t.productId || !t.href?.startsWith("/")) return null;
  if (k.sale !== true) return null;
  const price = cents(k.price);
  const was = cents(k.retailPrice);
  if (!(price > 0) || !(was > price)) return null;
  const maker = clean(k.brand);
  const title = clean(k.title);
  if (!title) return null;
  const color = clean(k.color);
  const name = !maker || title.toLowerCase().startsWith(maker.toLowerCase()) ? title : `${maker} ${title}`;
  const article = t.artNr.split("_")[0] || t.variantId;
  return {
    brand: "lascana",
    country: "DE",
    externalId: `${t.productId}-${article}`,
    name,
    url: `${SITE}${t.href}`,
    imageUrl: t.image,
    images: cleanGallery([t.image], t.image),
    price,
    listPrice: was,
    currency: "EUR",
    // "Immediately" (in stock) or a delivery promise; only an explicit sold-out is out.
    inStock: !/sold|ausverkauft|unavailable|notavailable|outofstock/i.test(clean(k.availability)),
    category: title,
    maker: maker || "LASCANA",
    gender: /\bherren\b/i.test(`${title} ${t.href}`) ? "erkek" : "kadin",
    variants: null,
    groupKey: `lascana:${t.productId}`,
    colorName: color || null,
  };
}

export async function listLascana(
  country: CountryCode,
  fetchHtml: (u: string) => Promise<string> = (u) =>
    getText(u, { country, timeoutMs: 60_000, headers: { "Accept-Language": `de-${country},de;q=0.9` } }),
): Promise<ProductRecord[]> {
  const shop = LASCANA_EMPIRIECOM[country];
  if (shop) return listEmpiriecom(shop, country, fetchHtml);
  if (country !== "DE") return [];
  const byId = new Map<string, ProductRecord>();
  let pages = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (pages) await sleep(PAUSE_MS);
    let html: string;
    try {
      html = await fetchHtml(page > 1 ? `${SITE}/sale/${page}/` : `${SITE}/sale/`);
    } catch (err) {
      if (page === 1) throw err;
      break;
    }
    pages++;
    const tiles = parseTiles(html);
    if (tiles.length === 0) {
      if (page === 1) throw new Error("lascana: no tiles on the sale page (markup changed?)");
      break;
    }
    let fresh = 0;
    for (const t of tiles) {
      const r = mapTile(t);
      if (!r || byId.has(r.externalId)) continue;
      byId.set(r.externalId, r);
      fresh++;
    }
    if (page === 1 && fresh === 0) throw new Error("lascana: no reduced rows on the sale page (tracking data changed?)");
    if (!new RegExp(`href="/sale/${page + 1}/"`).test(html)) break;
  }
  const all = [...byId.values()];
  const out = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
  console.log(`lascana/${country}: ${pages} pages, ${all.length} reduced, kept ${out.length}`);
  return out;
}

// ───────────────────────── empiriecom (lascana.at / lascana.ch) ─────────────────────────

export interface EmpiriecomShop {
  /** The `brand` slug the rows are stored under. */
  slug: string;
  origin: string;
  currency: string;
  /** Sale listings to walk, in order. */
  paths: string[];
  maxPages: number;
  /** Section of the shop, when the whole listing is one. */
  gender: ProductRecord["gender"];
}

export const LASCANA_EMPIRIECOM: Partial<Record<CountryCode, EmpiriecomShop>> = {
  AT: { slug: "lascana", origin: "https://www.lascana.at", currency: "EUR", paths: ["/sale/"], maxPages: 6, gender: "kadin" },
  CH: { slug: "lascana", origin: "https://www.lascana.ch", currency: "CHF", paths: ["/sale/"], maxPages: 12, gender: "kadin" },
};

const EMP_PER_PAGE = 72;

/** The page's React flight data, its chunks decoded and joined. Pure. */
export function flightOf(html: string): string {
  let out = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try {
      out += JSON.parse(m[1]);
    } catch {
      // an undecodable chunk is skipped
    }
  }
  return out;
}

/** The JSON object that starts at `from` (a `{`), by brace matching outside strings. */
function objectAt(s: string, from: number): any | null {
  let depth = 0;
  let inStr = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(s.slice(from, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Every `StylePreviewItem` of a listing page plus the listing's total. Pure. */
export function parseStyles(html: string): { styles: any[]; total: number | null } {
  const fl = flightOf(html);
  const styles: any[] = [];
  for (const m of fl.matchAll(/\{"styleId":"/g)) {
    const o = objectAt(fl, m.index!);
    if (o?.primaryVariationGroup) styles.push(o);
  }
  const total = fl.match(/"totalResultCount":(\d+)/)?.[1];
  return { styles, total: total ? Number(total) : null };
}

const SOLD_OUT = /ausverkauft|nicht (mehr )?(lieferbar|verfügbar|erhältlich)|vergriffen/i;

/** One style → record, or null unless the shop struck its OWN earlier price ("statt"). Pure. */
export function mapStyle(o: any, shop: EmpiriecomShop, country: CountryCode): ProductRecord | null {
  const g = o?.primaryVariationGroup;
  const pr = g?.price;
  const styleId = clean(o?.styleId);
  if (!styleId || !pr || pr.currency !== shop.currency) return null;
  const price = Number(pr.currentPrice);
  const was = Number(pr.discount?.previousPrice);
  // `wasMsrp` = the maker's UVP, a price the shop never charged.
  if (pr.discount?.wasMsrp !== false) return null;
  if (!Number.isInteger(price) || price <= 0 || !Number.isInteger(was) || was <= price) return null;
  const maker = clean(o.brand?.name);
  const title = clean(o.styleName).replace(/\s*(\.\.\.|…)$/, "");
  if (!title) return null;
  const name = !maker || title.toLowerCase().startsWith(maker.toLowerCase()) ? title : `${maker} ${title}`;
  const sku = clean(g.href).match(/[?&]sku=([^&]+)/)?.[1];
  const image = typeof g.image === "string" && g.image.startsWith("https://") ? g.image : null;
  const sizes = (Array.isArray(g.availability?.variations) ? g.availability.variations : [])
    .map((v: any) => ({ label: clean(v?.name), out: SOLD_OUT.test(clean(v?.availability?.description)) }))
    .filter((v: { label: string }) => v.label)
    .map((v: { label: string; out: boolean }) => ({ label: v.label, availability: v.out ? ("out_of_stock" as const) : ("in_stock" as const) }));
  const type = title.split(/[»,(]| mit /)[0].replace(/^Set:\s*/i, "").trim();
  const color = clean(g.groupName);
  return {
    brand: shop.slug,
    country,
    externalId: `${styleId}-${clean(g.articleNumber) || "0"}`,
    name,
    url: `${shop.origin}/p/${styleId}${sku ? `?sku=${sku}` : ""}`,
    imageUrl: image,
    images: cleanGallery([image], image),
    price,
    listPrice: was,
    currency: shop.currency,
    inStock: sizes.length === 0 || sizes.some((v: { availability: string }) => v.availability === "in_stock"),
    category: type && type.length <= 40 ? type : null,
    maker: maker || null,
    gender: /\bherren\b/i.test(title) ? "erkek" : shop.gender,
    variants: sizes.length ? { colors: color ? [color] : [], sizes } : null,
    groupKey: `${shop.slug}:${styleId}`,
    colorName: color || null,
  };
}

/** Walk an empiriecom shop's sale listings (`?p=N`). First page of the first listing must work. */
export async function listEmpiriecom(
  shop: EmpiriecomShop,
  country: CountryCode,
  fetchHtml: (u: string) => Promise<string>,
): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  let pages = 0;
  for (const path of shop.paths) {
    for (let page = 1; page <= shop.maxPages; page++) {
      if (pages) await sleep(PAUSE_MS);
      let html: string;
      try {
        html = await fetchHtml(`${shop.origin}${path}${page > 1 ? `?p=${page}` : ""}`);
      } catch (err) {
        if (pages === 0) throw err;
        break;
      }
      pages++;
      const { styles, total } = parseStyles(html);
      if (pages === 1 && styles.length === 0) throw new Error(`${shop.slug}/${country}: no styles in the sale page's flight data (markup changed?)`);
      if (styles.length === 0) break;
      for (const o of styles) {
        const r = mapStyle(o, shop, country);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (styles.length < EMP_PER_PAGE || (total != null && page * EMP_PER_PAGE >= total)) break;
    }
  }
  const all = [...byId.values()];
  const out = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
  console.log(`${shop.slug}/${country}: ${pages} pages, ${all.length} reduced, kept ${out.length}`);
  return out;
}
