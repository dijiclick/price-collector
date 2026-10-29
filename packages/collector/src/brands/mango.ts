import { cleanGallery, type ProductRecord, type SizeVariant, type Availability } from "../types";
import { getJson } from "../http";
import { browserText } from "../browser";
import { toMinor } from "../normalize";
import { ALL_COUNTRIES, currencyFor, type CountryCode } from "../../../../lib/countries";

const SITE = "https://shop.mango.com";
const ORCH = "https://online-orchestrator.mango.com";
/** Host of the catalog API the PLP itself pages through (not behind the Vercel checkpoint). */
const API = "https://api.shop.mango.com";
// The orchestrator (Akamai) rejects bare requests; browser-ish Origin/Referer are required.
const HEADERS = {
  Accept: "application/json",
  Origin: SITE,
  Referer: `${SITE}/`,
};

// Full-sale-catalog mode: ~6k products x 3 light orchestrator calls each. The
// calls are CDN-fast (~50ms measured at concurrency 12), so 16 products
// in-flight (48 requests) clears ~6k products well inside the collector's
// 5-minute brand budget. MAX_PRODUCTS is a safety cap, not a working limit.
const MAX_PRODUCTS = Number(process.env.MANGO_MAX_PRODUCTS ?? 8000);
// Catalog pages hold 100 entries; women's see-all is ~63 pages. A cap, not a target.
const MAX_CATALOG_PAGES = 120;
const PAGE_CONCURRENCY = 4;
// Women, men, teen girls, boys, girls: the five known sale ids (see SALE_CATEGORIES).
const MAX_SEED_CATEGORIES = Number(process.env.MANGO_MAX_SEED_CATEGORIES ?? 5);
const CONCURRENCY = Number(process.env.MANGO_CONCURRENCY ?? 16);
// If more than this share of seeded products fail their price fetch, the run
// is broken (Akamai block, API change) — throw rather than ship a shard.
const MAX_FAILURE_RATIO = 0.1;

/** One market's storefront: `shop.mango.com/{path}` and the orchestrator's `languageIso`. */
export interface MangoSite {
  country: CountryCode;
  /** e.g. "gb/en" — the prefix of every page and product url in this market. */
  path: string;
  /** `languageIso` for v4/products; it must match `path` or the detail has no url. */
  lang: string;
}

/**
 * Storefront path per market, probed 2026-09-23.
 *
 * English wherever Mango serves it. Eight markets have NO English site:
 * `/{cc}/en` answers 308 to the local language (de/de, at/de, ch/de, fr/fr,
 * be/fr, es/es, it/it, pt/pt), and those use exactly where that redirect lands.
 * The orchestrator will return an English NAME for them (`languageIso=en`), but
 * then v4 carries no `url` at all — a product link has to come from the same
 * language as the page it points to, so names there are in the local language.
 *
 * TR stays Turkish: it is production and the app's Turkish classifier reads it.
 */
const SITE_PATHS: Record<string, string> = {
  TR: "tr/tr",
  AE: "ae/en", SA: "sa/en", GB: "gb/en", US: "us/en", CA: "ca/en", AU: "au/en",
  IE: "ie/en", NL: "nl/en", FI: "fi/en", SE: "se/en", DK: "dk/en", NO: "no/en",
  DE: "de/de", AT: "at/de", CH: "ch/de", FR: "fr/fr", BE: "be/fr",
  ES: "es/es", IT: "it/it", PT: "pt/pt",
  QA: "qa/en", KW: "kw/en",
  // 2026-10-21: paths only, so the "every country" test holds with SG/HK in
  // lib/countries.ts. NOT swept yet (needs the browser fetcher; the Mac got 429).
  SG: "sg/en", HK: "hk/en",
};

export function siteFor(country: CountryCode): MangoSite {
  const path = SITE_PATHS[country];
  if (!path) throw new Error(`mango: no storefront path configured for ${country}`);
  return { country, path, lang: path.split("/")[1] };
}

