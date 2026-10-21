/**
 * Landmark Group's Gulf fashion chains — Centrepoint (multi-brand: Splash,
 * Shoemart, Lifestyle, Babyshop…), Max and Splash. One platform, one
 * Cloudflare policy. Measured 2026-10-11:
 *
 * - Every storefront answers a browser (and a GitHub runner) with a
 *   Cloudflare challenge. Their PLPs, though, are served by Bloomreach
 *   Discovery: `core.dxpapi.com/api/v1/core/`, whose account id, public
 *   auth key and domain key are in each site's own initial state
 *   (`configReducer.data.bloomreach.account`). Bloomreach is not behind the
 *   site's wall — plain GET, no proxy (probe run 38135983616).
 *   (The state also names an Algolia app, LM8X36L8LA — it no longer resolves.)
 * - One domain key per chain, shared by its markets; `view_id=ae|sa` picks the
 *   market's prices and stock (AED vs SAR — without it the default view is
 *   returned, which is not reliably the market asked for).
 * - `price` is the original and `sale_price` the shelf price (Splash KSA
 *   "Tiered Maxi Dress": 199 / 107 SAR, matching the PDP's `salePrice` price
 *   list). `percentageDiscount` is filterable, so only reduced rows are asked
 *   for. `variants[].sku_size` + `inStock` are per-size availability.
 * - `search_type=category&q=<root>` walks a department; rows ≤ 200 per call.
 * - Max's reduced set flips with its sales (2026-10-16): ~290 AE / ~340 SA rows
 *   between sales, >1,500 during one (10-11 18:00 → 10-12 06:00 and 10-15
 *   18:00 → 10-16 06:40 UTC). Every page answered in full both ways — the
 *   short runs were the real reduced set. A sale-only walk then swung the run
 *   between 1500 and ~290 rows: the sweep's 50% guard skipped the drop, so
 *   ~1,000 expired deals stayed "in stock" at their old sale price. So each
 *   department's reduced rows come first and are topped up to its cap with
 *   full-price rows (as Akinon shops do between sales): the run size holds,
 *   the sweep runs, and a full-price row that goes on sale is a real drop.
 * - Qatar and Kuwait (2026-10-21): same keys, `view_id=qa|kw` gives QAR/KWD
 *   (Centrepoint KW "5.5 / 10", Max KW "7 / 9.99"). Splash has no Qatar view.
 * - A page shorter than the result count says it should be (or a doc-less
 *   reply) is retried once, then fails the run: a half-read department must
 *   not pass as a complete one and mark the rest gone.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export interface LandmarkSite {
  slug: string;
  site: string;
  accountId: string;
  authKey: string;
  domainKey: string;
  /** Department roots to walk, in order, with how many deals each may contribute. */
  roots: { q: string; gender: ProductRecord["gender"]; cap: number }[];
  markets: CountryCode[];
}

export const LANDMARK_SITES: Record<string, LandmarkSite> = {
  centrepoint: {
    slug: "centrepoint",
    site: "https://www.centrepointstores.com",
    accountId: "7586",
    authKey: "afxfe9u8i2iwrxp4",
    domainKey: "centrepointstores",
    roots: [
      { q: "women", gender: "kadin", cap: 650 },
      { q: "men", gender: "erkek", cap: 350 },
      { q: "girls", gender: "cocuk", cap: 150 },
      { q: "boys", gender: "cocuk", cap: 100 },
      { q: "baby", gender: "cocuk", cap: 100 },
      { q: "sports", gender: null, cap: 150 },
    ],
    markets: ["AE", "SA", "QA", "KW"],
  },
  maxfashion: {
    slug: "maxfashion",
    site: "https://www.maxfashion.com",
    accountId: "7585",
    authKey: "hcm9cb32yykxejee",
    domainKey: "maxfashion",
    roots: [
      { q: "mxwomen", gender: "kadin", cap: 700 },
      { q: "mxmen", gender: "erkek", cap: 400 },
      { q: "mxkids", gender: "cocuk", cap: 400 },
    ],
    markets: ["AE", "SA", "QA", "KW"],
  },
  splash: {
    slug: "splash",
    site: "https://www.splashfashions.com",
    accountId: "7590",
    authKey: "579w2unmqiq7kvr5",
    domainKey: "splashfashions",
    roots: [
      { q: "women", gender: "kadin", cap: 900 },
      { q: "men", gender: "erkek", cap: 600 },
    ],
    // No Qatar shop: the qa view holds 0 rows (2026-10-21).
    markets: ["AE", "SA", "KW"],
  },
};

const ROWS = 200;
const PAUSE_MS = Number(process.env.LANDMARK_PAUSE_MS ?? 500);
const CAP = Number(process.env.LANDMARK_MAX_PRODUCTS ?? 1500);
const FL = "pid,title,brand,price,sale_price,url,thumb_image,inStock,allCategories,percentageDiscount,variants,sku_size,skuid";
const ALPHA = /^(x{0,3}s|m|x{0,4}l|\d?x[sl]|one size)$/i;

function sizesOf(d: any): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const v of d?.variants ?? []) {
    const raw = String(v?.sku_size ?? "").trim();
    if (!raw) continue;
    const label = ALPHA.test(raw) ? raw.toUpperCase() : raw;
    if (seen.has(label)) continue;
    seen.add(label);
    const ok = (Array.isArray(v?.inStock) ? v.inStock : [v?.inStock]).some((x: unknown) => Number(x) > 0);
    out.push({ label, availability: ok ? "in_stock" : "out_of_stock" });
  }
  return out;
}

