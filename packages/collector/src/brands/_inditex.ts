import { cleanGallery, type ProductRecord, type ProductVariants, type SizeVariant, type Availability } from "../types";
import { getJson } from "../http";
import { currencyFor, type CountryCode } from "../../../../lib/countries";

/**
 * Shared adapter for the Inditex `itxrest` gateway, used by Massimo Dutti,
 * Zara Home, Pull&Bear, Bershka and Stradivarius (only ids/domain differ).
 *
 * Flow: category tree -> leaf category ids -> product ids -> productsArray.
 * The category/product-id endpoints sit behind Akamai and may 403 from
 * datacenter IPs; when that happens we fall back to the server-rendered
 * category page, which embeds the same `"productIds":[...]` arrays (after
 * solving Akamai's simple arithmetic "interstitial" challenge once).
 */

export interface InditexSite {
  brand: string;
  /** e.g. "www.massimodutti.com" */
  domain: string;
  /** itxrest brandId — the store list 404s without it. */
  brandId: number;
  /**
   * Turkey's store/catalog, used ONLY if the store list itself cannot be read.
   * The Turkish sweep is live and never depended on that endpoint before, so an
   * outage there must degrade to exactly what ran before, not to nothing.
   */
  trFallback: { storeId: number; catalogId: number };
}

/* ------------------------------------------------------------------ */
/* Market resolution: which store/catalog/language/url a country uses. */
/* ------------------------------------------------------------------ */

/** Everything a crawl needs to know about one brand in one country. */
export interface InditexMarket {
  country: CountryCode;
  storeId: number;
  catalogId: number;
  languageId: number;
  /** PDP/category url prefix, no trailing slash: `https://www.x.com/tr`, `…/de/en`. */
  urlPrefix: string;
  /** ISO 4217, read from the store detail and checked against lib/countries. */
  currency: string;
  /** Accept-Language for the HTML fallback. */
  acceptLanguage: string;
}

interface StoreLanguage {
  id: number;
  code: string;
  languageTag?: string;
}
export interface StoreListEntry {
  id: number;
  countryCode: string;
  type?: number;
  isOpenForSale?: boolean;
  catalogs?: { id: number; identifier?: string; type: number }[];
  storeDefaultLanguageId: number;
  supportedLanguages?: StoreLanguage[];
  iDesktopUrlRemoveDefaultLanguage?: boolean;
}

/**
 * Pick the store, catalog, language and url prefix for a country from the
 * brand's store list (`/itxrest/2/catalog/store?brandId=N`). Pure.
 *
 * - Catalog: the store's type-1 catalog. Catalog ids carry season names
 *   (`OYSHO_WINTER_TURQUIA`, `STR_UK_INVIERNO`) and rotate — Oysho TR moved
 *   from 60361124 to 60361115 while the code still pinned the old one — so they
 *   are read, never pasted.
 * - Language: Turkey keeps the store default (Turkish, -43), which is what the
 *   live sweep has always collected. Everywhere else English, whose id is not
 *   always -1 (Pull&Bear and Bershka US use -15), so it is looked up by code.
 * - Url: `/{cc}/slug` in the store default language, `/{cc}/{lang}/slug`
 *   otherwise — the `iDesktopUrlRemoveDefaultLanguage` rule. Verified live:
 *   MD `/gb/…`, `/us/…`, `/de/en/…` answer 200 with that canonical, as do P&B
 *   `/gb/`, `/us/`, `/de/en/`; Stradivarius, Oysho and Bershka PDPs are
 *   Akamai-blocked from Node, but their own sitemaps list `/gb/…`, `/de/en/…`,
 *   `/us/…` and (Bershka) `/no/en/…` in exactly this form.
 */