/** Every market the collector can sweep has a storefront here (pinned by a test). */
export const MANGO_COUNTRIES = ALL_COUNTRIES.filter((c) => c in SITE_PATHS);

/** One colour-level entry of a category listing, in listing order. */
interface CatalogItem {
  productId: string;
  colorId: string;
  portraitId: string;
  index: number;
}

/**
 * One page of a category from Mango's catalog API — the JSON the PLP itself
 * pages through (100 entries a page). Category ids work here directly:
 * `/catalogs/7914393e` answers for women's sale in every market, and a bogus
 * id 404s ("Catalog id by link id not found").
 *
 * Until 2026-10-27 the filtered PLP HTML (/c/f/<category>) server-rendered the
 * WHOLE category as a compact `catalogItemsData` array in its RSC flight data,
 * with price and sellable sizes per colour. That morning Mango cut it to the
 * first page of 100 bare {productId, colorId} entries plus `pagination`, and
 * every market failed with "no catalogItemsData entries with productId". The
 * pages after the first only exist here, so the HTML (and its Vercel challenge,
 * which needed a headless browser) is no longer read for products at all.
 */
export function catalogUrl(hash: string, site: MangoSite, page: number): string {
  return (
    `${API}/cs/product-lists-drive-thru/v2/channels/shop/countries/${site.country.toLowerCase()}` +
    `/catalogs/${hash}?languageIso=${site.lang}&page=${page}`
  );
}

/**
 * Entries of one catalog page. They carry no name, price or sizes, so each
 * product needs v3/prices + v4/products as before, and now v3/stock as well
 * (the old payload listed each colour's sellable sizes).
 * A colour can appear twice, once per look (`37085851:TO` and `:TO:01`);
 * seedFrom keeps the first.
 */
export function parseCatalogPage(body: any, offset = 0): { items: CatalogItem[]; totalPages: number } {
  if (!body || !Array.isArray(body.items)) throw new Error("mango: catalog page has no items array");
  const items = body.items
    .filter((e: any) => e && typeof e.productId === "string" && /^\d{6,}$/.test(e.productId))
    .map((e: any, i: number) => ({
      productId: e.productId,
      colorId: String(e.colorId ?? ""),
      // A video portrait id names no still: buildRecord's constructed image needs a photo.
      portraitId: e.media?.portraitFormat && e.media.portraitFormat !== "IMAGE" ? "" : String(e.media?.portraitId ?? ""),
      index: offset + i,
    }));
  const totalPages = Number(body.totalPages);
  return { items, totalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1 };
}

/** Every entry of a category, all pages. Throws "no catalog items" for an empty one. */
async function fetchCatalog(hash: string, site: MangoSite): Promise<CatalogItem[]> {
  const page = (n: number) =>
    getJson<any>(catalogUrl(hash, site, n), { headers: HEADERS, retries: 1, country: site.country });
  const first = parseCatalogPage(await page(1));
  const rest = Array.from({ length: Math.min(first.totalPages, MAX_CATALOG_PAGES) - 1 }, (_, i) => i + 2);
  const pages: CatalogItem[][] = [first.items];
  // A failed page throws through pool: a missing page is a truncated catalogue.
  await pool(rest, PAGE_CONCURRENCY, async (n) => {
    pages[n - 1] = parseCatalogPage(await page(n), (n - 1) * 1000).items;
  });
  const items = pages.flat();
  if (items.length === 0) throw new Error(`mango: no catalog items for ${hash}`);
  return items;
}

/** One product seeded from the PLPs: its id plus the colours listed on sale. */
interface Seed {
  id: string;
  /** Colour entries in PLP order (first = the colour the grid card shows). */
  colors: CatalogItem[];
  /** Section of the sale PLP the product was seeded from (/kadin/, /erkek/, ...). */
  gender?: ProductRecord["gender"];
}

/**
 * Top-level section slug -> gender, in every storefront language we sweep.
 * Mango's sections are always women / men / teen / kids / home, localised.
 */
