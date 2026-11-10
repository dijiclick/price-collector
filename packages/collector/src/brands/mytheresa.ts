/**
 * Mytheresa (mytheresa.com) — luxury multi-brand, Munich. One store per region,
 * each with its own price list and currency.
 *
 * The website is bot-walled (a "something went wrong" shell for any script),
 * but the GraphQL API its own apps use, `api.mytheresa.com/api`, answers a
 * plain POST: the store rides in `X-Store`, the shipping country in
 * `X-Country`, the department in `X-Section` (operation found in the Android
 * app `com.mytheresa.app.mytheresa`: `xProductListingPageV2(slug:)`; the old
 * `xProductListingPage` answers "bad request"). GitHub runner: 200 (probe
 * 42799749679 and the listing probe named in the report).
 *
 * `slug: "/sale"` is the sale listing (25–32k women's styles, ~2k men's),
 * 120 a page, each product with `price.original` / `price.discount` and
 * per-size stock. Amounts are MINOR units, except the zero-decimal currencies
 * (JPY, KRW), which come as whole units and are stored ×100 like every price.
 *
 * Markets are those the store prices in the market's own currency
 * (MYTHERESA_MARKETS). Left out: France (the API answers original == discount
 * there, no strike price), the Gulf (store `ME` is priced in EUR) and the
 * Nordics (store `EU`, EUR).
 *
 * The API rate-limits bursts (`PRODUCT_LISTING_PAGE_TOO_MANY_REQUESTS` after
 * three back-to-back calls), so every call in the process waits its turn
 * (GAP_MS apart) and a limited answer is retried once after a longer wait.
 * ≤ 12 requests per market.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "mytheresa";

export const API = "https://api.mytheresa.com/api";
const SITE = "https://www.mytheresa.com";
const PAGE = 120;
const CAP = 1300;
const GAP_MS = Number(process.env.MYTHERESA_GAP_MS ?? 2600);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Market → Mytheresa store (X-Store, also the url's first path segment) and its currency. */
export const MYTHERESA_MARKETS: Partial<Record<CountryCode, { store: string; currency: string }>> = {
  US: { store: "US", currency: "USD" }, CA: { store: "CA", currency: "CAD" }, GB: { store: "GB", currency: "GBP" },
  DE: { store: "DE", currency: "EUR" }, IT: { store: "IT", currency: "EUR" }, NL: { store: "NL", currency: "EUR" }, AT: { store: "AT", currency: "EUR" },
  ES: { store: "EURO", currency: "EUR" }, BE: { store: "EURO", currency: "EUR" }, IE: { store: "EURO", currency: "EUR" }, PT: { store: "EURO", currency: "EUR" }, FI: { store: "EURO", currency: "EUR" },
  CH: { store: "CH", currency: "CHF" }, AU: { store: "AU", currency: "AUD" },
  JP: { store: "JP", currency: "JPY" }, KR: { store: "KR", currency: "KRW" }, SG: { store: "SG", currency: "SGD" }, HK: { store: "HK", currency: "HKD" },
};
const ZERO_DECIMAL = new Set(["JPY", "KRW"]);

export interface Walk {
  section: "women" | "men";
  max: number;
}
export const WALKS: Walk[] = [
  { section: "women", max: 1000 },
  { section: "men", max: 300 },
];

export const QUERY = `query XProductListingPageQuery($slug: String, $page: Int, $size: Int) {
  xProductListingPageV2(slug: $slug, page: $page, size: $size) {
    pagination { currentPage totalItems totalPages }
    products {
      sku slug name color designer department combinedCategoryName displayImages hasStock isPurchasable
      price { currencyCode discount original }
      variants { size sizeHarmonized availability { hasStock lastStockQuantityHint } }
    }
  }
}`;

export const requestBody = (page: number): string =>
  JSON.stringify({ query: QUERY, variables: { slug: "/sale", page, size: PAGE } });

export const requestHeaders = (country: CountryCode, section: Walk["section"]): Record<string, string> => ({
  "Content-Type": "application/json",
  "Accept-Language": "en",
  "X-Store": MYTHERESA_MARKETS[country]!.store,
  "X-Country": country,
  "X-Section": section,
});

