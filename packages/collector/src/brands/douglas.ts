/**
 * Douglas Switzerland (douglas.ch) — the big multi-brand perfumery, SAP Commerce.
 *
 * The site's own OCC search API (`/api/v2/products/search/category/<code>`)
 * answers plain JSON, but `www.douglas.ch` sits behind Akamai and returns a
 * fake "400 Request Too Long" to datacenter IPs. The mobile app is a Capacitor
 * shell on `app.douglas.ch` (from the Android APK's capacitor.config.json), and
 * that host serves the same `/api/v2` without the wall: verified from a GitHub
 * runner 2026-10-11 (probe run 38134704516), no special headers needed.
 *
 * Two quirks, both measured 2026-10-11:
 * - A Varnish in front keys its cache on the `fields` parameter ONLY, so a
 *   second request with the same `fields` but another `currentPage` gets the
 *   first page back (for 20 min). Each page therefore asks for the same field
 *   list in a different ORDER (a permutation chosen by page number), which
 *   OCC treats identically but the cache sees as a new key. Same page number
 *   → same string, so a cached hit is always the right page.
 * - `pageSize` above 48 is a 400.
 *
 * Category 05 is "Sale"; `gender:FEMALE` narrows it to women (~8.5k rows). The
 * category also holds "Point Rouge" offers that show a percentage but no struck
 * price, so a row counts as a deal only when `storeValue` (the struck price)
 * is above `value`. Every row is one variant (a volume or a shade) with its
 * own stock level; `baseProduct` groups them.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

/**
 * Markets. EU added 2026-10-21: the same OCC API on each country's `app.`
 * host, category 05 = Sale everywhere, and Nocibé (France, same group, its own
 * slug "nocibe") on `app.nocibe.fr`. The EU price shape differs from CH: the
 * struck price is `originalValue` (CH: `storeValue`), with `lowestValue` (the
 * Omnibus 30-day low) and `recommendedRetailValue` (the maker's UVP) beside it.
 *
 * REACHABILITY (2026-10-21): every app host answers the Mac, but from a GitHub
 * runner ALL of them — app.douglas.ch included — now answer Akamai's fake
 * "400 Request Too Long" / `{}` / 403 (probe 39615552849). So none of this runs
 * from the runners; it needs an egress Akamai accepts (the Hetzner box, as for
 * adidas — unverified) before any EU market is listed.
 */
export interface DouglasMarket {
  brand: "douglas" | "nocibe";
  api: string;
  site: string;
  lang: string;
}

export const DOUGLAS_MARKETS: Partial<Record<CountryCode, DouglasMarket>> = {
  CH: { brand: "douglas", api: "https://app.douglas.ch", site: "https://www.douglas.ch", lang: "de-CH,de;q=0.9" },
  DE: { brand: "douglas", api: "https://app.douglas.de", site: "https://www.douglas.de", lang: "de-DE,de;q=0.9" },
  AT: { brand: "douglas", api: "https://app.douglas.at", site: "https://www.douglas.at", lang: "de-AT,de;q=0.9" },
  NL: { brand: "douglas", api: "https://app.douglas.nl", site: "https://www.douglas.nl", lang: "nl-NL,nl;q=0.9" },
  BE: { brand: "douglas", api: "https://app.douglas.be", site: "https://www.douglas.be", lang: "nl-BE,nl;q=0.9" },
  IT: { brand: "douglas", api: "https://app.douglas.it", site: "https://www.douglas.it", lang: "it-IT,it;q=0.9" },
  ES: { brand: "douglas", api: "https://app.douglas.es", site: "https://www.douglas.es", lang: "es-ES,es;q=0.9" },
  FR: { brand: "nocibe", api: "https://app.nocibe.fr", site: "https://www.nocibe.fr", lang: "fr-FR,fr;q=0.9" },
};

const SALE_PATH = "/api/v2/products/search/category/05";
const QUERY =":promotion:gender:FEMALE";
const PAGE_SIZE = 48;
const MAX_PAGES = 55;
const CAP = 1500;
const PAUSE_MS = Number(process.env.DOUGLAS_PAUSE_MS ?? 300);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PRODUCT_FIELDS = [
  "code", "name", "url", "stock(DEFAULT)", "price(DEFAULT)", "baseProduct", "baseProductName",
  "images(DEFAULT)", "brand(DEFAULT)", "brandLine(DEFAULT)", "classifications(DEFAULT)",
  "availability(DEFAULT)", "contentUnit", "numberContentUnits",
];

/** The n-th permutation (factorial base) of the product field list. Pure. */
export function fieldsFor(page: number): string {
  const pool = [...PRODUCT_FIELDS];
  const out: string[] = [];
  let n = page;
  for (let k = pool.length; k > 0; k--) {
    out.push(pool.splice(n % k, 1)[0]);
    n = Math.floor(n / k);
  }
  return `products(${out.join(",")}),pagination(DEFAULT)`;
}