const SECTION_GENDER: Record<string, ProductRecord["gender"]> = {
  kadin: "kadin", women: "kadin", damen: "kadin", femme: "kadin",
  mujer: "kadin", donna: "kadin", mulher: "kadin",
  erkek: "erkek", men: "erkek", herren: "erkek", homme: "erkek",
  hombre: "erkek", uomo: "erkek", homem: "erkek",
  cocuk: "cocuk", kids: "cocuk", kinder: "cocuk", enfants: "cocuk",
  ninos: "cocuk", bambini: "cocuk", crianca: "cocuk", teen: "cocuk",
};

/** Section from a PLP path: /{cc}/{lang}/c/[f/]<section>/... — the crawl context. */
export function pathGender(path: string): ProductRecord["gender"] {
  const section = path.match(/\/c\/(?:f\/)?([^/]+)/)?.[1] ?? "";
  if (section in SECTION_GENDER) return SECTION_GENDER[section];
  // Older TR slugs carried suffixes (cocuk-giyim, ...).
  return section.includes("cocuk") ? "cocuk" : null;
}

/**
 * The words Mango has used for its sale sections, in every language we sweep.
 *
 * It renamed them from "indirim" to "promosyon": the homepage now links
 * /tr/tr/c/kadin/promosyon/7914393e and friends, so nothing matched and the
 * adapter threw on every run — mango went stale from 2026-09-16 until it was
 * noticed three days later. Both words are accepted now. Keeping the old one
 * costs nothing and means a rename back does not break the crawl a second time.
 * Elsewhere (2026-09-23): GB/IE "mid-season-sale--50", DE/DK/SA "promotion",
 * AE "special-prices-up-to-40-off".
 */
const SALE_WORDS = [
  "indirim", "promosyon", "promotion", "promocion", "sale", "rebajas",
  "soldes", "saldi", "saldos", "special-prices",
];

/**
 * Category ids are GLOBAL: women's sale is 7914393e under /tr/tr/c/kadin/promosyon,
 * /gb/en/c/women/mid-season-sale--50 and /de/de/c/damen/promotion alike, and the
 * filtered PLP resolves it under ANY slug in ANY market — /fr/fr/c/f/women/sale/7914393e
 * listed 603 products on a day the French site linked no sale at all (sampled
 * prices: 27/29 PROMOTION). Slugs only feed `pathGender`.
 */
interface KnownCategory {
  hash: string;
  tr: string;
  en: string;
}

/**
 * Sale sections, women first (primary audience), then men, teen girls, boys, girls.
 * Sizes on TR, 2026-10-10: 1,900 / 643 / 622 / 113 / 457 products.
 */
const SALE_CATEGORIES: KnownCategory[] = [
  { hash: "7914393e", tr: "kadin/promosyon", en: "women/sale" },
  { hash: "106c5d6d", tr: "erkek/promosyon", en: "men/sale" },
  { hash: "f841db18", tr: "teen/teena/promosyon", en: "teen/teena/sale" },
  { hash: "8e52a668", tr: "cocuk/erkek-cocuk/promosyon", en: "kids/boys/sale" },
  { hash: "69ea8b6f", tr: "cocuk/kiz-cocuk/promosyon", en: "kids/girls/sale" },
];
const SALE_HASHES = new Set([
  ...SALE_CATEGORIES.map((c) => c.hash),
  // teen boys, home, baby girls, baby boys, newborn
  "8f46eb8e", "644c3fdb", "21b82eda", "c60003dd", "d86d5ed0",
]);

/**
 * "See all" per section, for a market with no sale running: the full catalogue
 * is still worth tracking, a drop is a drop. Linked on US/CA/AU nav (2026-09-23),
 * and like the sale ids they resolve everywhere (FR women 2,812, SE 2,587).
 */
