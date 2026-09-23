import type { ProductRecord } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";
import {
  pickImage,
  pickVariants,
  sizeInStock,
  anySizeInStock,
  genderFromText,
  resolveMarket,
  type InditexMarket,
} from "./_inditex";

// Inditex itxrest API, brandId=6. Store/catalog/language per country come from
// the store list at run time (resolveMarket). That matters for Oysho in
// particular: the code pinned TR catalog 60361124 (a summer catalog no store
// references any more) while the storefront had moved to 60361115
// (OYSHO_WINTER_TURQUIA). The grid/product endpoints sit behind Akamai and 403
// without browser-like CORS headers; the header set below is enough.
const DOMAIN = "www.oysho.com";
const API = `https://${DOMAIN}/itxrest`;
const SITE = {
  domain: DOMAIN,
  brandId: 6,
  // Only used if the store list cannot be read.
  trFallback: { storeId: 64009621, catalogId: 60361115 },
};
const headersFor = (m: Pick<InditexMarket, "urlPrefix">) => ({
  Accept: "application/json",
  Origin: `https://${DOMAIN}`,
  Referer: `${m.urlPrefix}/`,
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
});

/**
 * Oysho has ~660 leaf categories, ordered new-season first, and no sale rail to
 * prioritise — discounts are scattered right across the tail. A low cap
 * therefore truncated the crawl to exactly the part of the catalog that is never
 * marked down: at 10 it returned 649 products and *zero* discounts while 977
 * were live. Crawled sequentially the full tree takes ~223s, which all but hits
 * the 4-minute per-brand timeout (and a timeout collects nothing at all), so the
 * categories are fetched with a small worker pool instead of a smaller cap.
 */
const MAX_CATEGORIES = Number(process.env.OYSHO_MAX_CATEGORIES ?? 660);
const CATEGORY_CONCURRENCY = Number(process.env.OYSHO_CONCURRENCY ?? 5);
const BATCH = 50;

function api(m: InditexMarket, path: string) {
  return getJson<any>(`${API}/${path}`, { headers: headersFor(m), country: m.country });
}

interface OyshoCategory {
  id: number;
  name?: string;
  nameEn?: string;
  key?: string;
  subcategories?: OyshoCategory[];
  /** Not in the JSON — stamped onto leaves during the tree walk. */
  gender?: ProductRecord["gender"];
}

/**
 * Collect leaf categories (no subcategories), skipping internal BUSCADOR nodes.
 * Oysho is a women's store: everything defaults to "kadin" unless a section on
 * the path clearly says otherwise (erkek/man, çocuk/kids).
 */
function leaves(
  cats: OyshoCategory[],
  inherited: ProductRecord["gender"] = null,
  out: OyshoCategory[] = [],
): OyshoCategory[] {
  for (const c of cats) {
    const gender =
      genderFromText(`${c.name ?? ""} ${c.nameEn ?? ""} ${c.key ?? ""}`) ?? inherited;
    const subs = c.subcategories ?? [];
    if (subs.length === 0) {
      if (c.name && c.name !== "BUSCADOR") out.push({ ...c, gender: gender ?? "kadin" });
    } else {
      leaves(subs, gender, out);
    }
  }
  return out;
}

export function mapProduct(
  m: Pick<InditexMarket, "country" | "urlPrefix" | "currency">,
  p: any,
  category: string | null,
  gender: ProductRecord["gender"] = null,
): ProductRecord | null {
  if (!p?.id || !p.productUrl) return null;
  const detail = p.bundleProductSummaries?.[0]?.detail ?? p.detail;
  const sizes: any[] = detail?.colors?.[0]?.sizes ?? [];
  const size = sizes.find(sizeInStock) ?? sizes[0];
  // Size prices are strings already in integer minor units of the store
  // currency ("259000" = 2.590,00 ₺); resolveMarket asserts which currency.
  const price = Number(size?.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const oldPrice = Number(size?.oldPrice);
  return {
    brand: "oysho",
    country: m.country,
    externalId: String(p.id),
    name: p.name ?? "",
    url: encodeURI(`${m.urlPrefix}/${p.productUrl}`),
    imageUrl: pickImage(detail),
    price,
    listPrice: Number.isFinite(oldPrice) && oldPrice > price ? oldPrice : null,
    currency: m.currency,
    inStock: anySizeInStock(sizes),
    category,
    gender,
    variants: pickVariants(detail),
    // Colours are separate bundles sharing one PDP url — group on it.
    groupKey: p.productUrl ? "oysho:" + String(p.productUrl) : null,
    colorName: detail?.colors?.[0]?.name ?? null,
  };
}

export const brand = "oysho";

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  const probe = { urlPrefix: `https://${DOMAIN}/${country.toLowerCase()}` };
  const m = await resolveMarket(SITE, country, headersFor(probe));
  const STORE = `${m.storeId}/${m.catalogId}`;
  const L = m.languageId;
  const tree = await api(m, `2/catalog/store/${STORE}/category?languageId=${L}&typeCatalog=1&appId=1`);
  const cats = leaves(tree.categories ?? []).slice(0, MAX_CATEGORIES);

  const byId = new Map<string, ProductRecord>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CATEGORY_CONCURRENCY, cats.length) }, async () => {
      while (next < cats.length) {
        const cat = cats[next++];
        try {
          const grid = await api(
            m,
            `3/catalog/store/${STORE}/category/${cat.id}/product?languageId=${L}&appId=1`
          );
          // sortedProductIds holds real product ids; productIds mixes in marketing spots.
          // Categories overlap heavily, so skipping ids already mapped by another
          // worker is what keeps the full tree affordable.
          const ids: number[] = (grid.sortedProductIds ?? []).filter(
            (id: number) => !byId.has(String(id))
          );
          for (let i = 0; i < ids.length; i += BATCH) {
            const chunk = ids.slice(i, i + BATCH).join(",");
            const data = await api(
              m,
              `3/catalog/store/${STORE}/productsArray?languageId=${L}&productIds=${chunk}&appId=1`
            );
            for (const p of data.products ?? []) {
              const rec = mapProduct(m, p, cat.name ?? null, cat.gender ?? null);
              if (rec) byId.set(rec.externalId, rec);
            }
          }
        } catch {
          // skip a category that fails; keep going
        }
      }
    }),
  );
  return [...byId.values()];
}
