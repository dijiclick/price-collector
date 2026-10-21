/**
 * Crocs (US, Canada, GB and five EU shops) through the Algolia index its own storefront searches.
 *
 * crocs.com (Next.js since late Sept 2026) and crocs.ca (still SFCC) both sit
 * behind a Cloudflare challenge — 403/429 on every page from a runner, and
 * `/products.json` answers 500 — but the product grid comes from Algolia with
 * a public, search-only key in the page config (`config.algolia`: app
 * `JRQ5UG04DE`, index `production_crocs_us__products__default`; Canada has
 * `production_crocs_ca__products__en_CA` under the same app and key). Algolia
 * answers a plain POST from a GitHub runner — no proxy (probe run 38228747327,
 * 2026-10-12: US 1,162 / CA 491 on-sale hits). Europe: see CROCS_MARKETS.
 *
 * - One hit is one colour of one style (`objectID` = master-colour).
 * - `pricing.onSale` marks the Sale section; most of it is Jibbitz charms, so
 *   only footwear is kept (`categoryIDs` women/men/kids footwear or the
 *   footwear silhouette, then bags/charms dropped by `lifestyle`).
 * - `pricing.price` is the price paid; the struck-through price is
 *   `regularPrice` or `regularPriceHigh` (formatted strings, "$69.99" /
 *   "C$57.99"). A hit whose own `price[<currency>]` differs from
 *   `pricing.price` is a "from" price over sizes/promos (the Classic Clog reads
 *   $37.49 sale against its own $49.99), so it is dropped rather than shown at
 *   a discount it may not have.
 * - Stock: `availability.ats` (US only). No per-size stock in the index.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "crocs";

const APP_ID = "JRQ5UG04DE";
const API_KEY = "55963cfd7b24e911afb4e047b6552996"; // public search-only key from the storefront config

/**
 * Crocs Europe (2026-10-21): crocs.co.uk, .de, .fr, .nl, .fi and crocs.eu are
 * one Next.js storefront (Cloudflare 403 on pages) whose page config names a
 * second Algolia app (`XSSKRYKRXP`, its own public search-only key) with one
 * index per shop, same record shape as the US index (categoryIDs, pricing,
 * price.<currency>, color, master). Prices are formatted the European way
 * ("€35,99", "22,50 €"). No `availability` block — a listed sale colour is
 * orderable. crocs.eu's index is `en_ES` (Spain, English, EUR). All six
 * answered a runner (probe 39653951827). No AU index exists on either app.
 */
const EU_APP = { appId: "XSSKRYKRXP", apiKey: "56d582938b8c8af1bb6ffd3f725e724f" }; // public, from the storefront config

export const CROCS_MARKETS: Partial<Record<CountryCode, { index: string; host: string; appId?: string; apiKey?: string }>> = {
  US: { index: "production_crocs_us__products__default", host: "https://www.crocs.com" },
  CA: { index: "production_crocs_ca__products__en_CA", host: "https://www.crocs.ca" },
  GB: { index: "production_crocs_gb__products__en_GB", host: "https://www.crocs.co.uk", ...EU_APP },
  DE: { index: "production_crocs_de__products__de_DE", host: "https://www.crocs.de", ...EU_APP },
  FR: { index: "production_crocs_fr__products__fr_FR", host: "https://www.crocs.fr", ...EU_APP },
  NL: { index: "production_crocs_nl__products__nl_NL", host: "https://www.crocs.nl", ...EU_APP },
  FI: { index: "production_crocs_fi__products__fi_FI", host: "https://www.crocs.fi", ...EU_APP },
  ES: { index: "production_crocs_eu__products__en_ES", host: "https://www.crocs.eu", ...EU_APP },
};

export const CROCS_FILTER =
  'pricing.onSale:true AND (categoryIDs:"women > women-footwear" OR categoryIDs:"men > men-footwear" OR ' +
  'categoryIDs:"kids > kids-footwear" OR categoryIDs:"silhouette > footwear")';

const NOT_SHOES = /^(jibbitz|charms?|bags?|backpacks?|belt bag|tote bag|bag attachments|accessories|keychains|lobster claw|socks|crew socks)$/i;
/** Charm packs sit in kids-footwear too; their own category tree says what they are. */
const NOT_SHOES_CAT = /^(jibbitz|jibbitz-nav|jibbitz-feed|accessories)$/;
const PAGE = 1000;
const MAX_PAGES = 3;
const CAP = Number(process.env.CROCS_MAX_PRODUCTS ?? 1500);
const ATTRS = [
  "objectID", "master", "name", "url", "image", "altImage", "pricing", "price", "availability",
  "gender", "lifestyle", "ai_product_type", "color", "categoryIDs", "primary_category_id",
];