const SEE_ALL_CATEGORIES: KnownCategory[] = [
  { hash: "a5143b28", tr: "kadin/tumunu-gor", en: "women/see-all" },
  { hash: "c6638443", tr: "erkek/tumunu-gor", en: "men/see-all" },
  { hash: "1760c387", tr: "teen/teena/tumunu-gor", en: "teen/teena/see-all" },
  { hash: "7a5a133b", tr: "cocuk/erkek-cocuk/tumunu-gor", en: "kids/boys/see-all" },
];

function knownPaths(list: KnownCategory[], site: MangoSite): string[] {
  return list.map((c) => `/${site.path}/c/${site.lang === "tr" ? c.tr : c.en}/${c.hash}`);
}

/**
 * Women first, then men, then kids/teen; home and anything unknown last.
 * Within a section the known ids lead, so GB's seven linked sale sections pick
 * teen girls and boys rather than whatever sorts first (baby-boys).
 */
function saleRank(path: string): number {
  const g = pathGender(path);
  const section = g === "kadin" ? 0 : g === "erkek" ? 1 : g === "cocuk" ? 2 : 3;
  const known = SALE_CATEGORIES.findIndex((c) => path.endsWith(`/${c.hash}`));
  return section * 10 + (known < 0 ? 9 : known);
}

/**
 * Sale category paths, women first (primary audience), then men, then the rest.
 * A path is a sale section if it carries a known sale id or a sale word.
 * Pure and exported so the filter that broke above is covered by a test rather
 * than only by a live run.
 */
export function pickSalePaths(paths: Iterable<string>, max: number): string[] {
  return [...paths]
    .filter(
      (p) =>
        SALE_HASHES.has(p.split("/").pop() ?? "") ||
        SALE_WORDS.some((w) => p.split("/").slice(3).join("/").includes(w)),
    )
    .sort((a, b) => saleRank(a) - saleRank(b) || a.localeCompare(b))
    .slice(0, max);
}

/**
 * Sale sections by id, as served on 2026-09-19. The ids outlive the links:
 * on 2026-09-22 the homepage stopped linking /c/ categories at all and the
 * crawl threw on every run, while /c/f/kadin/promosyon/7914393e still listed
 * ~2k products. They are seeded on every run, linked or not (see seedPaths).
 */
export const KNOWN_SALE_PATHS = knownPaths(SALE_CATEGORIES, siteFor("TR"));

/** See-all sections for a market: the fallback when its sale pages list nothing. */
export const seeAllPaths = (site: MangoSite): string[] => knownPaths(SEE_ALL_CATEGORIES, site);

/** Last path segment: the category id for every /c/ path that carries one. */
const hashOf = (path: string): string => path.split("/").pop() ?? "";

/**
 * Sale paths to seed from: every sale section the pages link, PLUS the known
 * sale ids whether linked or not, deduplicated by id and ranked women first.
 *
 * The known ids used to be only the fallback for when NOTHING was linked. On
 * 2026-10-10 the TR nav linked just three small kids' sale sections (boys, baby
 * boys, newborn: ~300 products) while women's 7914393e still listed 1,900 and
 * men's 643 — so "something is linked" kept the fallback off and Mango TR
 * collected 283 products in the middle of a big sale. A link is evidence that a
 * section exists; its absence is not evidence that it does not.
 */
export function seedPaths(found: Iterable<string>, max: number, site: MangoSite = siteFor("TR")): string[] {
  const byHash = new Map<string, string>();
  // Pages link both /c/<x> and the filtered /c/f/<x>: one id, one seed path.
  const linked = pickSalePaths(
    [...found].map((p) => p.replace(`/${site.path}/c/f/`, `/${site.path}/c/`)),
    Infinity,
  );
  for (const p of [...linked, ...knownPaths(SALE_CATEGORIES, site)]) {
    if (!byHash.has(hashOf(p))) byHash.set(hashOf(p), p);
  }
  return pickSalePaths(byHash.values(), max);
}