export const pageUrl = (page: number, country: CountryCode = "CH"): string =>
  `${DOUGLAS_MARKETS[country]!.api}${SALE_PATH}?currentPage=${page}&pageSize=${PAGE_SIZE}&query=${encodeURIComponent(QUERY)}` +
  `&fields=${encodeURIComponent(fieldsFor(page))}`;

const clean = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

/** "Caudalie" + "Vinoperfect" + "Anti-Pigmentflecken Creme" → one display name. Pure. */
export function douglasName(p: any): string {
  const parts: string[] = [];
  for (const s of [p?.brand?.name, p?.brandLine?.name, p?.baseProductName || p?.classifications?.[0]?.name]) {
    const v = clean(s);
    if (v && !parts.some((x) => x.toLowerCase().includes(v.toLowerCase()))) parts.push(v);
  }
  return parts.join(" ");
}

/** "50 ml", "510 Gramm", "1 Stück" are amounts; anything else is a shade. */
const AMOUNT = /^\d[\d.,]*\s*(ml|l|cl|g|gramm|kg|mg|stück|st\.?|stuk|stuks|unités?|unidad(es)?|unità|pezz[oi]|pieces?|paar|oz)(?![a-zà-ÿ])/i;

/**
 * The struck price: CH's `storeValue`, else the EU's `originalValue` — but not
 * when that is only the maker's UVP (`recommendedRetailValue`), a price the shop
 * never charged.
 */
function wasPrice(pr: any): number {
  if (pr?.storeValue != null) return Number(pr.storeValue);
  const orig = Number(pr?.originalValue);
  if (pr?.recommendedRetailValue != null && Number(pr.recommendedRetailValue) === orig) return NaN;
  return orig;
}

/** One search row → record, or null when it is not a real struck-price deal. Pure. */
export function mapDouglas(p: any, country: CountryCode = "CH"): ProductRecord | null {
  const m = DOUGLAS_MARKETS[country];
  if (!m) return null;
  const price = Number(p?.price?.value);
  const was = wasPrice(p?.price);
  const name = douglasName(p);
  if (!p?.code || !name || !p?.url || !Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(was) || was <= price) return null;
  const level = p?.stock?.stockLevelStatus;
  const inStock = (level === "inStock" || level === "lowStock") && p?.availability?.code !== "NOT_AVAILABLE";
  const variant = clean(p.name);
  const isAmount = AMOUNT.test(variant);
  const images = cleanGallery((p.images ?? []).map((i: any) => i?.url));
  return {
    brand: m.brand,
    country,
    externalId: String(p.code),
    name,
    url: `${m.site}${p.url}`,
    imageUrl: images?.[0] ?? null,
    images,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: p.price.currencyIso ?? COUNTRIES[country].currency,
    inStock,
    category: clean(p.classifications?.[0]?.name) || null,
    gender: "kadin",
    variants: variant
      ? {
          colors: isAmount ? [] : [variant],
          sizes: isAmount
            ? [{ label: variant, availability: !inStock ? "out_of_stock" : level === "lowStock" ? "low_on_stock" : "in_stock" }]
            : [],
        }
      : null,
    groupKey: p.baseProduct ? `${m.brand}-${p.baseProduct}` : null,
    colorName: variant || null,
  };
}

/** Register as `listDouglas(country)`: Douglas CH + EU (not France — that is Nocibé). */
export async function listDouglas(country: CountryCode): Promise<ProductRecord[]> {
  return DOUGLAS_MARKETS[country]?.brand === "douglas" ? listMarket(country) : [];
}

/** Register as `listNocibe(country)` under the slug "nocibe": France only. */
export async function listNocibe(country: CountryCode): Promise<ProductRecord[]> {
  return DOUGLAS_MARKETS[country]?.brand === "nocibe" ? listMarket(country) : [];
}

async function listMarket(country: CountryCode): Promise<ProductRecord[]> {
  const m = DOUGLAS_MARKETS[country]!;
  const byId = new Map<string, ProductRecord>();
  let pages = MAX_PAGES;
  let inStock = 0;
  for (let page = 0; page < pages; page++) {
    if (page > 0) await sleep(PAUSE_MS);
    const d = await getJson<any>(pageUrl(page, country), { country, headers: { "Accept-Language": m.lang } });
    const total = Number(d?.pagination?.totalPages);
    if (Number.isFinite(total)) pages = Math.min(total, MAX_PAGES);
    const rows: any[] = d?.products ?? [];
    if (!rows.length) break;
    for (const p of rows) {
      const r = mapDouglas(p, country);
      if (r && !byId.has(r.externalId)) {
        byId.set(r.externalId, r);
        if (r.inStock) inStock++;
      }
    }
    if (inStock >= CAP) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
