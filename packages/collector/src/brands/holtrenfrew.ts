/**
 * Holt Renfrew (holtrenfrew.com) — Canada only. The country's luxury
 * department store: Dior, Burberry, Off-White, Tom Ford, Zimmermann, Levi's...
 *
 * The storefront is SAP Commerce (Hybris) behind Akamai. A desktop browser UA
 * gets "Access Denied" from a GitHub runner; mobile Safari is let through
 * (probe run 42799158188, 2026-11-10: 403 / 200). The Mac is refused whatever
 * the UA (Turkey is geo-blocked), so this adapter is for the runners.
 *
 * Every category page fills its grid from the storefront's own JSON:
 *   GET /en/c/<Category>/results?sort=relevance&q=:date-desc&grid=6&page=N
 * 84 products a page, `pagination.numberOfPages` pages. Without `sort` and
 * `grid` the endpoint answers the same envelope with every field null (probe
 * 42799989131); with them a runner gets the products (probe 42800381176:
 * WomensSale, MensSale 506 results, BeautySale 29).
 *
 * One result is one colour of one style. `price.value` is the selling price
 * and `regularPriceRange` the struck one, both CAD — the pair the tile shows.
 * A result whose regular or selling price is a RANGE (sizes priced apart) has
 * no single was/now pair and is skipped rather than guessed. Beauty "($207
 * Value)" boxes are value sets, not markdowns, and are dropped.
 *
 * Multi-brand: the designer goes to `maker`. No per-size stock in the listing.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "holtrenfrew";

const SITE = "https://www.holtrenfrew.com";
/** Akamai lets mobile Safari through where desktop Chrome gets 403 (see above). */
export const HOLT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "en-CA,en;q=0.9",
  "X-Requested-With": "XMLHttpRequest",
};

/** Sale categories, women first; [category code, gender, most pages read]. */
export const SECTIONS: [code: string, gender: ProductRecord["gender"], maxPages: number][] = [
  ["WomensSale", "kadin", 16],
  ["MensSale", "erkek", 7],
  ["BeautySale", null, 2],
];
const CAP = 2000;
const PAUSE_MS = Number(process.env.HOLT_PAUSE_MS ?? 900);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const resultsUrl = (code: string, page: number): string =>
  `${SITE}/en/c/${code}/results?sort=relevance&q=%3Adate-desc&grid=6&page=${page}`;

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const photo = (u: unknown): string | null => {
  if (typeof u !== "string" || !u) return null;
  const abs = u.startsWith("//") ? `https:${u}` : u.replace(/^http:/, "https:");
  if (!/^https:\/\//.test(abs)) return null;
  return `${abs.split("?")[0]}?wid=900&fmt=jpeg&qlt=80`;
};

/** `availabilityOnline` is "HOLT360SELLABLEONWEB" on every buyable result; anything else is not for sale online. */
const sellable = (v: unknown): boolean => {
  const s = String(v ?? "");
  return /SELLABLE/i.test(s) && !/(NOT|NON|UN)_?SELLABLE/i.test(s);
};

/** "/Products/Womens/Womens-Shoes/Boots/…/p/123" → "Boots" (the deepest shelf). */
function shelfOf(path: string): string | null {
  const parts = path.split("/").filter(Boolean);
  const p = parts.indexOf("p");
  const shelf = p >= 3 ? parts[p - 2] : null;
  return shelf ? decodeURIComponent(shelf).replace(/-/g, " ").trim() || null : null;
}

/** Map one result (one colour). Pure; null unless it is a single-priced, real reduction in CAD. */
export function mapHolt(p: any, gender: ProductRecord["gender"]): ProductRecord | null {
  const id = String(p?.code ?? "").trim();
  const title = String(p?.name ?? "").trim();
  const path = String(p?.url ?? "");
  if (!id || !title || !path.includes("/p/")) return null;
  if (p?.price?.currencyIso !== "CAD") return null;
  const now = num(p.price.value);
  const wasLo = num(p?.regularPriceRange?.minPrice?.value), wasHi = num(p?.regularPriceRange?.maxPrice?.value);
  const nowLo = num(p?.priceRange?.minPrice?.value), nowHi = num(p?.priceRange?.maxPrice?.value);
  if (now == null || wasLo == null) return null;
  if (wasHi != null && wasHi !== wasLo) return null;
  if (nowLo != null && nowHi != null && nowLo !== nowHi) return null;
  if (now >= wasLo) return null;
  // "Beauty Box ($207 Value)": the was-price of a set is the sum of its parts.
  if (/\(\s*\$[\d,.]+\s+value\s*\)|\bvalue set\b/i.test(title)) return null;
  const maker = String(p?.brand ?? "").trim() || null;
  const shots = (Array.isArray(p?.images) ? p.images : []).map((i: any) => photo(i?.url)).filter((u: string | null): u is string => !!u);
  const colour = typeof p?.color === "string" && p.color.trim() ? p.color.trim() : null;
  const kids = /^\/Products\/Kids\//i.test(path);
  const group = String(p?.secondid ?? "").split("_")[0];
  return {
    brand,
    country: "CA",
    externalId: id,
    name: maker && !title.toLowerCase().startsWith(maker.toLowerCase()) ? `${maker} ${title}` : title,
    url: `${SITE}/en${path}`,
    imageUrl: shots[0] ?? null,
    images: cleanGallery(shots, shots[0] ?? null),
    price: toMinor(now),
    listPrice: toMinor(wasLo),
    currency: "CAD",
    inStock: sellable(p?.availabilityOnline),
    category: shelfOf(path),
    maker,
    gender: kids ? "cocuk" : gender,
    variants: colour ? { colors: [colour], sizes: [] } : null,
    groupKey: /^\d{6,}$/.test(group) ? `holtrenfrew:${group}` : null,
    colorName: colour,
  };
}

export async function listHoltRenfrew(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "CA") return [];
  const byId = new Map<string, ProductRecord>();
  let calls = 0, seen = 0;
  for (const [code, gender, maxPages] of SECTIONS) {
    for (let page = 0; page < maxPages && byId.size < CAP; page++) {
      if (calls++) await sleep(PAUSE_MS);
      const data = await getJson<any>(resultsUrl(code, page), { country, headers: HOLT_HEADERS, retries: 1, timeoutMs: 45_000 }).catch((e) => {
        console.warn(`holtrenfrew: ${code} page ${page} failed: ${String(e).slice(0, 120)}`);
        return null;
      });
      const rows: any[] = Array.isArray(data?.results) ? data.results : [];
      seen += rows.length;
      for (const p of rows) {
        const r = mapHolt(p, gender);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      const pages = Number(data?.pagination?.numberOfPages ?? 0);
      if (!rows.length || page + 1 >= pages) break;
    }
  }
  // A null envelope (the endpoint's answer to a request it does not like) must
  // not read as "no sale on": that would delist the whole store.
  if (seen === 0) throw new Error("holtrenfrew/CA: the results endpoint returned no products (blocked or changed?)");
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listHoltRenfrew;