/**
 * A known sale id the pages did not link may simply be retired in this market:
 * the catalog API then answers 404 (a bogus id does, probed 2026-10-29) or
 * lists nothing. That is skipped, not counted as a failed page. Anything else
 * (a 403, a timeout, a 5xx) still is.
 */
export function isRetiredCategory(err: unknown): boolean {
  return /HTTP 404 |no catalog items/.test(String(err));
}

/** Links matching /{path}/<kind>/..., e.g. kind "c" (categories) or "h" (sections). */
function linksOf(html: string, site: MangoSite, kind: "c" | "h"): string[] {
  const re = new RegExp(`/${site.path}/${kind}/[a-zA-Z0-9/_-]+`, "g");
  return html.match(re) ?? [];
}

type SeedMap = Map<string, Seed>;

/**
 * Load categories into `byId`. Returns how many failed (fetch or parse).
 * `optional` paths (known ids no page linked) may be retired: see isRetiredCategory.
 */
async function seedFrom(
  paths: string[],
  site: MangoSite,
  byId: SeedMap,
  max: number,
  strict: boolean,
  optional: ReadonlySet<string> = new Set(),
) {
  let failed = 0;
  for (const path of paths) {
    if (byId.size >= max) break;
    let items: CatalogItem[];
    try {
      // A failed page must THROW, not silently shrink the catalog to whatever
      // loaded — the collector treats a truncated-but-nonzero run as success.
      items = await fetchCatalog(hashOf(path), site);
    } catch (err) {
      if (optional.has(path) && isRetiredCategory(err)) continue;
      if (strict) throw err;
      failed++;
      continue;
    }
    // Group colour entries per product (one per colour: a second look of the
    // same colour adds nothing), deterministically ordered by numeric id within
    // the category so the subset kept under the cap is stable run-to-run.
    const perProduct = new Map<string, CatalogItem[]>();
    for (const item of items) {
      const list = perProduct.get(item.productId);
      if (!list) perProduct.set(item.productId, [item]);
      else if (!list.some((c) => c.colorId === item.colorId)) list.push(item);
    }
    const gender = pathGender(path);
    for (const id of [...perProduct.keys()].sort((a, b) => Number(a) - Number(b))) {
      if (!byId.has(id)) {
        const colors = perProduct.get(id)!.sort((a, b) => a.index - b.index);
        byId.set(id, { id, colors, gender });
      }
    }
  }
  return failed;
}

async function seedProducts(site: MangoSite, max: number): Promise<Seed[]> {
  // The homepage plus every section page it links (/h/women, /h/damen, ...):
  // the homepage alone stopped linking /c/ categories on 2026-09-22. Only this
  // discovery still reads HTML (through the browser, for the Vercel challenge);
  // if it fails, the known ids below still seed the crawl.
  const home = await browserText(`${SITE}/${site.path}`).catch(() => "");
  const catPaths = new Set<string>(linksOf(home, site, "c"));
  for (const page of new Set(linksOf(home, site, "h"))) {
    // One missing section page is not a broken crawl; the fallback ids cover it.
    const html = await browserText(`${SITE}${page}`).catch(() => "");
    for (const p of linksOf(html, site, "c")) catPaths.add(p);
  }
  const salePaths = seedPaths(catPaths, MAX_SEED_CATEGORIES, site);
  const linkedIds = new Set([...catPaths].map(hashOf));
  const unlinked = new Set(salePaths.filter((p) => !linkedIds.has(hashOf(p))));

  const byId: SeedMap = new Map();
  const failed = await seedFrom(salePaths, site, byId, max, false, unlinked);
  if (failed > 0 && byId.size > 0) {
    // Some sale pages loaded and some did not: that is a truncated catalogue.
    throw new Error(`mango ${site.country}: ${failed}/${salePaths.length} sale PLPs failed`);
  }
  if (byId.size === 0) {
    // No sale running (or its ids retired): track the full catalogue instead.
    // Strict — if these fail too, the run is broken, not merely sale-less.
    await seedFrom(seeAllPaths(site).slice(0, MAX_SEED_CATEGORIES), site, byId, max, true);
  }
  if (byId.size === 0) throw new Error(`mango ${site.country}: PLPs yielded zero product ids`);
  return [...byId.values()].slice(0, max);
}

