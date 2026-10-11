/**
 * American Eagle + Aerie (+ OFFLINE by Aerie), United States and Canada — ae.com.
 * The Gulf franchise (americaneagle.ae / .sa) is a different shop on the
 * Alshaya platform; this is the same brand in two more markets, so it reuses
 * the `americaneagle` slug.
 *
 * ae.com's pages are behind Akamai, but its product grids are served by
 * Constructor.io, whose zone host and public key sit in the storefront's
 * `/__/env.js` (`constructorApiUrl`, `constructorApiKey`). Constructor answers
 * a plain GET from a GitHub runner — no proxy (probe run 38134835174).
 *
 * One index serves every AE market; each result (one style-colour) carries
 * `price_data_AEO_<MARKET>` with list and sale price, and per-market facets
 * (`clearance_AEO_US`, `avail_aeo_us`, …). We browse the clearance flag for
 * the market, in stock or low stock only — ~1,950 US / ~1,750 CA colours —
 * 200 per page, up to the cap (8 requests).
 *
 * No sizes: the size facet is not exposed per variation to the public key,
 * and AE's own product API (`/ugp-api/`) needs one call per product.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "americaneagle";

const HOST = "https://pwcdauseo-zone.cnstrc.com";
const KEY = "key_1O1krNmVZLba2F7Z"; // public storefront key from ae.com/__/env.js
/** Constructor wants a client id and session; any stable UUID will do. */
const CLIENT_ID = "6f1d2c3e-4b5a-4c6d-8e7f-a1b2c3d4e5f6";
const PAGE_SIZE = 200;
const CAP = 1500;
const PAUSE_MS = 700;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const AE_MARKETS: Partial<Record<CountryCode, { site: string; code: string }>> = {
  US: { site: "https://www.ae.com/us/en", code: "US" },
  CA: { site: "https://www.ae.com/ca/en", code: "CA" },
};

export function browseUrl(country: CountryCode, page: number): string {
  const { code } = AE_MARKETS[country]!;
  const lc = code.toLowerCase();
  const p = new URLSearchParams();
  p.set("key", KEY);
  p.set("c", "ciojs-client-2.62.4");
  p.set("i", CLIENT_ID);
  p.set("s", "1");
  p.set("num_results_per_page", String(PAGE_SIZE));
  p.set("page", String(page));
  p.append(`filters[clearance_AEO_${code}]`, "True");
  p.append(`filters[avail_aeo_${lc}]`, "IN_STOCK");
  p.append(`filters[avail_aeo_${lc}]`, "LIMITED");
  p.set("fmt_options[show_hidden_fields]", "true");
  return `${HOST}/browse/enabled_sites/AEO_${code}?${p}`;
}

const facet = (data: any, name: string): string[] =>
  ((data?.facets ?? []).find((f: any) => f?.name === name)?.values ?? []).map(String);

const https = (u: unknown): string | null =>
  typeof u === "string" && u ? (u.startsWith("//") ? `https:${u}` : u) : null;

function genderOf(data: any): ProductRecord["gender"] {
  const g = facet(data, "gender");
  if (g.includes("Women") && !g.includes("Men")) return "kadin";
  if (g.includes("Men") && !g.includes("Women")) return "erkek";
  if (/^(aerie|offline)$/i.test(String(data?.brandName ?? ""))) return "kadin";
  return null;
}

/** Map one Constructor result. Pure; null unless it is reduced in this market. */
export function mapAeResult(res: any, country: CountryCode): ProductRecord | null {
  const m = AE_MARKETS[country];
  const d = res?.data;
  if (!m || !d?.id || !d?.url || !res?.value) return null;
  const pd = d[`price_data_AEO_${m.code}`];
  // min/min, never min-sale vs max-list: a size range is not a discount.
  const sale = Number(pd?.minSalePrice);
  const list = Number(pd?.minListPrice);
  if (!(sale > 0) || !(list > 0) || sale >= list) return null;
  const avail = facet(d, `avail_aeo_${m.code.toLowerCase()}`)[0];
  const photos = [d.image_url, ...(d.plpSortMediaArray ?? [])].map(https).filter((u): u is string => !!u);
  const colour = facet(d, "color_name")[0] ?? null;
  const type = facet(d, "body")[0] ?? null;
  return {
    brand,
    country,
    externalId: String(d.id),
    name: String(res.value).trim(),
    url: `${m.site}${String(d.url).split("?")[0]}`,
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency: COUNTRIES[country].currency,
    inStock: avail === "IN_STOCK" || avail === "LIMITED",
    category: type,
    gender: genderOf(d),
    variants: null,
    groupKey: `americaneagle-${String(d.id).split("_").slice(0, 2).join("_")}`,
    colorName: colour,
  };
}

export async function listAmericanEagleNA(country: CountryCode): Promise<ProductRecord[]> {
  if (!AE_MARKETS[country]) return [];
  const byId = new Map<string, ProductRecord>();
  const maxPages = Math.ceil(CAP / PAGE_SIZE) + 1;
  for (let page = 1; page <= maxPages && byId.size < CAP; page++) {
    if (page > 1) await sleep(PAUSE_MS);
    const data = await getJson<any>(browseUrl(country, page), { country });
    const results: any[] = data?.response?.results ?? [];
    for (const res of results) {
      const r = mapAeResult(res, country);
      if (r) byId.set(r.externalId, r);
    }
    const total = Number(data?.response?.total_num_results ?? 0);
    if (results.length < PAGE_SIZE || page * PAGE_SIZE >= total) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listAmericanEagleNA;