function leafOf(d: any): string | null {
  const cats: string[] = (d?.allCategories ?? []).map(String).filter((c: string) => /^[a-z]+(-[a-z0-9]+)+$/.test(c));
  const longest = cats.sort((a, b) => b.split("-").length - a.split("-").length)[0];
  return longest ? longest.split("-").pop()! : null;
}

/** Map one Bloomreach doc. Pure. */
export function mapLandmark(s: LandmarkSite, country: CountryCode, gender: ProductRecord["gender"], d: any): ProductRecord | null {
  const price = Number(d?.sale_price ?? d?.price);
  const orig = Number(d?.price);
  if (!d?.pid || !d?.title || typeof d?.url !== "string" || !(price > 0)) return null;
  const brand = String(d.brand ?? "").trim();
  const title = String(d.title).replace(/\s+/g, " ").trim();
  // Centrepoint is multi-brand; Max and Splash rows are their own label.
  const name =
    s.slug === "centrepoint" && brand && !title.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${title}` : title;
  const img = typeof d.thumb_image === "string" ? d.thumb_image : null;
  const sizes = sizesOf(d);
  const path = d.url.startsWith("/") ? d.url : `/${d.url}`;
  return {
    brand: s.slug,
    country,
    externalId: String(d.pid),
    name,
    url: `${s.site}/${country.toLowerCase()}/en${path}`,
    imageUrl: img,
    images: cleanGallery([img], img),
    price: toMinor(price),
    listPrice: orig > price ? toMinor(orig) : null,
    currency: COUNTRIES[country].currency,
    inStock: Number(d.inStock ?? 1) > 0 && (sizes.length === 0 || sizes.some((x) => x.availability === "in_stock")),
    category: leafOf(d),
    gender,
    variants: sizes.length ? { colors: [], sizes } : null,
  };
}

export function landmarkUrl(s: LandmarkSite, country: CountryCode, q: string, start: number, rows = ROWS, saleOnly = true): string {
  const cc = country.toLowerCase();
  const p = new URLSearchParams({
    account_id: s.accountId,
    auth_key: s.authKey,
    domain_key: s.domainKey,
    catalog_views: `${s.domainKey}:${cc}`,
    view_id: cc,
    request_type: "search",
    search_type: "category",
    q,
    rows: String(rows),
    start: String(start),
    fl: FL,
    ...(saleOnly ? { fq: "percentageDiscount:[1 TO *]" } : {}),
    url: `${s.site}/${cc}/en/`,
    ref_url: `${s.site}/${cc}/en/`,
    _br_uid_2: "uid=1791700000000:v=15.0:ts=1791700000000:hc=1",
    request_id: "1791700000000",
  });
  return `https://core.dxpapi.com/api/v1/core/?${p.toString()}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One page of a department walk. A page that is short of what `numFound`
 * promises, or carries no doc list at all, is asked for again once; still
 * short, it throws — the caller must not read it as the end of the walk.
 */
async function landmarkPage(s: LandmarkSite, country: CountryCode, q: string, start: number, saleOnly: boolean) {
  let why = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await sleep(PAUSE_MS * 3);
    const data = await getJson<any>(landmarkUrl(s, country, q, start, ROWS, saleOnly), { country });
    const docs = data?.response?.docs;
    const numFound = Number(data?.response?.numFound);
    if (Array.isArray(docs) && Number.isFinite(numFound)) {
      const expected = Math.min(ROWS, Math.max(0, numFound - start));
      if (docs.length >= expected) return { docs: docs as any[], numFound };
      why = `docs=${docs.length} numFound=${numFound}`;
    } else {
      why = "no doc list";
    }
  }
  throw new Error(`${s.slug}/${country}: Bloomreach ${q}${saleOnly ? " (reduced)" : ""} page at ${start} came back short (${why})`);
}

export async function listLandmark(slug: string, country: CountryCode): Promise<ProductRecord[]> {
  const s = LANDMARK_SITES[slug];
  if (!s || !s.markets.includes(country)) return [];
  const byId = new Map<string, ProductRecord>();
  let reduced = 0;
  let first = true;
  for (const root of s.roots) {
    let taken = 0;
    // Reduced rows first, then (if the department's cap is not full) full-price rows.
    for (const saleOnly of [true, false]) {
      for (let start = 0; taken < root.cap; start += ROWS) {
        if (!first) await sleep(PAUSE_MS);
        first = false;
        const { docs, numFound } = await landmarkPage(s, country, root.q, start, saleOnly);
        for (const d of docs) {
          if (taken >= root.cap) break;
          const r = mapLandmark(s, country, root.gender, d);
          if (!r || byId.has(r.externalId) || (saleOnly && r.listPrice == null)) continue;
          byId.set(r.externalId, r);
          taken++;
          if (r.listPrice != null) reduced++;
        }
        if (docs.length < ROWS || start + ROWS >= numFound) break;
      }
    }
  }
  // Max/Centrepoint/Splash always carry markdowns somewhere; none at all means
  // the reduced filter answered wrong, and a full-price-only run would sweep
  // every deal away.
  if (byId.size && !reduced) throw new Error(`${slug}/${country}: Bloomreach returned no reduced rows`);
  const all = [...byId.values()];
  const rank = (r: ProductRecord) => (r.listPrice != null ? 0 : 2) + (r.inStock ? 0 : 1);
  return all.sort((a, b) => rank(a) - rank(b)).slice(0, CAP);
}