/**
 * Pick the real product photo for a colour.
 *
 * NOT `bulletImg` — that is the colour swatch, and it used to win here. A swatch
 * is a flat patch of the garment's colour, so the feed rendered pale products as
 * blank squares: `27093335-11-020` for "Pastel Sarı" is a plain cream 200x200
 * with no garment in it at all. Swatches also cap at 200px, which upscales to
 * mush in a grid cell ~570px wide on a 3x phone.
 *
 * `looks` is keyed by look id, and each look's `images` is keyed by view code:
 *   O1 = "Genel plan" (model, full length) — what Mango's own grid shows
 *   B  = "Modelsiz ürün" (garment alone)
 *   F  = "Orta plan", D0/D1 = detail crops — too tight to identify a product
 * Prefer the model shot, fall back to the garment-only shot, then any view.
 */
export function lookImage(color: any): string | null {
  const looks = color?.looks;
  if (!looks || typeof looks !== "object") return null;
  for (const look of Object.values<any>(looks)) {
    const images = look?.images;
    if (!images || typeof images !== "object") continue;
    const pick = images.O1?.img ?? images.B?.img ?? Object.values<any>(images)[0]?.img;
    if (typeof pick === "string" && pick) return pick;
  }
  return null;
}

/** Where a view code sits in the gallery: model, garment, mid-shot, then the rest, detail crops last. */
function viewRank(code: string): number {
  if (code === "O1") return 0;
  if (code === "B") return 1;
  if (code === "F") return 2;
  if (/^D\d+$/.test(code)) return 9;
  // Letter codes (R = back, ...) before the bare numeric asset codes, which are
  // mostly aliases of a letter view and only stand alone for an unnamed shot.
  return /^\d+$/.test(code) ? 4 : 3;
}

/**
 * Every photo of ONE colour, in gallery order, as raw asset paths.
 *
 * A colour can carry several looks ("00", "01": the same colour styled again on
 * another model). Each look's `images` lists every view twice — once under its
 * letter code (O1, B, F, R, D0...) and once under its numeric asset code (001,
 * 900, 002...) — so a path's rank comes from the best code that names it.
 * Looks run in order (first look's O1/B/F/rest, then the next look's), and the
 * detail crops of every look go last: they are too tight to lead a gallery.
 *
 * The swatch (`bulletImg`) is never included — it is a flat patch of colour,
 * capped at 200px (see lookImage). Nor is anything that is not a still image.
 */
export function lookGallery(color: any): string[] {
  const looks = color?.looks;
  if (!looks || typeof looks !== "object") return [];
  const swatch = typeof color?.bulletImg === "string" ? color.bulletImg : null;
  const main: string[] = [];
  const crops: string[] = [];
  for (const look of Object.values<any>(looks)) {
    const images = look?.images;
    if (!images || typeof images !== "object") continue;
    // A letter code is authoritative: "030" alone looks like an unnamed shot,
    // but it is D0's asset, so it ranks as a detail crop.
    const rank = new Map<string, { r: number; named: boolean }>();
    for (const [code, v] of Object.entries<any>(images)) {
      const img = v?.img;
      if (typeof img !== "string" || !img || img === swatch) continue;
      if (/video|\.(mp4|mov|webm|m3u8)(\?|$)/i.test(img)) continue;
      const named = !/^\d+$/.test(code);
      const r = viewRank(code);
      const prev = rank.get(img);
      if (!prev || (named && !prev.named) || (named === prev.named && r < prev.r)) {
        rank.set(img, { r, named });
      }
    }
    const ordered = [...rank.entries()].sort((a, b) => a[1].r - b[1].r);
    for (const [img, { r }] of ordered) (r === 9 ? crops : main).push(img);
  }
  return [...new Set([...main, ...crops])];
}