export function marketFromStoreList(
  stores: StoreListEntry[],
  country: CountryCode,
  domain: string,
): Omit<InditexMarket, "currency"> {
  const candidates = stores.filter((s) => s.countryCode === country);
  const store =
    candidates.find((s) => s.isOpenForSale !== false && (s.type ?? 1) === 1) ?? candidates[0];
  if (!store) throw new Error(`${domain}: no store for ${country} in the store list`);
  if (store.isOpenForSale === false) throw new Error(`${domain}: ${country} store ${store.id} is not open for sale`);
  const catalog = store.catalogs?.find((c) => c.type === 1);
  if (!catalog) throw new Error(`${domain}: ${country} store ${store.id} has no type-1 catalog`);

  const langs = store.supportedLanguages ?? [];
  const byId = (id: number) => langs.find((l) => l.id === id);
  const lang =
    country === "TR"
      ? byId(store.storeDefaultLanguageId)
      : langs.find((l) => l.code === "en") ?? byId(store.storeDefaultLanguageId);
  if (!lang) throw new Error(`${domain}: ${country} store ${store.id} has no usable language`);

  const cc = country.toLowerCase();
  const isDefault = lang.id === store.storeDefaultLanguageId;
  const dropLang = isDefault && store.iDesktopUrlRemoveDefaultLanguage !== false;
  const urlPrefix = `https://${domain}/${cc}${dropLang ? "" : `/${lang.code}`}`;
  return {
    country,
    storeId: store.id,
    catalogId: catalog.id,
    languageId: lang.id,
    urlPrefix,
    acceptLanguage: `${lang.code}-${country},${lang.code};q=0.9`,
  };
}

/**
 * The store detail's currency, asserted against lib/countries. Pure.
 *
 * Prices are integer minor units (`"3599"` = €35.99) only when
 * `currencyDecimals` is -2, and they are in the STORE's currency, which is not
 * guaranteed to be the country's: Oysho's Norway entry resolves to a worldwide
 * store (countryCode "WW") that prices in EUR. Recording those as NOK would be
 * a silent 10x error on every row, so any mismatch throws.
 */
export function currencyFromStoreDetail(detail: any, country: CountryCode, domain: string): string {
  const want = currencyFor(country);
  if (detail?.countryCode && detail.countryCode !== country) {
    throw new Error(
      `${domain}: ${country} resolves to store ${detail.id} of country ${detail.countryCode}, not ${country}`,
    );
  }
  const locale = detail?.details?.locale;
  const got = locale?.currencyCode;
  if (got !== want) {
    throw new Error(`${domain}: ${country} store prices in ${got ?? "unknown currency"}, expected ${want}`);
  }
  if (locale?.currencyDecimals !== -2) {
    throw new Error(
      `${domain}: ${country} currencyDecimals ${locale?.currencyDecimals}, expected -2 (prices in hundredths)`,
    );
  }
  return got;
}

/**
 * Resolve a brand's market at run time: one store-list read (~13 KB) and one
 * store-detail read per brand per country per run.
 *
 * Turkey only: if the store list cannot be read, fall back to the pinned ids
 * and TRY, which is exactly how the Turkish sweep ran before this existed. Other
 * countries throw — the collector's blocked-brand guard reports it.
 */
export async function resolveMarket(
  site: Pick<InditexSite, "domain" | "brandId" | "trFallback">,
  country: CountryCode,
  headers?: Record<string, string>,
): Promise<InditexMarket> {
  const base = `https://${site.domain}/itxrest/2/catalog/store`;
  let partial: Omit<InditexMarket, "currency">;
  try {
    const list = await getJson<{ stores: StoreListEntry[] }>(
      `${base}?languageId=-1&appId=1&brandId=${site.brandId}`,
      { country, headers, retries: 2 },
    );
    partial = marketFromStoreList(list.stores ?? [], country, site.domain);
  } catch (err) {
    if (country !== "TR") throw err;
    return {
      country,
      storeId: site.trFallback.storeId,
      catalogId: site.trFallback.catalogId,
      languageId: -43,
      urlPrefix: `https://${site.domain}/tr`,
      currency: "TRY",
      acceptLanguage: "tr-TR,tr;q=0.9",
    };
  }
  let detail: any;
  try {
    detail = await getJson<any>(`${base}/${partial.storeId}?languageId=-1&appId=1`, {
      country,
      headers,
      retries: 2,
    });
  } catch (err) {
    // Same reasoning as above: TR's currency is not in doubt, a lost detail
    // read must not stop the live sweep.
    if (country === "TR") return { ...partial, currency: "TRY" };
    throw err;
  }
  return { ...partial, currency: currencyFromStoreDetail(detail, country, site.domain) };
}

