import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";

const BASE = "https://www.penti.com/pentiwebservices/v2/penti";

function mapProduct(p: any): ProductRecord | null {
  const code = String(p.code ?? "");
  const value = p.price?.value;
  if (!code || typeof value !== "number" || value <= 0) return null;
  const prev = p.price?.previousPrice?.value;
  const img = p.images?.find((i: any) => i.imageType === "PRIMARY") ?? p.images?.[0];
  // Penti CDN urls carry {0}/{1} resize placeholders -> substitute width/height.
  let imageUrl: string | null = null;
  if (img?.url) {
    const raw = img.url.startsWith("http") ? img.url : `https://www.penti.com${img.url}`;
    imageUrl = raw.replace("{0}", "500").replace("{1}", "650");
  }
  /**
   * Penti publishes the printed EAN on every row and we simply never read it.
   *
   * Nothing about a Penti tag can be resolved without this: unlike Inditex,
   * whose article number is inside the product url, Penti's urls are pure
   * slugs (`/tr/kadin/kadin-corap/soket-corap/...`) with no number anywhere for
   * `findProductByBarcode` to match against. So every one of the ~3.7k Penti
   * products was unscannable, and a scan of a real Penti tag (6300672009085,
   * reported 2026-08-28) fell all the way through to "not found".
   *
   * Measured on a 200-row pull: 200/200 rows carry a populated `ean` in the
   * same 630067… range as the physical tags.
   */
  const ean = String(p.ean ?? "").replace(/\D/g, "");

  return {
    brand: "penti",
    externalId: code,
    barcodes: ean.length >= 8 && ean.length <= 14 ? [ean] : null,
    name: p.name ?? "",
    url: p.url ? `https://www.penti.com/tr${p.url}` : "https://www.penti.com/tr",
    imageUrl,
    price: toMinor(value),
    listPrice: typeof prev === "number" && prev > value ? toMinor(prev) : null,
    currency: "TRY",
    inStock: p.stock?.stockLevelStatus !== "outOfStock",
    category: p.categoryName ?? null,
  };
}

export const brand = "penti";

/**
 * Several passes, unioned on product code:
 *
 * - unfiltered, which reports the true catalog size (`totalResults` ~5.5k)
 * - `allCategories:kadin`, because the unfiltered pagination jitters — a few
 *   dozen codes present under the category are missing from an unfiltered pull.
 *   Being the women's root, it also stamps gender on everything it lists.
 * - `gender:MEN/GIRL/BOY` facet passes, because product rows carry no gender
 *   field and `allCategories:erkek`/`cocuk` return totalResults 0 — the facet
 *   is the only crawl-side section marker for the ~600 non-women products
 *   (measured: MEN 182, GIRL 359, BOY 55 → one page each).
 *
 * The old `["kadin", "erkek"]` pair capped us at ~4k: `allCategories:erkek`
 * returns totalResults 0, so that root fetched nothing at all, and the category
 * filter alone hides everything not filed under a root.
 */
const QUERIES: { query: string; gender: ProductRecord["gender"] }[] = [
  { query: ":relevance", gender: null },
  { query: ":relevance:allCategories:kadin", gender: "kadin" },
  { query: ":relevance:gender:MEN", gender: "erkek" },
  { query: ":relevance:gender:GIRL", gender: "cocuk" },
  { query: ":relevance:gender:BOY", gender: "cocuk" },
];

export async function listProducts(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  for (const { query, gender } of QUERIES) {
    let currentPage = 0;
    let totalPages = 1;
    do {
      const url =
        `${BASE}/products/search?query=${query}` +
        `&pageSize=1000&currentPage=${currentPage}&fields=FULL`;
      const res = await getJson<any>(url).catch(() => null);
      if (!res) break;
      for (const p of res.products ?? []) {
        const rec = mapProduct(p);
        if (!rec) continue;
        // Later, narrower passes refine the section; a null pass never erases one.
        rec.gender = gender ?? byId.get(rec.externalId)?.gender ?? null;
        byId.set(rec.externalId, rec);
      }
      totalPages = res.pagination?.totalPages ?? 1;
      currentPage++;
    } while (currentPage < totalPages);
  }
  return [...byId.values()];
}

/** Exposed for penti.test.ts — the mapping is the whole barcode fix. */
export const mapProductForTest = mapProduct;