/**
 * Scene7 serves a 200x200 thumbnail for a bare asset path, so every URL needs an
 * explicit rendition. 480x672 is the grid cell's 5:7 aspect. `wid` alone is not
 * enough — it stretches width while leaving height at 200.
 */
export function withRendition(path: string | null, assets: string): string | null {
  if (!path) return null;
  const url = path.startsWith("http") ? path : `${assets}${path}`;
  return url.includes("?") ? url : `${url}?wid=480&hei=672&fit=crop`;
}

/**
 * Mango's product links now end in the colour and size codes —
 * `…/volanli-cizgili-elbise/27017946/52/00` — and a link without them is
 * answered "This request was blocked" (403) by Mango's firewall, in Safari too
 * (2026-10-13, owner: "it tells me request is blocked"). The v4 detail `url`
 * stops at the id, so the colour this record is for is added, with size 00.
 * Older-style links (`…_37091331`) and ones already suffixed are left alone.
 * Colour codes are not all numeric: TM, TO, TG... (denim washes) need the same
 * suffix — `…/17001205` 403s, `…/17001205/TM/00` opens (2026-10-29; ~9% of TR
 * links were bare).
 */
export function productUrl(url: string, colorId: unknown): string {
  const c = colorId == null ? "" : String(colorId).trim().toUpperCase();
  if (!/^[A-Z0-9]{1,3}$/.test(c)) return url;
  const code = /^\d+$/.test(c) ? c.padStart(2, "0") : c;
  return /\/\d{6,10}$/.test(url) ? `${url}/${code}/00` : url;
}

/**
 * v3/stock/products: `{colors: {<colorId>: {sizes: {<sizeId>: {available}}}}}`.
 * Size ids, not labels ("19" = XS); v4's `colors[].sizes[{id, label}]` names
 * them. A sold-out size is `available: false` or missing, a sold-out colour
 * missing altogether (probed 2026-10-29).
 */
export interface MangoStock {
  colors?: Record<string, { sizes?: Record<string, { available?: boolean }> }>;
}

/**
 * Build one ProductRecord from a seed + its three orchestrator responses.
 * `prices` is keyed by colorId; `detail` may be null (name/url/size labels degrade).
 */
export function buildRecord(
  seed: Seed,
  prices: Record<string, any>,
  stock: MangoStock,
  detail: any,
  country: CountryCode = "TR",
): ProductRecord | null {
  const site = siteFor(country);
  const lead = seed.colors[0];
  // Prefer the colour the listing shows; fall back to any priced colour.
  const priceEntry =
    prices[lead.colorId] ??
    Object.values(prices).find((v: any) => v && typeof v.price === "number");
  if (!priceEntry || typeof priceEntry.price !== "number" || priceEntry.price <= 0) return null;

  const orig = priceEntry.previousPrices?.originalShop;
  const colors: any[] = detail?.colors ?? [];
  const ownColor = colors.find((c: any) => String(c?.id) === lead.colorId) ?? colors[0];

  // Per-size labels come from the detail response, availability from v3/stock
  // by size id — for the same colour, or the sizes describe another garment.
  const sizeStock = stock.colors?.[String(ownColor?.id ?? lead.colorId)]?.sizes ?? {};
  const sizeList: SizeVariant[] = (ownColor?.sizes ?? [])
    .map((s: any) => ({
      label: String(s?.label ?? "").trim(),
      availability: (sizeStock[String(s?.id)]?.available === true
        ? "in_stock"
        : "out_of_stock") as Availability,
    }))
    .filter((s: SizeVariant) => s.label);
  const colorNames: string[] = [
    ...new Set(colors.map((c: any) => c?.label).filter(Boolean) as string[]),
  ];

  const assets = detail?.assetsDomain ?? "https://media.mango.com";
  // The grid image is deterministic: /is/image/punto/<id>-<color>-<portrait>
  const constructed =
    lead.portraitId && lead.colorId
      ? `https://media.mango.com/is/image/punto/${seed.id}-${lead.colorId}-${lead.portraitId}`
      : null;
  const imageUrl = withRendition(lookImage(ownColor) ?? constructed, assets);
  const images = cleanGallery(
    lookGallery(ownColor).map((p) => withRendition(p, assets)),
    imageUrl,
  );

  const family =
    detail?.families?.find((f: any) => f.isMainFamily)?.label ??
    detail?.families?.[0]?.label ??
    null;

  return {
    brand: "mango",
    country,
    externalId: seed.id,
    name: detail?.name ?? `Mango ${seed.id}`,
    url: detail?.url ? productUrl(`${SITE}${detail.url}`, lead.colorId ?? ownColor?.id) : `${SITE}/${site.path}`,
    imageUrl,
    images,
    price: toMinor(priceEntry.price),
    listPrice: typeof orig === "number" && orig > priceEntry.price ? toMinor(orig) : null,
    currency: currencyFor(country),
    // At least one sellable size; without detail (no labels) straight from stock.
    inStock:
      sizeList.length > 0
        ? sizeList.some((s) => s.availability !== "out_of_stock")
        : Object.values(sizeStock).some((v) => v?.available === true),
    category: family,
    gender: seed.gender ?? null,
    colorName: ownColor?.label ?? (lead.colorId || null),
    variants: sizeList.length > 0 || colorNames.length > 0 ? { colors: colorNames, sizes: sizeList } : null,
  };
}