/** Map one listing product. Pure; null unless reduced, in the market's currency. */
export function mapMytheresa(p: any, country: CountryCode, section: Walk["section"] = "women"): ProductRecord | null {
  const m = MYTHERESA_MARKETS[country];
  const sku = String(p?.sku ?? "").trim();
  const title = String(p?.name ?? "").trim();
  const slug = String(p?.slug ?? "").replace(/^\/+/, "");
  if (!m || !sku || !title || !slug) return null;
  if (String(p?.price?.currencyCode ?? "") !== m.currency) return null;
  const scale = ZERO_DECIMAL.has(m.currency) ? 100 : 1;
  const price = Math.round(Number(p.price.discount) * scale);
  const list = Math.round(Number(p.price.original) * scale);
  if (!(price > 0) || !(list > 0) || !(price < list)) return null;

  const make = String(p.designer ?? "").trim();
  const dept = String(p.department ?? section).toLowerCase();
  const sizes: SizeVariant[] = (Array.isArray(p.variants) ? p.variants : [])
    // One-size styles (bags, scarves) carry a single "-" variant: stock, not a size.
    .filter((v: any) => v?.size && String(v.size).trim() !== "-")
    .map((v: any) => {
      const has = v?.availability?.hasStock === true;
      const left = Number(v?.availability?.lastStockQuantityHint);
      return { label: String(v.size), availability: !has ? "out_of_stock" : left > 0 && left <= 1 ? "low_on_stock" : "in_stock" };
    });
  const photos: string[] = (Array.isArray(p.displayImages) ? p.displayImages : [])
    .filter((u: unknown): u is string => typeof u === "string" && u.startsWith("https://"))
    // The listing's 512 px thumbs; the same path serves a 1088 px render.
    .map((u: string) => u.replace("/512/512/66/", "/1088/1088/66/"));
  const cats = String(p.combinedCategoryName ?? "").split("::").map((s) => s.trim()).filter(Boolean);
  return {
    brand,
    country,
    externalId: sku,
    name: make && !title.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${title}` : title,
    url: `${SITE}/${m.store.toLowerCase()}/en/${dept === "men" ? "men" : dept === "kids" ? "kids" : "women"}/${slug}`,
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price,
    listPrice: list,
    currency: m.currency,
    inStock: sizes.length
      ? sizes.some((s) => s.availability !== "out_of_stock")
      : Array.isArray(p.variants) && p.variants.length
        ? p.variants.some((v: any) => v?.availability?.hasStock === true)
        : p.hasStock !== false,
    category: cats.length ? cats[cats.length - 1].toLowerCase() : null,
    maker: make || null,
    gender: dept === "men" ? "erkek" : dept === "kids" ? "cocuk" : "kadin",
    variants: sizes.length ? { colors: [], sizes } : null,
    groupKey: null,
    colorName: typeof p.color === "string" && p.color.trim() ? p.color.trim() : null,
  };
}

/** One call at a time for the whole process, GAP_MS apart: markets may run side by side. */
let turn: Promise<unknown> = Promise.resolve();
function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const run = turn.then(job);
  turn = run.catch(() => null).then(() => sleep(GAP_MS));
  return run;
}

const limited = (d: any): boolean => /TOO_MANY_REQUESTS/.test(String(d?.errors?.[0]?.extensions?.code ?? ""));

/** 4 s apart in market order, so 18 markets do not open with one burst. */
export const startOffset = (country: CountryCode): number =>
  Math.max(0, Object.keys(MYTHERESA_MARKETS).indexOf(country)) * Number(process.env.MYTHERESA_STAGGER_MS ?? 4000);

export async function listMytheresa(country: CountryCode): Promise<ProductRecord[]> {
  if (!MYTHERESA_MARKETS[country]) return [];
  // Stagger the markets' first call (they all start together, one runner each).
  await sleep(startOffset(country));
  const byId = new Map<string, ProductRecord>();
  const problems: string[] = [];
  let seen = 0;
  for (const w of WALKS) {
    let taken = 0;
    for (let page = 1; taken < w.max && byId.size < CAP; page++) {
      const call = () =>
        inTurn(() =>
          getJson<any>(API, { country, method: "POST", body: requestBody(page), headers: requestHeaders(country, w.section), retries: 1, timeoutMs: 45_000 }),
        ).catch((e) => ({ errors: [{ message: String(e).slice(0, 120) }] }));
      let d: any = await call();
      // Every market's job starts at the same minute on its own runner, and the
      // API limits them together (DE got nothing on 2026-11-10): back off 15,
      // 30, then 45 s before giving a page up.
      for (let i = 1; i <= 3 && limited(d); i++) {
        await sleep(15_000 * i);
        d = await call();
      }
      const plp = d?.data?.xProductListingPageV2;
      const rows: any[] = plp?.products ?? [];
      if (!rows.length) {
        if (d?.errors?.length) problems.push(`${w.section} p${page}: ${String(d.errors[0]?.extensions?.code ?? d.errors[0]?.message)}`);
        break;
      }
      seen += rows.length;
      for (const p of rows) {
        if (taken >= w.max) break;
        const r = mapMytheresa(p, country, w.section);
        if (r && !byId.has(r.externalId)) {
          byId.set(r.externalId, r);
          taken++;
        }
      }
      if (page >= Number(plp?.pagination?.totalPages ?? 0)) break;
    }
  }
  if (seen === 0) throw new Error(`mytheresa/${country}: the sale listing returned no products (${problems.slice(0, 3).join("; ")})`);
  if (problems.length && process.env.LUX_DEBUG) console.error(`mytheresa/${country}: ${problems.join("; ")}`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listMytheresa;
