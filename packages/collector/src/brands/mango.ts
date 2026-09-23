import type { ProductRecord, SizeVariant, Availability } from "../types";
import { getJson, getText } from "../http";
import { toMinor } from "../normalize";
import { ALL_COUNTRIES, currencyFor, type CountryCode } from "../../../../lib/countries";

const SITE = "https://shop.mango.com";
const ORCH = "https://online-orchestrator.mango.com";
// The orchestrator (Akamai) rejects bare requests; browser-ish Origin/Referer are required.
const HEADERS = {
  Accept: "application/json",
  Origin: SITE,
  Referer: `${SITE}/`,
};

// Full-sale-catalog mode: ~6k products x 2 light orchestrator calls each. The
// calls are CDN-fast (~50ms measured at concurrency 12), so 16 products
// in-flight (32 requests) clears ~6k products well inside the collector's
// 4-minute brand budget. MAX_PRODUCTS is a safety cap, not a working limit.
const MAX_PRODUCTS = Number(process.env.MANGO_MAX_PRODUCTS ?? 8000);
const MAX_SEED_CATEGORIES = Number(process.env.MANGO_MAX_SEED_CATEGORIES ?? 4);
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
};

export function siteFor(country: CountryCode): MangoSite {
  const path = SITE_PATHS[country];
  if (!path) throw new Error(`mango: no storefront path configured for ${country}`);
  return { country, path, lang: path.split("/")[1] };
}

/** Every market the collector can sweep has a storefront here (pinned by a test). */
export const MANGO_COUNTRIES = ALL_COUNTRIES.filter((c) => c in SITE_PATHS);

/** One colour-level entry of a PLP's catalogItemsData flight payload. */
interface CatalogItem {
  productId: string;
  colorId: string;
  sizes: string[];
  price: number;
  portraitId: string;
  index: number;
}

/**
 * Mango has no batch catalog JSON API (v3/prices and v4/products both take
 * exactly one productId — probed: repeated params are ignored, comma lists
 * 400), BUT the *filtered* PLP at /tr/tr/c/f/<category> server-renders the
 * ENTIRE category item list in its RSC flight data: `catalogItemsData` holds
 * one entry per (productId, colorId) with the CURRENT price, size list and
 * image portraitId — ~5k entries for the women's sale category in one HTML
 * response. What it lacks is the product name, URL slug and crossed-out
 * price, so each product still needs one v3/prices + one v4/products call
 * (2 instead of the previous 3 — per-size stock now comes from the PLP).
 */
export function parseCatalogItems(html: string): CatalogItem[] {
  // The flight data contains TWO catalogItemsData arrays: one with ~20 fully
  // rendered first-page items (keyed by `reference`, no productId) and one
  // with the ENTIRE category as compact {productId, colorId, price, sizes,
  // portraitId} entries. We want the compact one — scan every occurrence and
  // keep the largest array whose entries carry a productId.
  const marker = '\\"catalogItemsData\\":[';
  let best: any[] = [];
  let from = 0;
  for (;;) {
    const start = html.indexOf(marker, from);
    if (start < 0) break;
    from = start + marker.length;
    // Bracket-scan the escaped JSON array (entries are flat objects whose
    // only nested arrays are `sizes` and `families`).
    let depth = 0;
    let end = -1;
    for (let i = start + marker.length - 1; i < html.length; i++) {
      const ch = html[i];
      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end < 0) throw new Error("mango: unterminated catalogItemsData array");
    const raw = html.slice(start + marker.length - 1, end).replace(/\\"/g, '"');
    let parsed: any[];
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`mango: catalogItemsData did not parse as JSON: ${err}`);
    }
    const withIds = parsed.filter(
      (e) => e && typeof e.productId === "string" && /^\d{6,}$/.test(e.productId),
    );
    if (withIds.length > best.length) best = withIds;
  }
  if (best.length === 0) {
    throw new Error("mango: no catalogItemsData entries with productId in PLP flight data");
  }
  return best.map((e) => ({
      productId: e.productId,
      colorId: String(e.colorId ?? ""),
      sizes: Array.isArray(e.sizes) ? e.sizes.map(String) : [],
      price: typeof e.price === "number" ? e.price : 0,
      portraitId: String(e.portraitId ?? ""),
      index: typeof e.index === "number" ? e.index : 0,
    }));
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

