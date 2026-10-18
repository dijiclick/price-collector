/**
 * Canadian Tire Corporation banners — Sport Chek (sportchek.ca) and Mark's
 * (marks.com). Both storefronts run on one platform whose product search is an
 * Azure API Management gateway: `https://apim.<banner host>/v1/search/v2/search`.
 *
 * The gateway wants the storefront's PUBLIC subscription key (it ships in every
 * page's config, `"apim-subscriptionkey"`) plus the banner headers the web app
 * sends (`bannerid`, `basesiteid`, `service-client`, ...). Akamai refuses
 * Turkish and German IPs for the sites AND the gateway, but a GitHub runner
 * gets 200 with no proxy (probe runs 39135071313 and 39135348509, 2026-10-18:
 * Sport Chek sale 1,123 products, Mark's 1,062).
 *
 * One product = one style; `options[descriptor=COLOUR].values[]` carries each
 * colour's own `currentPrice` / `originalPrice`, `isOnSale`, `maxSkuAts` (units
 * available) and photos. A colour is a row only when both prices are single
 * values (`value`), not a "from" `minPrice`, and now < was. Kids' styles are
 * dropped by title, and so is equipment (no Women's/Men's/Unisex in the title —
 * skis, bikes, tents) — the women 18-45 audience wears what we list.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";

export interface CtcBanner {
  brand: "sportchek" | "marks";
  /** The banner code the gateway validates (`ctr|pty|mks|atm|sc|leq`). */
  banner: "SC" | "MKS";
  site: string;
  api: string;
  serviceClient: string;
  /** A store id the web app sends (only scopes "in stock at my store"). */
  store: string;
}

/** Public, from the storefront config (`apim-subscriptionkey`); the same for every CTC banner. */
const KEY = "c01ef3612328420c9f5cd9277e815a0e";
const COUNT = 100;
const MAX_PAGES = 13;
const CAP = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const CTC: Record<CtcBanner["brand"], CtcBanner> = {
  sportchek: { brand: "sportchek", banner: "SC", site: "https://www.sportchek.ca", api: "https://apim.sportchek.ca", serviceClient: "sc/web", store: "241" },
  marks: { brand: "marks", banner: "MKS", site: "https://www.marks.com", api: "https://apim.marks.com", serviceClient: "mks/web", store: "208" },
};

export function ctcHeaders(b: CtcBanner): Record<string, string> {
  return {
    "Ocp-Apim-Subscription-Key": KEY,
    bannerid: b.banner,
    basesiteid: b.banner,
    "service-client": b.serviceClient,
    "service-version": "v1",
    lang: "en_CA",
    "x-web-host": new URL(b.site).host,
    Accept: "application/json",
  };
}

/** The sale facet ("x1=deals&q1=Sale" is the url the API itself hands out for its Sale filter). */
export function ctcSearchUrl(b: CtcBanner, page: number): string {
  const p = new URLSearchParams({ q: "*", lang: "en_CA", site: "ct", format: "json", x1: "deals", q1: "Sale", count: String(COUNT), page: String(page), store: b.store });
  return `${b.api}/v1/search/v2/search?${p}`;
}

const single = (o: any): number | null => {
  if (!o || o.minPrice != null || o.maxPrice != null) return null;
  const n = Number(o.value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

export function ctcGender(title: string): ProductRecord["gender"] | "kids" | "none" {
  if (/\b(kids?|boys?|girls?|juniors?|youth|toddlers?|infants?|baby|little kids?|big kids?)'?s?\b/i.test(title)) return "kids";
  if (/\bwomen'?s\b|\bladies'?\b/i.test(title)) return "kadin";
  if (/\bmen'?s\b/i.test(title)) return "erkek";
  if (/\bunisex\b/i.test(title)) return null;
  return "none";
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

/** Map one search product (one style) to one row per reduced colour. Pure. */
export function mapCtc(b: CtcBanner, p: any): ProductRecord[] {
  const code = String(p?.code ?? "").trim();
  const title = String(p?.title ?? "").trim();
  const path = String(p?.url ?? "").split(/[?#]/)[0];
  if (!code || !title || !path.startsWith("/")) return [];
  const gender = ctcGender(title);
  if (gender === "kids" || gender === "none") return [];
  const colours: any[] = (Array.isArray(p?.options) ? p.options : []).find((o: any) => o?.descriptor === "COLOUR")?.values ?? [];
  const reduced = colours
    .map((v) => ({ v, price: single(v?.currentPrice), listPrice: single(v?.originalPrice) }))
    .filter((x) => x.v?.id && x.price != null && x.listPrice != null && x.price < x.listPrice);
  const make = String(p?.brand?.label ?? "").trim();
  const styleImgs: string[] = (Array.isArray(p?.images) ? p.images : []).map((i: any) => i?.url).filter((u: any) => typeof u === "string");
  return reduced.map(({ v, price, listPrice }) => {
    const photos: string[] = (Array.isArray(v.mediaSet) ? v.mediaSet : []).map((m: any) => m?.url).filter((u: any) => typeof u === "string");
    const img = photos[0] ?? styleImgs[0] ?? null;
    const colour = String(v.value ?? "").trim();
    return {
      brand: b.brand,
      country: "CA" as const,
      externalId: `${code}-${String(v.id).replace(/^COLOUR_/, "")}`,
      // Titles already lead with the brand ("On Women's Cloud X 4"); the label is often upper-case.
      name: make && !title.toLowerCase().startsWith(make.toLowerCase()) ? `${titleCase(make)} ${title}` : title,
      url: `${b.site}${path}`,
      imageUrl: img,
      images: cleanGallery(photos.length ? photos : styleImgs, img),
      price: price!,
      listPrice: listPrice!,
      currency: "CAD",
      inStock: v.maxSkuAts == null ? true : Number(v.maxSkuAts) > 0,
      category: null,
      gender,
      variants: colour ? { colors: [titleCase(colour)], sizes: [] } : null,
      groupKey: reduced.length > 1 ? `${b.brand}-${code}` : null,
      colorName: colour ? titleCase(colour) : null,
    };
  });
}

export async function listCtc(b: CtcBanner, country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "CA") return [];
  const byId = new Map<string, ProductRecord>();
  let seen = 0;
  const problems: string[] = [];
  for (let page = 1; page <= MAX_PAGES && byId.size < CAP; page++) {
    if (page > 1) await sleep(600);
    const data = await getJson<any>(ctcSearchUrl(b, page), { country, headers: ctcHeaders(b), retries: 1, timeoutMs: 45_000 }).catch((e) => {
      problems.push(`p${page}: ${String(e).slice(0, 120)}`);
      return null;
    });
    const list: any[] = Array.isArray(data?.products) ? data.products : [];
    seen += list.length;
    for (const p of list) for (const r of mapCtc(b, p)) if (!byId.has(r.externalId)) byId.set(r.externalId, r);
    const pages = Number(data?.pagination?.total ?? 0);
    if (!list.length || page >= pages) break;
  }
  if (seen === 0) throw new Error(`${b.brand}: every sale page returned no products (${problems.slice(0, 3).join("; ")})`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
