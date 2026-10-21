/**
 * La Vie en Rose (Canada) — the Coveo search index its own listing pages
 * query. The site embeds a public, anonymous, query-only Coveo token in every
 * page (`window.CoveoConfig.ApiKey`, a 24-hour JWT with role queryExecutor), so
 * one page fetch yields a fresh token and the rest is Coveo's search REST API.
 *
 * The index holds one document per colourway per storefront; `@source`
 * picks the Canadian English one (`lavieenrose-en-CA-CAD`, prices in CAD).
 * `product_status` TemporarilyDisabled rows are not on the site and are
 * excluded. Measured 2026-10-11: 1,036 live discounted colourways, 678 with
 * stock — exactly the site's "678 products" sale count.
 *
 * `sizes` lists the sizes currently buyable (fewer than the variant codes), so
 * they are reported in stock.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson, getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const SITE = "https://www.lavieenrose.com";
const TOKEN_PAGE = `${SITE}/en/sale`;
const SOURCE = "lavieenrose-en-CA-CAD";
const PAGE = 1000;
const CAP = 1500;

const FIELDS = [
  "title", "final_price", "full_price", "price_currency", "total_inventory", "sizes", "color_name",
  "clickableuri", "ec_images", "ec_product_images", "gender_women", "gender_men", "tracking_category",
  "style_number", "product_code", "permanentid",
];

export interface CoveoConfig {
  apiKey: string;
  organizationId: string;
  platformUrl: string;
}

/** The public search config the page embeds; null when the page no longer carries it. */
export function coveoConfigOf(html: string): CoveoConfig | null {
  const m = html.match(/window\.CoveoConfig\s*=\s*(\{.*?\});/);
  if (!m) return null;
  try {
    const c = JSON.parse(m[1]);
    if (!c.ApiKey || !c.OrganizationId) return null;
    return { apiKey: c.ApiKey, organizationId: c.OrganizationId, platformUrl: c.PlatformUrl ?? "https://platform-ca.cloud.coveo.com" };
  } catch {
    return null;
  }
}

/**
 * The storefronts on this Coveo organisation. Bikini Village (2026-10-21) is
 * La Vie en Rose's swimwear chain: same org, same document shape, its own
 * source `bikinivillage-en-CA-CAD` (4,505 live colourways, 2,106 discounted,
 * 885 of them in stock) and its own token page.
 */
export interface CoveoShop { brand: string; site: string; source: string }
const LVER: CoveoShop = { brand: "lavieenrose", site: SITE, source: SOURCE };
export const BIKINI_VILLAGE: CoveoShop = { brand: "bikinivillage", site: "https://www.bikinivillage.com", source: "bikinivillage-en-CA-CAD" };

export function mapLaVieEnRose(raw: any, shop: CoveoShop = LVER): ProductRecord | null {
  const SITE = shop.site;
  const price = Number(raw?.final_price);
  const full = Number(raw?.full_price);
  const id = String(raw?.product_code ?? raw?.permanentid ?? "");
  if (!id || !(price > 0) || !(full > price)) return null;
  if (raw?.price_currency && raw.price_currency !== "CAD") return null;
  const photos: string[] = (Array.isArray(raw.ec_product_images) ? raw.ec_product_images : [])
    .map((p: unknown) => (typeof p === "string" ? (p.startsWith("http") ? p : `${SITE}${p}`) : null))
    .filter(Boolean);
  const first = typeof raw.ec_images === "string" ? raw.ec_images : photos[0] ?? null;
  const inStock = Number(raw.total_inventory) > 0;
  const sizes: SizeVariant[] = inStock
    ? [...new Set<string>((Array.isArray(raw.sizes) ? raw.sizes : []).map(String))].map((label) => ({ label, availability: "in_stock" as const }))
    : [];
  const women = raw.gender_women === "true";
  const men = raw.gender_men === "true";
  const cat = typeof raw.tracking_category === "string" ? raw.tracking_category.split("/").pop()!.trim() : null;
  return {
    brand: shop.brand,
    country: "CA",
    externalId: id,
    name: String(raw.title ?? "").trim(),
    url: `${SITE}${raw.clickableuri ?? ""}`,
    imageUrl: first,
    images: cleanGallery(photos, first),
    price: toMinor(price),
    listPrice: toMinor(full),
    currency: "CAD",
    inStock,
    category: cat || null,
    gender: women && !men ? "kadin" : men && !women ? "erkek" : null,
    variants: sizes.length || raw.color_name ? { colors: raw.color_name ? [String(raw.color_name)] : [], sizes } : null,
    groupKey: raw.style_number ? `${shop.brand}:${raw.style_number}` : null,
    colorName: raw.color_name ?? null,
  };
}

export async function listLaVieEnRose(country: CountryCode = "CA"): Promise<ProductRecord[]> {
  return listCoveoShop(LVER, TOKEN_PAGE, country);
}

/** Bikini Village (CA): the sister store's own sale page carries the same kind of token. */
export async function listBikiniVillage(country: CountryCode = "CA"): Promise<ProductRecord[]> {
  return listCoveoShop(BIKINI_VILLAGE, `${BIKINI_VILLAGE.site}/en/sale`, country);
}

async function listCoveoShop(shop: CoveoShop, tokenPage: string, country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "CA") return [];
  const cfg = coveoConfigOf(await getText(tokenPage, { country: "CA" }));
  if (!cfg) throw new Error(`${shop.brand}/CA: no CoveoConfig on the sale page`);
  const out: ProductRecord[] = [];
  const aq = `@source=="${shop.source}" @discount_percentage>0 @product_status==(ReadyForPublish,New)`;
  for (let first = 0; first < CAP; first += PAGE) {
    const data = await getJson<any>(`${cfg.platformUrl}/rest/search/v2?organizationId=${encodeURIComponent(cfg.organizationId)}`, {
      method: "POST",
      country: "CA",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      // In-stock first: inventory descending puts every sold-out row last.
      body: JSON.stringify({ q: "", aq, firstResult: first, numberOfResults: PAGE, sortCriteria: "@total_inventory descending", fieldsToInclude: FIELDS }),
    });
    const results: any[] = data?.results ?? [];
    for (const r of results) {
      const rec = mapLaVieEnRose(r?.raw, shop);
      if (rec) out.push(rec);
    }
    if (results.length < PAGE || first + PAGE >= Number(data?.totalCount ?? 0)) break;
  }
  const byId = new Map(out.map((r) => [r.externalId, r]));
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const brand = "lavieenrose";
export const listProducts = listLaVieEnRose;