/**
 * Fetch prices + stock (both required) and detail (best-effort) for one seeded
 * product. Stock is required because a record without it would be stored with
 * a made-up availability, and restock alerts read it; a broken stock API
 * therefore trips the failure ratio in listProducts instead.
 */
async function fetchOne(seed: Seed, site: MangoSite): Promise<ProductRecord | null> {
  const cc = site.country;
  const [prices, stock, detail] = await Promise.all([
    getJson<Record<string, any>>(
      `${ORCH}/v3/prices/products?channelId=shop&countryIso=${cc}&productId=${seed.id}`,
      { headers: HEADERS, retries: 1, country: cc },
    ).catch(() => null),
    getJson<MangoStock>(
      `${ORCH}/v3/stock/products?countryIso=${cc}&channelId=shop&productId=${seed.id}`,
      { headers: HEADERS, retries: 1, country: cc },
    ).catch(() => null),
    // NB: v4's language param is `languageIso` (v3 detail's was `language`).
    getJson<any>(
      `${ORCH}/v4/products?channelId=shop&countryIso=${cc}&languageIso=${site.lang}&productId=${seed.id}`,
      { headers: HEADERS, retries: 1, country: cc },
    ).catch(() => null),
  ]);
  if (!prices || !stock) return null; // discontinued id, or the orchestrator refused us
  return buildRecord(seed, prices, stock, detail, cc);
}

/** Run `fn` over `items` with bounded concurrency. */
async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

export const brand = "mango";

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  const site = siteFor(country);
  const seeds = await seedProducts(site, MAX_PRODUCTS);
  const byId = new Map<string, ProductRecord>();
  let failures = 0;
  await pool(seeds, CONCURRENCY, async (seed) => {
    const rec = await fetchOne(seed, site);
    if (rec) byId.set(rec.externalId, rec);
    else failures++;
  });
  // A few nulls are normal (ids linger in the listing after delisting), but a
  // large share means the orchestrator is rejecting us — fail the run loudly
  // instead of shipping a silently truncated catalog.
  if (failures > seeds.length * MAX_FAILURE_RATIO) {
    throw new Error(
      `mango ${country}: ${failures}/${seeds.length} products failed price/stock fetch — aborting run`,
    );
  }
  if (byId.size === 0) throw new Error(`mango ${country}: zero products built from catalog seeds`);
  return [...byId.values()];
}