interface InditexCategory {
  id: number;
  name?: string;
  nameEn?: string;
  key?: string;
  categoryUrl?: string;
  subcategories?: InditexCategory[];
  /** Not in the JSON — stamped onto leaves during the tree walk. */
  gender?: ProductRecord["gender"];
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const PRODUCTS_ARRAY_CHUNK = 80;

function api(site: InditexSite, m: InditexMarket, version: number): string {
  return `https://${site.domain}/itxrest/${version}/catalog/store/${m.storeId}/${m.catalogId}`;
}

/**
 * Which section a category (or its ancestors) belongs to. The itxrest tree
 * roots are the storefront sections — "Kadın"/"Woman"/…MUJER…, "Erkek"/"Man"/
 * …HOMBRE… — and that is the only place gender exists (the stored category
 * text holds product types, not sections). Matched over name + nameEn + key so
 * it works across locales; sections with no signal (Landing, home, beauty)
 * stay null — never guessed from product names.
 */
export function genderFromText(text: string): ProductRecord["gender"] {
  // keys use _ and - as separators ("REBAJAS_PULL_MUJER_ROPA") — treat them
  // as word boundaries so \b matches. foldTr doesn't touch ç ("Çocuk"), so
  // fold it here too.
  const t = foldTr(text).replace(/ç/g, "c").replace(/[_\-/|]/g, " ");
  // kids first: "erkek çocuk" (boy) must not read as erkek. \b keeps
  // "boyfriend jean" rails from matching "boy".
  if (/cocuk|bebek|\b(kids?|baby|girls?|boys?|ninos?|ninas?)\b/.test(t)) return "cocuk";
  if (/kadin|\b(wom[ae]n|mujer)\b/.test(t)) return "kadin";
  if (/erkek|\b(m[ae]n|hombre)\b/.test(t)) return "erkek";
  return null;
}

/** Collect leaf categories (nodes with no subcategories), stamping each with
 *  the gender of the nearest section-bearing ancestor (usually the root). */
function leafCategories(
  cats: InditexCategory[],
  inherited: ProductRecord["gender"] = null,
  out: InditexCategory[] = [],
): InditexCategory[] {
  for (const c of cats) {
    const gender =
      genderFromText(`${c.name ?? ""} ${c.nameEn ?? ""} ${c.key ?? ""}`) ?? inherited;
    const subs = c.subcategories ?? [];
    if (subs.length === 0) out.push({ ...c, gender });
    else leafCategories(subs, gender, out);
  }
  return out;
}

async function categoryTree(site: InditexSite, m: InditexMarket): Promise<InditexCategory[]> {
  const base = `${api(site, m, 2)}/category`;
  try {
    const tree = await getJson<{ categories: InditexCategory[] }>(
      `${base}?languageId=${m.languageId}&appId=1`,
      { retries: 1, country: m.country },
    );
    return tree.categories ?? [];
  } catch {
    // Akamai often blocks the appId=1 variant from datacenter IPs while
    // letting the bare one through — retry without it.
    const tree = await getJson<{ categories: InditexCategory[] }>(
      `${base}?languageId=${m.languageId}`,
      { retries: 3, country: m.country },
    );
    return tree.categories ?? [];
  }
}

function extractIds(data: any): number[] {
  if (Array.isArray(data?.productIds)) return data.productIds.filter((n: any) => Number(n) > 0);
  if (Array.isArray(data?.products)) {
    return data.products.map((p: any) => Number(p?.id)).filter((n: number) => n > 0);
  }
  if (Array.isArray(data)) return data.map(Number).filter((n) => n > 0);
  return [];
}

async function categoryProductIds(
  site: InditexSite,
  m: InditexMarket,
  cat: InditexCategory,
): Promise<number[]> {
  // Primary: the JSON listing endpoint.
  try {
    const data = await getJson<any>(
      `${api(site, m, 3)}/category/${cat.id}/product?languageId=${m.languageId}&appId=1&showProducts=false`,
      { retries: 1, country: m.country },
    );
    const ids = extractIds(data);
    if (ids.length > 0) return ids;
  } catch {
    // fall through to the HTML fallback
  }
  // Fallback: the SSR category page embeds "productIds":[...] arrays.
  if (cat.categoryUrl) {
    try {
      const path = `${new URL(m.urlPrefix).pathname}/${cat.categoryUrl}`;
      const html = await fetchHtml(site.domain, path, m.acceptLanguage);
      const ids = new Set<number>();
      for (const m of html.matchAll(/"productIds":\[([0-9,\s]*)\]/g)) {
        for (const part of m[1].split(",")) {
          const n = Number(part.trim());
          if (n > 0) ids.add(n);
        }
      }
      return [...ids];
    } catch {
      // give up on this category
    }
  }
  return [];
}

/**
 * Best CDN image url from an Inditex product detail's xmedia.
 *
 * The view code in the filename (…-{view}/…-{view}.jpg) tells us what the image
 * is. The real product photos are the model shots ("-a1".."-a5") and packshots
 * ("-m*"/"-e*"/"-p*"/"-c"); we rank those highest. We avoid two kinds of noise
 * that xmedia often lists FIRST: the "-r" (recorte/cutout) view — frequently an
 * empty ~461-byte blank that renders as a blur — and the spec/marketing
 * infographics ("-i"/"-o"/"-t"/"-k"/"-f"/"-x", the dark "Product details /
 * Technicalities" cards on technical items) — which also get appended to the end
 * of the a-series, so the trailing slots are demoted too. Ranking (not just
 * first-non-cutout) is what stops those infographics being chosen as the card
 * image; xmedia order is not stable, so first-match picks them intermittently.
 */
function viewCode(url: string): string {
  return (url.match(/-([a-z]+\d*)\/[^/]+\.(?:jpe?g|png|webp)(?:$|\?)/i)?.[1] ?? "").toLowerCase();
}
function imageScore(url: string): number {
  const v = viewCode(url);
  if (/^a[1-5]$/.test(v)) return 0; // primary model shots
  if (/^(m|e|p|c)\d*$/.test(v)) return 1; // packshots
  if (/^a([6-9]|1[0-2])$/.test(v)) return 2; // secondary model angles
  if (/^d\d*$/.test(v)) return 3; // fabric/detail close-ups — real photography
  if (/^r\d*$/.test(v)) return 9; // cutout placeholder (often blank)
  if (/^(i|o|t|k|f|x)\d*$/.test(v)) return 8; // spec/marketing infographics
  // Trailing gallery slots. Marketing cards get appended to the end of the
  // a-series (on Oysho's technical outerwear "-a13".."-a15" are the dark
  // "Technicalities" panels), so rank them below every view we can name.
  if (/^a\d+$/.test(v)) return 5;
  return 4; // unknown views
}
/**
 * `colorId` narrows to that colour's own photos (xmedia carries a `colorCode`
 * per colour). Bershka gives every colour its own bundle over ONE shared detail
 * holding all colours' media, so ranking across them handed every colour the
 * same photo. Unknown or absent colour: rank across everything, as before.
 */
export function pickImage(detail: any, colorId?: string | number | null): string | null {
  const all: any[] = detail?.xmedia ?? [];
  const own = colorId == null ? [] : all.filter((x) => String(x?.colorCode) === String(colorId));
  const urls = collectUrls(own.length > 0 ? own : all);
  if (urls.length === 0 && own.length > 0) return pickImage(detail);
  if (urls.length === 0) return null;
  return urls.reduce((best, u) => (imageScore(u) < imageScore(best) ? u : best));
}

function collectUrls(xmedia: any[]): string[] {
  const urls: string[] = [];
  for (const x of xmedia) {
    for (const item of x?.xmediaItems ?? []) {
      for (const media of item?.medias ?? []) {
        const url = media?.url ?? media?.extraInfo?.deliveryUrl;
        if (typeof url === "string" && url.startsWith("http")) urls.push(url);
      }
    }
  }
  return urls;
}

/* ------------------------------------------------------------------ */
/* Photo gallery                                                       */
/* ------------------------------------------------------------------ */

const mediaUrl = (m: any): string | null => {
  const u = m?.url ?? m?.extraInfo?.deliveryUrl;
  return typeof u === "string" && u.startsWith("http") ? u : null;
};

/**
 * The view part of an asset's file name — the segment after its LAST dash,
 * lower-cased: `02830700800-a1t.jpg` → "a1t", `07670351700-A6M.jpg` → "a6m",
 * `00928741400-13-p.jpg` → "p". Wider than viewCode (which only reads
 * letters+digits) because Bershka and Pull&Bear suffix their views. "" when
 * the file has no dash (Pull&Bear's `COLOR_700.jpg` swatch).
 */
function viewToken(url: string): string {
  const stem = (url.split("?")[0].split("/").pop() ?? "").replace(/\.[a-z0-9]+$/i, "");
  const i = stem.lastIndexOf("-");
  return i < 0 ? "" : stem.slice(i + 1).toLowerCase();
}

/** Videos ride in the same lists: `format` 4 with a `.m3u8`/`.mp4` url. Format 1 is a still. */
function isStill(m: any, url: string): boolean {
  if (m?.format != null && Number(m.format) !== 1) return false;
  return !/\.(m3u8|mp4|webm|mov)(?:$|\?)/i.test(url);
}

/**
 * Views that are never a photo of the garment, even inside the brand's own PDP
 * gallery: the "-r" cutout/swatch and "-i" spec cards, plus Oysho's "-a13"/"-a14"
 * — the dark "Product details / Technical features" panel, which Oysho puts
 * SECOND in its gallery (206 of 287 colours sampled 2026-10-03). Matched on the
 * bare token only: Stradivarius leads its gallery with a real "-a15" photo and
 * Pull&Bear's "-a13m" is a photo, so this is deliberately not "a13 and up".
 */
const NOT_A_PHOTO = /^(r\d*|i\d*|a1[34])$/;

/** Sort key for the no-locations fallback: a1 < a2 < … < a10, letters first. */
function viewOrder(url: string): [string, number] {
  const m = viewToken(url).match(/^([a-z]*)(\d*)/);
  return [m?.[1] ?? "", m?.[2] ? Number(m[2]) : 0];
}

/**
 * The colour group a gallery is built from: `colorId`'s own xmedia when it has
 * any, otherwise the colour of the image pickImage chose — so a brand that keeps
 * one row per product (and lets pickImage rank across every colour) still gets a
 * gallery of ONE colour, the one on its card.
 */
function galleryGroup(detail: any, colorId: string | number | null | undefined, first: string): any[] {
  const all: any[] = detail?.xmedia ?? [];
  if (colorId != null) {
    const own = all.filter((x) => String(x?.colorCode) === String(colorId));
    if (collectUrls(own).length > 0) return own;
  }
  const home = all.find((x) => collectUrls([x]).includes(first));
  if (!home) return [];
  return all.filter((x) => String(x?.colorCode) === String(home.colorCode));
}

/**
 * The product page's photo gallery for one colour, `pickImage(detail, colorId)`
 * first. Pass the result through `cleanGallery`.
 *
 * Source of truth is the brand's own PDP gallery: each colour's
 * `xmediaLocations[set].locations` maps a screen slot to an ordered list of
 * media ids, and slot 1 is the product page carousel — verified 2026-10-03 on
 * every colour sampled across Massimo Dutti, Stradivarius, Pull&Bear, Bershka
 * and Oysho (~950). The brand already leaves swatches, cutouts and size
 * placeholders out of it; what it does include and we drop is videos and
 * NOT_A_PHOTO. Set 0 is the default look (a colour can carry dozens of sets).
 *
 * The view code means different things per brand (Massimo Dutti's real photos
 * are "-o1".."-o16", which imageScore ranks as infographics), so ranking alone
 * cannot pick a gallery. It is only the fallback for a payload with no
 * locations: every still of the colour, minus imageScore 8/9, one per view,
 * ordered by (imageScore, view order).
 */
export function pickImages(detail: any, colorId?: string | number | null): string[] {
  const first = pickImage(detail, colorId);
  if (!first) return [];
  const group = galleryGroup(detail, colorId, first);

  const out: string[] = [first];
  const seenViews = new Set<string>([viewToken(first)].filter(Boolean));
  const seenUrls = new Set<string>([first.split("?")[0]]);
  const add = (url: string) => {
    const view = viewToken(url);
    const key = url.split("?")[0];
    if (seenUrls.has(key) || (view && seenViews.has(view))) return; // one url per view
    seenUrls.add(key);
    if (view) seenViews.add(view);
    out.push(url);
  };

  const byId = new Map<string, any>();
  for (const x of group) {
    for (const item of x?.xmediaItems ?? []) {
      for (const m of item?.medias ?? []) if (m?.idMedia != null) byId.set(String(m.idMedia), m);
    }
  }
  let fromLocations = false;
  for (const x of group) {
    const locs: any[] = x?.xmediaLocations ?? [];
    const sets = locs.map((l) => Number(l?.set)).filter(Number.isFinite);
    if (sets.length === 0) continue;
    const set = sets.includes(0) ? 0 : Math.min(...sets);
    const pdp = locs.find((l) => Number(l?.set) === set)?.locations?.find((l: any) => Number(l?.location) === 1);
    for (const id of pdp?.mediaLocations ?? []) {
      fromLocations = true;
      const m = byId.get(String(id));
      const url = mediaUrl(m);
      if (url && isStill(m, url) && !NOT_A_PHOTO.test(viewToken(url))) add(url);
    }
  }
  if (fromLocations) return out;

  const stills: string[] = [];
  for (const x of group) {
    for (const item of x?.xmediaItems ?? []) {
      for (const m of item?.medias ?? []) {
        const url = mediaUrl(m);
        if (url && isStill(m, url) && imageScore(url) < 8 && !NOT_A_PHOTO.test(viewToken(url))) stills.push(url);
      }
    }
  }
  stills
    .map((url, i) => ({ url, i, score: imageScore(url), order: viewOrder(url) }))
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.order[0].localeCompare(b.order[0]) ||
        a.order[1] - b.order[1] ||
        a.i - b.i,
    )
    .forEach(({ url }) => add(url));
  return out;
}

