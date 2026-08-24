import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { pickImage, pickVariants, sizeInStock, anySizeInStock, genderFromText } from "./_inditex";

// Inditex itxrest API. Oysho TR: brandId=6, store 64009621, catalog 60361124,
// languageId -43 (tr). The grid/product endpoints sit behind Akamai and 403
// without browser-like CORS headers; the header set below is enough.
const API = "https://www.oysho.com/itxrest";
const STORE = "64009621/60361124";
const SITE = "https://www.oysho.com/tr";
const HEADERS = {
  Accept: "application/json",
  Origin: "https://www.oysho.com",
  Referer: `${SITE}/`,
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
};

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

function api(path: string) {
  return getJson<any>(`${API}/${path}`, { headers: HEADERS });
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

function mapProduct(
  p: any,
  category: string | null,
  gender: ProductRecord["gender"] = null,
): ProductRecord | null {
  if (!p?.id || !p.productUrl) return null;
  const detail = p.bundleProductSummaries?.[0]?.detail ?? p.detail;
  const sizes: any[] = detail?.colors?.[0]?.sizes ?? [];
  const size = sizes.find(sizeInStock) ?? sizes[0];
  // Size prices are strings already in integer minor units ("259000" = 2.590,00 ₺).
  const price = Number(size?.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const oldPrice = Number(size?.oldPrice);
  return {
    brand: "oysho",
    externalId: String(p.id),
    name: p.name ?? "",
    url: encodeURI(`${SITE}/${p.productUrl}`),
    imageUrl: pickImage(detail),
    price,
    listPrice: Number.isFinite(oldPrice) && oldPrice > price ? oldPrice : null,
    currency: "TRY",
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

export async function listProducts(): Promise<ProductRecord[]> {
  const tree = await api(`2/catalog/store/${STORE}/category?languageId=-43&typeCatalog=1&appId=1`);
  const cats = leaves(tree.categories ?? []).slice(0, MAX_CATEGORIES);

  const byId = new Map<string, ProductRecord>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CATEGORY_CONCURRENCY, cats.length) }, async () => {
      while (next < cats.length) {
        const cat = cats[next++];
        try {
          const grid = await api(
            `3/catalog/store/${STORE}/category/${cat.id}/product?languageId=-43&appId=1`
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
              `3/catalog/store/${STORE}/productsArray?languageId=-43&productIds=${chunk}&appId=1`
            );
            for (const p of data.products ?? []) {
              const rec = mapProduct(p, cat.name ?? null, cat.gender ?? null);
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
