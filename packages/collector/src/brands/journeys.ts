/**
 * Journeys (US: journeys.com, CA: journeys.ca) — multi-brand shoe store.
 *
 * Listings come from the site's Constructor.io index (public keys in its own
 * `cnstrc.com/js/cust/journeys_pxxVYC.js`, one index per market):
 *
 *   US  GET https://ac.cnstrc.com/browse/on_sale/1?key=key_uusp9pSUpA67hlCA&num_results_per_page=200&page=N
 *   CA  GET https://ac.cnstrc.com/browse/group_id/0?key=key_KTjWbxbaYWLNxIVG&...   (whole catalogue,
 *       ~1.2k items: the CA index does not answer the `on_sale` browse, so it is
 *       walked and filtered)
 *
 * Each item has `price` (selling) and `list_price` (the regular price the site
 * strikes through) in the market's currency, `quantity` (stock), `brand` (the
 * maker) and a gender facet. Rows are kept only when list_price > price.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "journeys";

const PER_PAGE = 200;
const CAP = 1500;
const PAUSE_MS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const JOURNEYS_MARKETS: Partial<Record<CountryCode, { key: string; site: string; currency: string; browse: string; pages: number }>> = {
  US: { key: "key_uusp9pSUpA67hlCA", site: "https://www.journeys.com", currency: "USD", browse: "on_sale/1", pages: 8 },
  CA: { key: "key_KTjWbxbaYWLNxIVG", site: "https://www.journeys.ca", currency: "CAD", browse: "group_id/0", pages: 10 },
};

export function browseUrl(country: CountryCode, page: number): string {
  const m = JOURNEYS_MARKETS[country];
  if (!m) throw new Error(`journeys: no market ${country}`);
  return `https://ac.cnstrc.com/browse/${m.browse}?key=${m.key}&num_results_per_page=${PER_PAGE}&page=${page}&c=ciojs-client-2.35.1`;
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", reg: "", trade: "", nbsp: " " };
const decode = (s: string) =>
  s.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m).replace(/\s+/g, " ").trim();

function genderOf(name: string, facets: any[]): ProductRecord["gender"] {
  const g: string[] = (facets ?? []).find((f: any) => f?.name === "gender")?.values ?? [];
  if (/^(kids?|toddler|little kid|big kid|infant|baby|boys|girls)\b/i.test(name) || (g.length && g.every((v) => /boys|girls|kids/.test(v)))) return "cocuk";
  if (/^womens\b/i.test(name) || (g.includes("womens") && !g.includes("mens"))) return "kadin";
  if (/^mens\b/i.test(name) || (g.includes("mens") && !g.includes("womens"))) return "erkek";
  return null;
}

/** Map one Constructor result. Pure; null unless list_price > price. */
export function mapJourneys(x: any, country: CountryCode): ProductRecord | null {
  const m = JOURNEYS_MARKETS[country];
  const d = x?.data;
  if (!m || !d?.id || !d?.url || !x?.value) return null;
  const price = Number(d.price);
  const list = Number(d.list_price);
  if (!(price > 0) || !(list > price)) return null;
  const full = decode(String(x.value));
  // "Womens UGG Classic Mini Boot - Light Bronze": the colour follows the last dash.
  const dash = full.lastIndexOf(" - ");
  const name = dash > 0 ? full.slice(0, dash) : full;
  const colour = dash > 0 ? full.slice(dash + 3) : null;
  const img = typeof d.image_url === "string" ? d.image_url : null;
  const alt = typeof d.alt_image_url === "string" ? d.alt_image_url : null;
  const make = typeof d.brand === "string" && d.brand.trim() ? decode(d.brand) : null;
  return {
    brand,
    country,
    externalId: String(d.id),
    name,
    url: `${m.site}/product/${d.url}`,
    imageUrl: img,
    images: cleanGallery([img, alt], img),
    price: toMinor(price),
    listPrice: toMinor(list),
    currency: m.currency,
    inStock: d.quantity == null ? true : Number(d.quantity) > 0,
    category: null,
    maker: make,
    gender: genderOf(full, d.facets),
    variants: null,
    groupKey: null,
    colorName: colour,
  };
}

export async function listJourneys(country: CountryCode): Promise<ProductRecord[]> {
  const m = JOURNEYS_MARKETS[country];
  if (!m) return [];
  const byId = new Map<string, ProductRecord>();
  for (let page = 1; page <= m.pages; page++) {
    if (page > 1) await sleep(PAUSE_MS);
    const d = await getJson<any>(browseUrl(country, page), { country, retries: 1, timeoutMs: 30_000 });
    const rows: any[] = d?.response?.results ?? [];
    if (!rows.length && page === 1) throw new Error(`journeys/${country}: browse returned no products`);
    for (const x of rows) {
      const r = mapJourneys(x, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (rows.length < PER_PAGE) break;
    if (page === m.pages && page * PER_PAGE < Number(d?.response?.total_num_results ?? 0)) {
      throw new Error(`journeys/${country}: page cap hit at ${page * PER_PAGE} of ${d.response.total_num_results}`);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listJourneys;
