/**
 * Vineyard Vines (US) through Salesforce Commerce API — the Shopper Search
 * the storefront (PWA Kit, `/mobify/bundle/…`) browses with. Added 2026-11-12,
 * replacing the Algolia index: Algolia now answers every query 403 "the
 * application is blocked" (5 failed runs), the site having moved its search
 * to SFCC. Same route as kendrascott.ts: the PWA's SLAS private-client proxy
 * hands out a guest token, and the API host is not walled.
 *
 * The "Sale" category (`cgid=Sale`, 765 hits on 2026-11-12) returns one hit
 * per variant (colour+size), each with `usd-retail-list-prices` (struck) and
 * `usd-retail-sale-prices` (charged). Rows are folded to one per master+colour
 * — the same `<master>-<colour>` id the Algolia rows used, so stored rows carry on.
 *
 * Sitewide offers: a percent-off promotion flagged `hidePriceCalculation`
 * ("Price As Marked", e.g. `w-11-10-2026-30-percent-off`) is already taken off
 * the price the product page shows (quality check 2026-11-12: ours 49.97,
 * shop 34.98 = 70%). Such a percentage is applied to the charged price.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const SITE = "https://www.vineyardvines.com";
const API = "https://6wb5qs29.api.commercecloud.salesforce.com";
const ORG = "f_ecom_aahw_prd";
const SITE_ID = "Vineyard-Vines";
const CGID = "Sale";
const PAGE = 200;
const MAX_PAGES = 10;
const CAP = 1500;
const PAUSE_MS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const num = (x: unknown): number | null => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The percentage of an "as marked" sitewide promotion on this hit, or 0. */
export function markedPercent(hit: any): number {
  let best = 0;
  for (const p of Array.isArray(hit?.c_productPromotions) ? hit.c_productPromotions : []) {
    if (p?.hidePriceCalculation !== true || p?.promoMessageDetail !== "Percentage") continue;
    const m = String(p?.promotionId ?? "").match(/(?:^|-)(\d{1,2})-percent-off\b/i);
    const n = m ? Number(m[1]) : 0;
    if (n > 0 && n < 90) best = Math.max(best, n);
  }
  return best;
}

const GENDER: Record<string, ProductRecord["gender"]> = { mens: "erkek", womens: "kadin", boys: "cocuk", girls: "cocuk" };

/** Map one Shopper Search hit to a record (real markdowns only). Pure. */
export function mapVineyardVinesHit(hit: any, country: CountryCode = "US"): ProductRecord | null {
  const name = String(hit?.productName ?? "").replace(/\s+/g, " ").trim();
  const path = String(hit?.c_pdpURL ?? "");
  const master = String(hit?.c_master?.masterId ?? hit?.c_baseProductID ?? "");
  const colour = String(hit?.c_variationValues?.color ?? "");
  if (!name || !path || !master || hit?.orderable === false) return null;
  // /product/<dept>-<class>/<slug>/<id>.html — the four apparel departments only (no Home, Pet, gift cards).
  const seg = path.split("/")[2] ?? "";
  const dept = seg.match(/^(mens|womens|boys|girls)-(.+)$/);
  if (!dept) return null;
  const prices = hit?.prices ?? {};
  const list = num(prices["usd-retail-list-prices"]);
  let price = num(prices["usd-retail-sale-prices"]) ?? num(hit?.price);
  if (list == null || price == null) return null;
  const pct = markedPercent(hit);
  if (pct) price = Math.round(price * (100 - pct)) / 100;
  if (!(list > price)) return null;
  const own = hit?.c_images?.image?.disBaseLink ?? hit?.c_images?.image?.link;
  const lead: string | null = typeof own === "string" ? own : typeof hit?.image?.disBaseLink === "string" ? hit.image.disBaseLink : null;
  const category = dept[2].split("-").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
  return {
    brand: "vineyardvines",
    country,
    externalId: colour ? `${master}-${colour}` : master,
    name,
    url: `${SITE}${path.startsWith("/") ? "" : "/"}${path}`,
    imageUrl: lead,
    images: cleanGallery(lead ? [lead] : [], lead),
    price: toMinor(price),
    listPrice: toMinor(list),
    currency: "USD",
    inStock: true,
    category,
    gender: GENDER[dept[1]] ?? null,
    variants: null,
    groupKey: `vineyardvines:${master}`,
    colorName: null,
  };
}

async function guestToken(country: CountryCode): Promise<string> {
  const t = await getJson<any>(`${SITE}/mobify/slas/private/shopper/auth/v1/organizations/${ORG}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=client_credentials&channel_id=${SITE_ID}`,
    country,
  });
  if (!t?.access_token) throw new Error("vineyardvines: no guest token");
  return t.access_token as string;
}

export function vvSearchUrl(offset: number): string {
  const q = new URLSearchParams({
    siteId: SITE_ID,
    refine: `cgid=${CGID}`,
    limit: String(PAGE),
    offset: String(offset),
    currency: "USD",
    expand: "prices,availability,images",
    perPricebook: "true",
  });
  return `${API}/search/shopper-search/v1/organizations/${ORG}/product-search?${q}`;
}

export async function listVineyardVines(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const token = await guestToken(country);
  const byId = new Map<string, ProductRecord>();
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page) await sleep(PAUSE_MS);
    const j = await getJson<any>(vvSearchUrl(page * PAGE), { country, headers: { Authorization: `Bearer ${token}` } });
    const hits: any[] = Array.isArray(j?.hits) ? j.hits : [];
    for (const h of hits) {
      const r = mapVineyardVinesHit(h, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (!hits.length || (page + 1) * PAGE >= Number(j?.total ?? 0) || byId.size >= CAP) break;
  }
  return [...byId.values()].slice(0, CAP);
}