/**
 * Stock state of a single size.
 *
 * `isBuyable` is TRUE even for sold-out sizes, so it can't be used to detect
 * stock — Inditex marks stock with `visibilityValue`, which is what the site
 * reflects. Observed values across all six brands:
 *   SHOW         → in stock
 *   RUNNING_OUT  → still buyable, "son ürünler" (~12% of sizes — must NOT be
 *                  treated as sold out, or buyable sizes disappear and whole
 *                  products can drop out of the feed)
 *   SOLD_OUT / COMING_SOON → not buyable
 */
export function sizeAvailability(size: any): Availability {
  const vis = typeof size?.visibilityValue === "string" ? size.visibilityValue.toUpperCase() : "";
  if (vis) {
    if (vis === "SHOW") return "in_stock";
    if (vis.includes("RUNNING") || vis.includes("LOW") || vis.includes("FEW")) return "low_on_stock";
    return "out_of_stock";
  }
  const a = size?.availability;
  if (typeof a === "string") {
    if (/out|coming|back|soon/i.test(a)) return "out_of_stock";
    if (/low/i.test(a)) return "low_on_stock";
    return "in_stock";
  }
  return size?.isBuyable === false ? "out_of_stock" : "in_stock";
}

/** True when a size can actually be ordered. */
export const sizeInStock = (size: any): boolean => sizeAvailability(size) !== "out_of_stock";

