/**
 * Canadian multi-brand / off-price Shopify stores read per SALE COLLECTION
 * (2026-11-10). Their catalogues are too big for the generic products.json
 * walk (SVP Sports 11,854 products, gravitypope 13,790, Melanie Lyne 5,491), and
 * each keeps its markdowns in collections of its own — so a few pages of
 * `/collections/<handle>/products.json`, best sellers first, are the whole job.
 * Every route answered a GitHub runner in CAD (probes 42799959134,
 * 42800517137); rows are mapped by `_shopify.ts` like any Shopify store.
 *
 * - SVP Sports (svpsports.ca): an off-price sports outlet (adidas, UGG, New
 *   Balance, Puma, Columbia, Birkenstock). EVERY product carries a compare-at —
 *   the brand's regular price, e.g. adidas ZG23 golf shoe $59.99 against
 *   $249.99 — which is what an outlet is; the was-price is the maker's list
 *   price, not a markdown SVP once charged.
 * - gravitypope (gravitypope.com): designer boutique (Acne Studios, A.P.C.,
 *   MM6, Rachel Comey, Dries Van Noten). Sale collections per department.
 * - Livestock (deadstock.ca): sneakers and streetwear (ASICS, Nike, adidas,
 *   New Balance, Carhartt WIP).
 * - Getoutside (getoutsideshoes.com): shoes and bags (New Balance, Converse,
 *   Birkenstock, Vagabond, Dr. Martens).
 * - Below The Belt (belowthebelt.com): western-Canada streetwear chain (Levi's,
 *   The North Face, Dickies, Carhartt, SAXX, Herschel).
 * - Melanie Lyne (melanielyne.com): women's occasion wear; own label, so no maker.
 */
import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { SHOPIFY_CA1110_OUTLETS } from "../../../../lib/live-brands/shopify-ca1110";
import { listShopifyCollection, type CollectionShop } from "./_shopifycollection";

export type CaOutlet = "svpsports" | "gravitypope" | "livestock" | "getoutside" | "belowthebelt" | "melanielyne";

interface Plan {
  /** [collection handle, most pages, gender override or undefined to infer]. */
  collections: [handle: string, maxPages: number, gender?: ProductRecord["gender"]][];
  cap: number;
}

export const CA_OUTLET_PLANS: Record<CaOutlet, Plan> = {
  svpsports: { collections: [["womens-footwear", 4], ["womens-apparel-sale", 3], ["mens-footwear-casual", 2]], cap: 2000 },
  gravitypope: { collections: [["womens-sale", 5], ["mens-sale", 3]], cap: 2000 },
  livestock: { collections: [["sale", 3]], cap: 1500 },
  getoutside: { collections: [["clearance", 6]], cap: 1500 },
  belowthebelt: { collections: [["sale", 5]], cap: 1200 },
  melanielyne: { collections: [["sale", 5, "kadin"]], cap: 1200 },
};

export function collectionShops(brand: CaOutlet): CollectionShop[] {
  const row = SHOPIFY_CA1110_OUTLETS.find((s) => s.brand === brand);
  const site = row?.sites.CA;
  const plan = CA_OUTLET_PLANS[brand];
  if (!row || !site || !plan) return [];
  return plan.collections.map(([collection, maxPages, gender]) => ({
    brand,
    apiOrigin: site,
    site,
    collection,
    maxPages,
    maxProducts: plan.cap,
    defaultGender: row.defaultGender ?? null,
    ...(gender !== undefined ? { gender } : {}),
    vendorAsMaker: row.vendorAsMaker,
    vendorInName: row.vendorInName,
  }));
}

export async function listCaOutlet(brand: CaOutlet, country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "CA") return [];
  const shops = collectionShops(brand);
  const cap = CA_OUTLET_PLANS[brand].cap;
  const byId = new Map<string, ProductRecord>();
  let ok = 0;
  let lastErr: unknown = null;
  for (const shop of shops) {
    if (byId.size >= cap) break;
    const rows = await listShopifyCollection(shop, country).catch((e) => {
      lastErr = e;
      console.warn(`${brand}/CA: collection ${shop.collection} failed: ${String(e).slice(0, 120)}`);
      return null;
    });
    if (!rows) continue;
    ok++;
    for (const r of rows) if (!byId.has(r.externalId)) byId.set(r.externalId, r);
  }
  // Every collection refused: an error, never "no sale on" (that would delist the store).
  if (ok === 0) throw new Error(`${brand}/CA: no sale collection could be read (${String(lastErr).slice(0, 120)})`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
}
