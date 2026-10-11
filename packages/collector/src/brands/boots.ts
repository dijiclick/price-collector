/**
 * Boots in the Gulf (ae.boots.com, sa.boots.com) — another Alshaya shop on the
 * same AEM + Algolia platform as _alshaya.ts, so the hit shape and the mapping
 * are shared (mapAlshaya / alshayaQuery). Measured 2026-10-11:
 *
 * - `ae.boots.com/configs.json` publishes app LQE0C6VCY3, its search-only key
 *   and `bp_prod_<cc>_product_list`. The storefront itself answers plain
 *   requests too, but the collector only talks to `*-dsn.algolia.net`.
 * - Marked-down rows (`discount > 0`): AE ~825, SA ~45. Every row is in stock
 *   (the index holds only buyable rows) and carries no garment sizes.
 * - Boots is a pharmacy as well as a beauty shop. Rows whose department is
 *   Wellness (supplements), Pharmacy, Baby or Opticians are dropped, so what is
 *   left is skincare, make-up, hair, fragrance, suncare and personal care.
 */
import type { ProductRecord } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";
import { alshayaQuery, mapAlshaya, type AlshayaBrand } from "./_alshaya";

export const BOOTS_GULF: AlshayaBrand = {
  slug: "boots",
  appId: "LQE0C6VCY3",
  apiKey: "f12de14eaa992a4ae3a13f40b61c3978",
  prefix: "bp",
  sites: { AE: "https://ae.boots.com", SA: "https://sa.boots.com" },
  defaultGender: null,
};

const MAX_PAGES = 5;
const CAP = Number(process.env.BOOTS_MAX_PRODUCTS ?? 1500);
const NOT_BEAUTY = /(^|\/)\s*(wellness|pharmacy|baby|opticians)\b/i;

/** Map one hit, dropping the non-beauty departments. Pure. */
export function mapBoots(country: CountryCode, h: any): ProductRecord | null {
  if (NOT_BEAUTY.test(String(h?.gtm?.["gtm-category"] ?? ""))) return null;
  const r = mapAlshaya(BOOTS_GULF, country, h);
  // The department name doubles as a promo shelf: "Skin Care 25% to 50% Off".
  if (r?.category) r.category = r.category.replace(/\s*(up to\s*)?\d+%(\s*to\s*\d+%)?\s*off.*$/i, "").trim() || null;
  return r;
}

export async function listBoots(country: CountryCode): Promise<ProductRecord[]> {
  if (!BOOTS_GULF.sites[country]) return [];
  const byId = new Map<string, ProductRecord>();
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await new Promise((r) => setTimeout(r, 800));
    const q = alshayaQuery(BOOTS_GULF, country, page);
    const data = await getJson<any>(q.url, {
      method: "POST",
      body: q.body,
      country,
      headers: {
        "Content-Type": "application/json",
        "X-Algolia-Application-Id": BOOTS_GULF.appId,
        "X-Algolia-API-Key": BOOTS_GULF.apiKey,
      },
    });
    const hits: any[] = data?.hits ?? [];
    for (const h of hits) {
      const r = mapBoots(country, h);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
    if (page + 1 >= Number(data?.nbPages ?? 0) || hits.length === 0) break;
  }
  const off = (r: ProductRecord) => (r.listPrice! - r.price) / r.listPrice!;
  const all = [...byId.values()].sort((a, z) => Number(z.inStock) - Number(a.inStock) || off(z) - off(a));
  return all.slice(0, CAP);
}