/** True when any size is orderable; sizeless products (accessories) count as in stock. */
export function anySizeInStock(sizes: any[] | undefined): boolean {
  const list = sizes ?? [];
  return list.length === 0 ? true : list.some(sizeInStock);
}

/**
 * Colours + per-size availability from a product detail. `detail.colors` lists
 * every colour; per-size stock comes from each size's `availability` string
 * (or its `isBuyable` flag). We surface the colour names plus the primary
 * colour's sizes, deduped by label.
 */
export function pickVariants(detail: any): ProductVariants | null {
  const colors = detail?.colors ?? [];
  if (!colors.length) return null;
  // Colour names can repeat across a product's variants — keep them unique.
  const colorNames: string[] = [
    ...new Set(colors.map((c: any) => c?.name).filter(Boolean) as string[]),
  ];

  // A size label appears once per SKU, each with its own stock state — e.g. XS
  // can be listed SOLD_OUT, SHOW, SOLD_OUT. Taking the first entry mislabels a
  // buyable size as sold out, so keep the BEST state across the duplicates.
  const rank: Record<Availability, number> = { in_stock: 2, low_on_stock: 1, out_of_stock: 0 };
  const order: string[] = [];
  const best = new Map<string, Availability>();
  for (const s of colors[0]?.sizes ?? []) {
    const label = String(s?.name ?? "").trim();
    if (!label) continue;
    const availability = sizeAvailability(s);
    const prev = best.get(label);
    if (prev === undefined) {
      order.push(label);
      best.set(label, availability);
    } else if (rank[availability] > rank[prev]) {
      best.set(label, availability);
    }
  }
  const sizes: SizeVariant[] = order.map((label) => ({ label, availability: best.get(label)! }));
  if (colorNames.length === 0 && sizes.length === 0) return null;
  return { colors: colorNames, sizes };
}