export function crocsQueryUrl(country: CountryCode): string | null {
  const m = CROCS_MARKETS[country];
  if (!m) return null;
  const app = m.appId ?? APP_ID;
  return `https://${app}-dsn.algolia.net/1/indexes/${m.index}/query?x-algolia-application-id=${app}&x-algolia-api-key=${m.apiKey ?? API_KEY}`;
}

export function crocsQueryBody(page: number): string {
  return JSON.stringify({ query: "", hitsPerPage: PAGE, page, filters: CROCS_FILTER, attributesToRetrieve: ATTRS, attributesToHighlight: [] });
}

/** "$1,299.99", "C$57.99", "€35,99", "22,50 €", "1.299,00 €" → number. */
export const money = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  let t = String(v ?? "").replace(/[^0-9.,]/g, "");
  // A comma followed by exactly two digits at the end is a decimal comma.
  if (/,\d{2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : NaN;
};

const GENDER: Record<string, ProductRecord["gender"]> = { women: "kadin", men: "erkek", kids: "cocuk" };

/** One Algolia hit → record, or null when it is not a real footwear markdown. Pure. */
export function mapCrocsHit(hit: any, country: CountryCode): ProductRecord | null {
  const m = CROCS_MARKETS[country];
  if (!m || !hit?.objectID || !hit?.name || !hit?.url) return null;
  const lifestyle: string[] = Array.isArray(hit.lifestyle) ? hit.lifestyle : [];
  const types: string[] = Array.isArray(hit.ai_product_type) ? hit.ai_product_type : [];
  const cats: string[] = Array.isArray(hit.categoryIDs) ? hit.categoryIDs : [];
  if ([...lifestyle, ...types].some((l) => NOT_SHOES.test(String(l)))) return null;
  if (cats.some((c) => NOT_SHOES_CAT.test(String(c))) || /jibbitz/i.test(String(hit.primary_category_id ?? ""))) return null;
  const currency = COUNTRIES[country].currency;
  const p = hit.pricing ?? {};
  const price = money(p.price);
  const own = money(hit.price?.[currency]);
  const list = money(p.regularPrice ?? p.regularPriceHigh);
  if (!(price > 0) || !(list > price)) return null;
  if (!(Math.abs(own - price) < 0.005)) return null;
  const colorId = String(hit.color?.id ?? "").trim();
  const path = String(hit.url);
  const url = `${m.host}${path}${colorId ? `${path.includes("?") ? "&" : "?"}cid=${encodeURIComponent(colorId)}` : ""}`;
  const img = typeof hit.image === "string" ? hit.image : null;
  const ats = hit.availability?.ats;
  return {
    brand,
    country,
    externalId: String(hit.objectID),
    name: String(hit.name).replace(/\s+/g, " ").trim(),
    url,
    imageUrl: img,
    images: cleanGallery([img, hit.altImage], img),
    price: toMinor(price),
    listPrice: toMinor(list),
    currency,
    // The CA index carries no availability block; a listed sale colour is orderable there.
    inStock: typeof ats === "number" ? ats > 0 : true,
    category: lifestyle[0] ?? types[0] ?? null,
    // The European shops also sell Crocs' HEYDUDE line (its own category tree).
    ...(cats.some((c) => /^hey-?dude\b/.test(String(c))) || /\/heydude-/.test(img ?? "") ? { maker: "HEYDUDE" } : {}),
    gender: GENDER[String(hit.gender ?? "").toLowerCase()] ?? null,
    variants: null,
    groupKey: hit.master ? String(hit.master) : null,
    colorName: hit.color?.name ? String(hit.color.name) : null,
  };
}

export async function listCrocs(country: CountryCode): Promise<ProductRecord[]> {
  const url = crocsQueryUrl(country);
  if (!url) return [];
  const byId = new Map<string, ProductRecord>();
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await new Promise((r) => setTimeout(r, 500));
    const res = await getJson<any>(url, {
      country,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: crocsQueryBody(page),
    });
    for (const h of res?.hits ?? []) {
      const r = mapCrocsHit(h, country);
      if (r) byId.set(r.externalId, r);
    }
    if (page + 1 >= Number(res?.nbPages ?? 0)) break;
  }
  if (!byId.size) throw new Error(`crocs ${country}: no discounted footwear in the Algolia sale index`);
  const off = (r: ProductRecord) => (r.listPrice! - r.price) / r.listPrice!;
  return [...byId.values()].sort((a, z) => Number(z.inStock) - Number(a.inStock) || off(z) - off(a)).slice(0, CAP);
}
