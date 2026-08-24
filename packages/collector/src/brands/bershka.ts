import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { pickImage, pickVariants, anySizeInStock, genderFromText } from "./_inditex";

// Bershka TR via the Inditex itxrest gateway. Doesn't use _inditex.ts because
// Bershka leaf categories 404 on their own id — the product grid lives under
// viewCategoryId. Store/catalog ids from /itxrest/2/catalog/store?appId=1&brandId=4.
const SITE = "https://www.bershka.com";
const API = `${SITE}/itxrest`;
const STORE = 44109521;
const CATALOG = 40259537;
const LANG = -43;

// 0 = no cap. Both caps were costing real deals: the 120-per-category limit
// alone hid ~518 discounted items, and 25 of 528 grids hid the rest.
const MAX_CATEGORIES = Number(process.env.BERSHKA_MAX_CATEGORIES ?? 0);
const MAX_PRODUCTS_PER_CATEGORY = Number(process.env.BERSHKA_MAX_PRODUCTS_PER_CATEGORY ?? 0);
const CATEGORY_CONCURRENCY = Number(process.env.BERSHKA_CONCURRENCY ?? 5);
// 80 ids per productsArray call — same payload, a quarter of the requests.
const BATCH = 80;

interface Leaf {
  gridId: number;
  name: string | null;
  /** Section the leaf hangs under (Kadın/Erkek roots) — see genderFromText. */
  gender: ProductRecord["gender"];
}

/** Leaf categories; the product grid id is viewCategoryId when present. */
function leafCategories(
  cats: any[],
  inherited: ProductRecord["gender"] = null,
  seen = new Set<number>(),
  out: Leaf[] = [],
): Leaf[] {
  for (const c of cats ?? []) {
    const gender =
      genderFromText(`${c.name ?? ""} ${c.nameEn ?? ""} ${c.key ?? ""}`) ?? inherited;
    const subs = c.subcategories ?? [];
    if (subs.length > 0) {
      leafCategories(subs, gender, seen, out);
      continue;
    }
    // `??` only falls through on null/undefined, but plenty of leaves carry
    // viewCategoryId: 0 — those all collapsed onto one bogus grid id 0, which
    // hid 483 of 528 real grids. Their own `id` serves a grid fine.
    const gridId = c.viewCategoryId || c.id;
    if (typeof gridId === "number" && !seen.has(gridId)) {
      seen.add(gridId);
      out.push({ gridId, name: c.name ?? null, gender });
    }
  }
  return out;
}

function mapProduct(
  p: any,
  category: string | null,
  gender: ProductRecord["gender"] = null,
): ProductRecord | null {
  if (!p?.id || !p.name || !p.productUrl) return null;
  // Products come wrapped as bundles; the sellable item is bundleProductSummaries[0].
  const real = p.bundleProductSummaries?.[0] ?? p;
  const color = real?.detail?.colors?.[0];
  if (!color) return null;

  // Cheapest size of the first colour. Prices are integer minor-unit strings
  // ("299000" = ₺2.990,00), verified against the live site.
  let price = Infinity;
  let listPrice: number | null = null;
  for (const s of color.sizes ?? []) {
    const v = Number(s?.price);
    if (!Number.isFinite(v) || v <= 0) continue;
    if (v < price) {
      price = v;
      const old = s.oldPrice == null ? NaN : Number(s.oldPrice);
      listPrice = Number.isFinite(old) && old > v ? old : null;
    }
  }
  if (!Number.isFinite(price)) return null;

  // The tag's article number, kept so a scan resolves.
  //
  // Every other Inditex brand happens to carry its reference inside the stored
  // url, so `findProductByBarcode`'s article fallback matches them for free.
  // Bershka's canonical url ends in the bundle id (`-c0p{id}.html`) instead, so
  // the reference appears nowhere and a scanned tag missed. Verified against
  // Bershka's own reference endpoint: `00125041` and the full `0012504171228`
  // both resolve to displayReference `0125/041`.
  const ref = String(real.detail?.displayReference ?? "").replace(/\D/g, "");
  return {
    brand: "bershka",
    externalId: String(p.id),
    barcodes: ref.length >= 6 ? [ref] : null,
    name: p.name,
    // canonical PDP url: slug without its -l{ref} suffix + the bundle summary id
    url: `${SITE}/tr/${encodeURI(String(p.productUrl).replace(/-l\d+$/, ""))}-c0p${real.id ?? p.id}.html`,
    imageUrl: pickImage(real.detail),
    price,
    listPrice,
    currency: "TRY",
    inStock: p.isBuyable !== false && anySizeInStock(color.sizes),
    category,
    gender,
    variants: pickVariants(real.detail),
    // Each colour is its own bundle (p.id) but they share the sellable item's
    // id — the "-c0p{id}" in the PDP url — so group colours on that.
    groupKey: "bershka:" + (real.id ?? p.id),
    colorName: color.name ?? null,
  };
}

export const brand = "bershka";

export async function listProducts(): Promise<ProductRecord[]> {
  const tree = await getJson<any>(
    `${API}/2/catalog/store/${STORE}/${CATALOG}/category?languageId=${LANG}&typeCatalog=1&appId=1`,
  );
  const all = leafCategories(tree.categories ?? []);
  const leaves = MAX_CATEGORIES > 0 ? all.slice(0, MAX_CATEGORIES) : all;

  const byId = new Map<string, ProductRecord>();
  const requested = new Set<string>();
  let next = 0;

  await Promise.all(
    Array.from({ length: Math.min(CATEGORY_CONCURRENCY, leaves.length) }, async () => {
      while (next < leaves.length) {
        const leaf = leaves[next++];
        try {
          const grid = await getJson<any>(
            `${API}/3/catalog/store/${STORE}/${CATALOG}/category/${leaf.gridId}/product?languageId=${LANG}&appId=1`,
          );
          const gridIds: number[] = grid.productIds ?? [];
          const ids =
            MAX_PRODUCTS_PER_CATEGORY > 0 ? gridIds.slice(0, MAX_PRODUCTS_PER_CATEGORY) : gridIds;
          const fresh = ids.filter((id) => !requested.has(String(id)));
          for (const id of fresh) requested.add(String(id));
          for (let i = 0; i < fresh.length; i += BATCH) {
            const batch = fresh.slice(i, i + BATCH);
            const data = await getJson<any>(
              `${API}/3/catalog/store/${STORE}/${CATALOG}/productsArray?languageId=${LANG}&productIds=${batch.join(",")}&appId=1`,
            );
            for (const p of data.products ?? []) {
              const rec = mapProduct(p, leaf.name, leaf.gender);
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