export function mapProduct(
  site: Pick<InditexSite, "brand" | "domain">,
  m: Pick<InditexMarket, "country" | "urlPrefix" | "currency">,
  p: any,
  category: string | null,
  gender: ProductRecord["gender"] = null,
): ProductRecord | null {
  if (!p?.id) return null;
  // Products come wrapped as "bundles"; the real product (with detail.colors)
  // is bundleProductSummaries[0]. Some brands return it unwrapped.
  const real = p.bundleProductSummaries?.[0] ?? p;
  const detail = real?.detail;
  const color = detail?.colors?.[0];
  if (!color) return null;

  // Cheapest size of the first color. Key on sku — size *names* repeat.
  const seenSkus = new Set<number>();
  let price = Infinity;
  let listPrice: number | null = null;
  for (const s of color.sizes ?? []) {
    if (s?.sku == null || seenSkus.has(s.sku)) continue;
    seenSkus.add(s.sku);
    const v = Number(s.price); // already integer minor units, e.g. "65000" = 650.00
    if (!Number.isFinite(v) || v <= 0) continue;
    if (v < price) {
      price = v;
      const old = s.oldPrice == null ? NaN : Number(s.oldPrice);
      listPrice = Number.isFinite(old) && old > v ? old : null;
    }
  }
  if (!Number.isFinite(price)) return null;

  const name: string | undefined = real?.name ?? p.name;
  if (!name) return null;

  const slug: string | undefined = p.productUrl ?? real?.productUrl;
  const url = slug
    ? `${m.urlPrefix}/${encodeURI(slug)}`
    : `${m.urlPrefix}/-l${detail?.displayReference ?? p.id}`;

  // Product-level id: the same garment ships as one bundle id per COLOUR (same
  // url, e.g. …-l00808111). Key on the shared "l{ref}" from the url so colours
  // collapse to one row instead of duplicating the product across the feed.
  const ref = slug?.match(/-l(\d+)/i)?.[1];
  const externalId = ref
    ? "l" + ref
    : detail?.displayReference
    ? String(detail.displayReference).replace(/\D/g, "")
    : String(p.id);

  const imageUrl = pickImage(detail);
  return {
    brand: site.brand,
    country: m.country,
    externalId,
    name,
    url,
    imageUrl,
    images: cleanGallery(pickImages(detail), imageUrl),
    price,
    listPrice,
    currency: m.currency,
    inStock: anySizeInStock(color.sizes),
    category,
    gender,
    variants: pickVariants(detail),
  };
}