/** Sale sections, women first (primary audience), then men, teen girls, boys. */
const SALE_CATEGORIES: KnownCategory[] = [
  { hash: "7914393e", tr: "kadin/promosyon", en: "women/sale" },
  { hash: "106c5d6d", tr: "erkek/promosyon", en: "men/sale" },
  { hash: "f841db18", tr: "teen/teena/promosyon", en: "teen/teena/sale" },
  { hash: "8e52a668", tr: "cocuk/erkek-cocuk/promosyon", en: "kids/boys/sale" },
];
const SALE_HASHES = new Set([
  ...SALE_CATEGORIES.map((c) => c.hash),
  // kids/girls, teen boys, home, baby girls, baby boys, newborn
  "69ea8b6f", "8f46eb8e", "644c3fdb", "21b82eda", "c60003dd", "d86d5ed0",
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
 * ~2k products. These are the floor when no page links a sale section.
 */
export const KNOWN_SALE_PATHS = knownPaths(SALE_CATEGORIES, siteFor("TR"));

/** See-all sections for a market: the fallback when its sale pages list nothing. */
export const seeAllPaths = (site: MangoSite): string[] => knownPaths(SEE_ALL_CATEGORIES, site);

/** Sale paths found on the pages, or the known sale ids when none are linked. */
export function seedPaths(found: Iterable<string>, max: number, site: MangoSite = siteFor("TR")): string[] {
  const sale = pickSalePaths(found, max);
  return sale.length > 0 ? sale : knownPaths(SALE_CATEGORIES, site).slice(0, max);
}

/** /{path}/c/<x> -> /{path}/c/f/<x>: the filtered PLP, which embeds every item. */
export function filteredUrl(path: string, site: MangoSite): string {
  return `${SITE}${path.replace(`/${site.path}/c/`, `/${site.path}/c/f/`)}`;
}

/** Links matching /{path}/<kind>/..., e.g. kind "c" (categories) or "h" (sections). */
function linksOf(html: string, site: MangoSite, kind: "c" | "h"): string[] {
  const re = new RegExp(`/${site.path}/${kind}/[a-zA-Z0-9/_-]+`, "g");
  return html.match(re) ?? [];
}

type SeedMap = Map<string, Seed>;

/** Load PLPs into `byId`. Returns how many pages failed (fetch or parse). */
async function seedFrom(paths: string[], site: MangoSite, byId: SeedMap, max: number, strict: boolean) {
  let failed = 0;
  for (const path of paths) {
    if (byId.size >= max) break;
    let items: CatalogItem[];
    try {
      // A failed page must THROW, not silently shrink the catalog to whatever
      // loaded — the collector treats a truncated-but-nonzero run as success.
      const html = await getText(filteredUrl(path, site), {
        headers: { Accept: "text/html" },
        country: site.country,
      });
      items = parseCatalogItems(html);
    } catch (err) {
      if (strict) throw err;
      failed++;
      continue;
    }
    // Group colour entries per product, deterministically ordered by numeric
    // id within the category so the subset kept under the cap is stable
    // run-to-run.
    const perProduct = new Map<string, CatalogItem[]>();
    for (const item of items) {
      const list = perProduct.get(item.productId);
      if (list) list.push(item);
      else perProduct.set(item.productId, [item]);
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
  // the homepage alone stopped linking /c/ categories on 2026-09-22.
  const home = await getText(`${SITE}/${site.path}`, {
    headers: { Accept: "text/html" },
    country: site.country,
  }).catch(() => "");
  const catPaths = new Set<string>(linksOf(home, site, "c"));
  for (const page of new Set(linksOf(home, site, "h"))) {
    // One missing section page is not a broken crawl; the fallback ids cover it.
    const html = await getText(`${SITE}${page}`, {
      headers: { Accept: "text/html" },
      country: site.country,
    }).catch(() => "");
    for (const p of linksOf(html, site, "c")) catPaths.add(p);
  }
  const salePaths = seedPaths(catPaths, MAX_SEED_CATEGORIES, site);

  const byId: SeedMap = new Map();
  const failed = await seedFrom(salePaths, site, byId, max, false);
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
 * Build one ProductRecord from a seed + its two orchestrator responses.
 * `prices` is keyed by colorId; `detail` may be null (name/url degrade).
 */
export function buildRecord(
  seed: Seed,
  prices: Record<string, any>,
  detail: any,
  country: CountryCode = "TR",
): ProductRecord | null {
  const site = siteFor(country);
  const lead = seed.colors[0];
  // Prefer the colour the PLP grid shows; fall back to any priced colour.
  const priceEntry =
    prices[lead.colorId] ??
    Object.values(prices).find((v: any) => v && typeof v.price === "number");
  if (!priceEntry || typeof priceEntry.price !== "number" || priceEntry.price <= 0) return null;

  const orig = priceEntry.previousPrices?.originalShop;
  const colors: any[] = detail?.colors ?? [];
  const ownColor = colors.find((c: any) => String(c?.id) === lead.colorId) ?? colors[0];

  // Per-size labels come from the detail response; the PLP's size list for
  // this colour is the set actually sellable right now.
  const plpSizes = new Set(lead.sizes);
  const sizes: SizeVariant[] = (ownColor?.sizes ?? [])
    .map((s: any) => ({
      label: String(s?.label ?? "").trim(),
      availability: (plpSizes.has(String(s?.label ?? "").trim())
        ? "in_stock"
        : "out_of_stock") as Availability,
    }))
    .filter((s: SizeVariant) => s.label);
  const fallbackSizes: SizeVariant[] = lead.sizes.map((label) => ({
    label,
    availability: "in_stock" as Availability,
  }));
  const sizeList = sizes.length > 0 ? sizes : fallbackSizes;
  const colorNames: string[] = [
    ...new Set(colors.map((c: any) => c?.label).filter(Boolean) as string[]),
  ];

  const assets = detail?.assetsDomain ?? "https://media.mango.com";
  // The PLP grid image is deterministic: /is/image/punto/<id>-<color>-<portrait>
  const constructed =
    lead.portraitId && lead.colorId
      ? `https://media.mango.com/is/image/punto/${seed.id}-${lead.colorId}-${lead.portraitId}`
      : null;
  const imageUrl = withRendition(lookImage(ownColor) ?? constructed, assets);

  const family =
    detail?.families?.find((f: any) => f.isMainFamily)?.label ??
    detail?.families?.[0]?.label ??
    null;

  return {
    brand: "mango",
    country,
    externalId: seed.id,
    name: detail?.name ?? `Mango ${seed.id}`,
    url: detail?.url ? `${SITE}${detail.url}` : `${SITE}/${site.path}`,
    imageUrl,
    price: toMinor(priceEntry.price),
    listPrice: typeof orig === "number" && orig > priceEntry.price ? toMinor(orig) : null,
    currency: currencyFor(country),
    // Listed on the filtered sale PLP with at least one sellable size.
    inStock: sizeList.some((s) => s.availability !== "out_of_stock"),
    category: family,
    gender: seed.gender ?? null,
    colorName: ownColor?.label ?? (lead.colorId || null),
    variants: sizeList.length > 0 || colorNames.length > 0 ? { colors: colorNames, sizes: sizeList } : null,
  };
}

/** Fetch prices (required) + detail (best-effort) for one seeded product. */
async function fetchOne(seed: Seed, site: MangoSite): Promise<ProductRecord | null> {
  const cc = site.country;
  const [prices, detail] = await Promise.all([
    getJson<Record<string, any>>(
      `${ORCH}/v3/prices/products?channelId=shop&countryIso=${cc}&productId=${seed.id}`,
      { headers: HEADERS, retries: 1, country: cc },
    ).catch(() => null),
    // NB: v4's language param is `languageIso` (v3 detail's was `language`).
    getJson<any>(
      `${ORCH}/v4/products?channelId=shop&countryIso=${cc}&languageIso=${site.lang}&productId=${seed.id}`,
      { headers: HEADERS, retries: 1, country: cc },
    ).catch(() => null),
  ]);
  if (!prices) return null; // discontinued / bogus id scraped from HTML
  return buildRecord(seed, prices, detail, cc);
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
  // A few nulls are normal (ids linger in flight data after delisting), but a
  // large share means the orchestrator is rejecting us — fail the run loudly
  // instead of shipping a silently truncated catalog.
  if (failures > seeds.length * MAX_FAILURE_RATIO) {
    throw new Error(
      `mango ${country}: ${failures}/${seeds.length} products failed price fetch — aborting run`,
    );
  }
  if (byId.size === 0) throw new Error(`mango ${country}: zero products built from PLP seeds`);
  return [...byId.values()];
}
