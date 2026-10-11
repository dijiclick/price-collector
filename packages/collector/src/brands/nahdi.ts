/**
 * Nahdi (nahdionline.com) — the Saudi pharmacy chain's beauty aisles, KSA
 * (/en-sa) and UAE (/en-ae).
 *
 * Measured 2026-10-11: the Next.js storefront searches Algolia with a public
 * key baked into its bundle (app H9X4IH7M99). Indices: `prod_en_products`
 * (KSA, SAR) and `prod_uae_uae_en_products` (UAE, AED), each with a
 * `_promo_type_desc` replica ("Discount High to Low"). A reduced row carries
 * `price.<CUR>.default_original_formated` ("1,435.00 SAR") beside
 * `price.<CUR>.default`; there is no numeric discount attribute to filter on,
 * so the walk takes the discount-sorted replica per beauty category and keeps
 * rows with an original price. The UAE index stops paging at 1,000 hits, so
 * each category is one 1,000-hit page — 4 requests a market.
 *
 * Only beauty is collected (fragrance, makeup, skin, hair); the pharmacy,
 * supplement and baby aisles are out of scope. Pages are
 * `/<locale>/<url_key>/pdp/<sku>`.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const APP = "H9X4IH7M99";
const KEY = "2bbce1340a1cab2ccebe0307b1310881";
export const NAHDI_MARKETS: Partial<Record<CountryCode, { index: string; locale: string; currency: string }>> = {
  SA: { index: "prod_en_products_promo_type_desc", locale: "en-sa", currency: "SAR" },
  AE: { index: "prod_uae_uae_en_products_promo_type_desc", locale: "en-ae", currency: "AED" },
};
export const NAHDI_CATEGORIES = ["Fragrances", "Makeup", "Skin Care", "Hair Care"];
const PER_PAGE = 1000;
const CAP = 1500;

/** "1,435.00 SAR" → 1435 (NaN when absent). */
export function money(s: unknown): number {
  const m = String(s ?? "").match(/\d[\d,]*(?:\.\d+)?/);
  return m ? Number(m[0].replace(/,/g, "")) : NaN;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function genderOf(name: string): ProductRecord["gender"] {
  if (/\bunisex\b/i.test(name)) return null;
  if (/\b(kids?|baby|children)\b/i.test(name)) return "cocuk";
  if (/\b(for )?(women|her)\b|\bpour femme\b/i.test(name)) return "kadin";
  if (/\b(for )?(men|him)\b|\bpour homme\b/i.test(name)) return "erkek";
  return null;
}

/** Map one Algolia hit. Pure. */
export function mapNahdi(h: any, country: CountryCode, category: string | null = null): ProductRecord | null {
  const m = NAHDI_MARKETS[country];
  const p = m ? h?.price?.[m.currency] : null;
  const price = Number(p?.default);
  const orig = money(p?.default_original_formated);
  const name = String(h?.name ?? "").replace(/\s+/g, " ").trim();
  const key = typeof h?.url === "string" ? h.url.split("?")[0].replace(/\/+$/, "").split("/").pop() : null;
  if (!m || !h?.sku || !name || !key || !(price > 0)) return null;
  const img = typeof h.image_url === "string" ? h.image_url : null;
  const brand = h.manufacturer ? String(h.manufacturer).trim() : "";
  return {
    brand: "nahdi",
    country,
    externalId: String(h.sku),
    name: brand && !squash(name).includes(squash(brand)) ? `${brand} ${name}` : name,
    url: `https://www.nahdionline.com/${m.locale}/${key}/pdp/${h.sku}`,
    imageUrl: img,
    images: cleanGallery([img], img),
    price: toMinor(price),
    listPrice: Number.isFinite(orig) && orig > price ? toMinor(orig) : null,
    currency: m.currency,
    inStock: true, // the storefront index carries buyable rows only
    category,
    gender: genderOf(name),
    variants: null,
  };
}

export const brand = "nahdi";

export async function listProducts(country: CountryCode): Promise<ProductRecord[]> {
  const m = NAHDI_MARKETS[country];
  if (!m) return [];
  const byId = new Map<string, ProductRecord>();
  for (const cat of NAHDI_CATEGORIES) {
    if (byId.size) await new Promise((r) => setTimeout(r, 500));
    const params = new URLSearchParams({
      hitsPerPage: String(PER_PAGE),
      page: "0",
      facetFilters: JSON.stringify([`categories.level0:${cat}`]),
      attributesToHighlight: "",
    }).toString();
    const data = await getJson<any>(`https://${APP.toLowerCase()}-dsn.algolia.net/1/indexes/${m.index}/query`, {
      method: "POST",
      body: JSON.stringify({ params }),
      country,
      headers: { "Content-Type": "application/json", "X-Algolia-Application-Id": APP, "X-Algolia-API-Key": KEY },
    });
    for (const h of data?.hits ?? []) {
      const r = mapNahdi(h, country, cat);
      if (r && r.listPrice != null && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  }
  const off = (r: ProductRecord) => (r.listPrice! - r.price) / r.listPrice!;
  return [...byId.values()].sort((a, z) => off(z) - off(a)).slice(0, CAP);
}