/** Turkish-safe lowercase so "İNDİRİM" matches "indirim". */
const foldTr = (s: string) =>
  s.replace(/[İIı]/g, "i").replace(/[Şş]/g, "s").replace(/[Ğğ]/g, "g").toLowerCase();

/**
 * Order categories so markdowns come first: sale rails, then everything else,
 * with "new in"/editorial last (those never carry discounts). Only load-bearing
 * when a cap is set, but it also decides which duplicate wins a collision.
 *
 * The url matters as much as the name. Pull&Bear's 28 real sale rails are named
 * "Tümünü görüntüle" or just the garment, and are only identifiable as sale by
 * their `/indirim/` path — ranking on the name alone scored none of them as
 * sale, while seven identical "Karıştır ve Eşleştir %10 indirim" widgets did
 * rank top and filled every slot. That is how the brand ended up collecting 34
 * products and zero deals.
 */
function categoryRank(name: string, categoryUrl?: string): number {
  const n = foldTr(`${name} ${categoryUrl ?? ""}`);
  if (/indirim|sale|outlet|rebaja|%/.test(n)) return 0;
  if (/yeni|new|editorial|lookbook/.test(n)) return 2;
  return 1;
}

/**
 * Categories are fetched with a small worker pool. Sequentially the full tree
 * takes ~200s for Massimo Dutti (867 leaves) against a 240s per-brand timeout,
 * and a timeout collects nothing at all. Verified at concurrency 5, 8 and 10
 * across all four sites with zero 403/429 and identical product counts; 8 is
 * the setting that keeps the slowest brand comfortably clear (124s -> 50s).
 */
const CATEGORY_CONCURRENCY = Number(process.env.INDITEX_CONCURRENCY ?? 8);

export function makeInditexAdapter(
  site: InditexSite,
): (country?: CountryCode) => Promise<ProductRecord[]> {
  return async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
    const m = await resolveMarket(site, country);
    // 0 = the whole tree. This used to default to 6 leaves, which for Pull&Bear
    // meant six near-identical bundle-widget rails: 34 products, no discounts.
    const maxCategories = Number(process.env.INDITEX_MAX_CATEGORIES ?? 0);
    const all = leafCategories(await categoryTree(site, m))
      .filter((c) => c.id && c.categoryUrl && c.name && !/^empty$/i.test(c.name))
      // stable sort keeps the site's own order within each rank
      .sort((a, b) => categoryRank(a.name!, a.categoryUrl) - categoryRank(b.name!, b.categoryUrl));
    const leaves = maxCategories > 0 ? all.slice(0, maxCategories) : all;

    const byId = new Map<string, ProductRecord>();
    // Categories overlap heavily, so skipping ids another worker already pulled
    // is what makes the full tree affordable — it cut Pull&Bear from 627 API
    // calls to 436 with no change in the product count.
    const requested = new Set<string>();
    let next = 0;

    await Promise.all(
      Array.from({ length: Math.min(CATEGORY_CONCURRENCY, leaves.length) }, async () => {
        while (next < leaves.length) {
          const cat = leaves[next++];
          // number[], not string[]: these ids arrive as JSON numbers and every
          // use below coerces (String(id), join(",")), so the old annotation was
          // a lie that only survived because packages/ is outside the web
          // tsconfig. The public collector repo typechecks this file.
          let ids: number[];
          try {
            ids = await categoryProductIds(site, m, cat);
          } catch {
            continue; // a dead category shouldn't stop the crawl
          }
          const fresh = ids.filter((id) => !requested.has(String(id)));
          for (const id of fresh) requested.add(String(id));
          for (let i = 0; i < fresh.length; i += PRODUCTS_ARRAY_CHUNK) {
            const csv = fresh.slice(i, i + PRODUCTS_ARRAY_CHUNK).join(",");
            try {
              const data = await getJson<any>(
                `${api(site, m, 3)}/productsArray?productIds=${csv}&languageId=${m.languageId}&appId=1`,
                { country: m.country },
              );
              for (const p of data.products ?? []) {
                const rec = mapProduct(site, m, p, cat.name ?? null, cat.gender ?? null);
                const prev = byId.get(rec?.externalId ?? "");
                if (rec && !prev) byId.set(rec.externalId, rec);
                // A sectionless rail (Landing/sale widget) can win the dedupe
                // race — backfill gender when a sectioned category sees the
                // same product later in the run.
                else if (prev && prev.gender == null && cat.gender != null) prev.gender = cat.gender;
              }
            } catch {
              // skip a failing chunk; keep going
            }
          }
        }
      }),
    );
    return [...byId.values()];
  };
}

/* ------------------------------------------------------------------ */
/* Akamai-interstitial-aware HTML fetch (used only for the fallback). */
/* ------------------------------------------------------------------ */

const jars = new Map<string, Map<string, string>>(); // domain -> cookie name -> value

function jarFor(domain: string): Map<string, string> {
  let jar = jars.get(domain);
  if (!jar) {
    jar = new Map();
    jars.set(domain, jar);
  }
  return jar;
}

function cookieHeader(domain: string): string {
  return [...jarFor(domain)].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(domain: string, res: Response): void {
  const jar = jarFor(domain);
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const pair = sc.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

async function rawGet(domain: string, url: string, acceptLanguage: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": acceptLanguage,
      ...(jarFor(domain).size > 0 ? { Cookie: cookieHeader(domain) } : {}),
    },
  });
  storeCookies(domain, res);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/**
 * Fetch an HTML page, transparently solving Akamai's "interstitial"
 * challenge (a bm-verify token plus a trivial arithmetic proof-of-work).
 */
async function fetchHtml(domain: string, path: string, acceptLanguage: string): Promise<string> {
  const url = `https://${domain}${path}`;
  let html = await rawGet(domain, url, acceptLanguage);
  const bm = html.match(/"bm-verify": "([^"]+)"/);
  if (!bm) return html;

  const base = html.match(/var i = (\d+)/);
  const add = html.match(/Number\("(\d+)" \+ "(\d+)"\)/);
  if (!base || !add) throw new Error(`unsolvable Akamai interstitial at ${url}`);
  const pow = Number(base[1]) + Number(add[1] + add[2]);

  const res = await fetch(`https://${domain}/_sec/verify?provider=interstitial`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/json",
      ...(jarFor(domain).size > 0 ? { Cookie: cookieHeader(domain) } : {}),
    },
    body: JSON.stringify({ "bm-verify": bm[1], pow }),
  });
  storeCookies(domain, res);

  html = await rawGet(domain, url, acceptLanguage);
  if (html.includes('"bm-verify"')) throw new Error(`Akamai interstitial persisted at ${url}`);
  return html;
}
