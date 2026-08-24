import type { ProductRecord, ProductVariants, SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";

const SITE = "https://www.koton.com";
// Akinon storefront: any category page returns JSON with ?format=json.
const CATS = ["kadin-giyim", "erkek-giyim", "cocuk"];
// The crawled category slug IS the section: it maps 1:1 to a gender.
const CAT_GENDER: Record<string, ProductRecord["gender"]> = {
  "kadin-giyim": "kadin",
  "erkek-giyim": "erkek",
  cocuk: "cocuk",
};

const MAX_CATEGORIES = Number(process.env.KOTON_MAX_CATEGORIES ?? CATS.length);
// Measured 2026-07: kadin-giyim 12797 products / 128 pages, erkek-giyim 3073 / 31,
// cocuk 3505 / 36 (pagination.num_pages at page_size=100) — the old default of 5
// clipped the walk to exactly 1500 products. 170 covers the largest category with
// ~30% growth headroom; it stays as an absolute ceiling so a runaway pagination
// (num_pages lying / pages never emptying) can't loop forever.
const MAX_PAGES = Number(process.env.KOTON_MAX_PAGES ?? 170);
const PAGE_SIZE = 100;

function mapProduct(p: any, gender: ProductRecord["gender"]): ProductRecord | null {
  const pk = p?.pk;
  const price = parseFloat(p?.price); // major units as string, e.g. "1799.99"
  if (!pk || !Number.isFinite(price) || price <= 0) return null;
  const retail = parseFloat(p?.retail_price);
  const img = [...(p.productimage_set ?? [])].sort(
    (a: any, b: any) => (a.order ?? 0) - (b.order ?? 0),
  )[0];
  return {
    brand: "koton",
    externalId: String(pk),
    name: p.name ?? "",
    url: p.absolute_url ? `${SITE}${p.absolute_url}` : SITE,
    imageUrl: img?.image ?? null,
    price: toMinor(price),
    listPrice: Number.isFinite(retail) && retail > price ? toMinor(retail) : null,
    currency: "TRY",
    inStock: p.in_stock === true,
    category: p.attributes?.filterable_kategori ?? p.attributes?.filterable_category ?? null,
    gender,
  };
}

/**
 * Colours + per-size stock from a product's own page (`?format=json`).
 *
 * `variants[]` is a list of attribute groups; sizes live under
 * `integration_size_id` and colours under `integration_color_desc`, each option
 * carrying its own `in_stock`. NB the colour option's `in_stock` is just one
 * SKU's stock, so it is NOT a per-colour aggregate — we only take colour names.
 */
async function fetchVariants(absoluteUrl: string): Promise<ProductVariants | null> {
  const data = await getJson<any>(`${SITE}${absoluteUrl}?format=json`, { retries: 0 }).catch(
    () => null,
  );
  if (!data) return null;
  const groups: any[] = data.variants ?? [];
  const group = (key: string) => groups.find((g) => g?.attribute_key === key)?.options ?? [];

  const seen = new Set<string>();
  const sizes: SizeVariant[] = [];
  for (const o of group("integration_size_id")) {
    const label = String(o?.label ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: o?.in_stock ? "in_stock" : "out_of_stock" });
  }
  const colors: string[] = [
    ...new Set(
      group("integration_color_desc")
        .map((o: any) => String(o?.label ?? "").trim())
        .filter(Boolean) as string[],
    ),
  ];
  if (!sizes.length && !colors.length) return null;
  return { colors, sizes };
}

/** Run `fn` over `items` with bounded concurrency. */
async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

export const brand = "koton";

export async function listProducts(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  for (const cat of CATS.slice(0, MAX_CATEGORIES)) {
    const gender = CAT_GENDER[cat] ?? null;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${SITE}/${cat}/?format=json&page_size=${PAGE_SIZE}&page=${page}`;
      const data = await getJson<any>(url).catch(() => null);
      const list: any[] = data?.products ?? [];
      if (list.length === 0) break;
      for (const p of list) {
        const rec = mapProduct(p, gender);
        if (rec) byId.set(rec.externalId, rec);
      }
      if (page >= (data?.pagination?.num_pages ?? 1)) break;
    }
  }

  // Sizes need one PDP call each, so cover a rotating (shuffled) subset of the
  // discounted products per run; the upsert keeps previously-captured variants,
  // so coverage accumulates across runs.
  const records = [...byId.values()];
  const limit = Number(process.env.KOTON_DETAIL_LIMIT ?? 400);
  const onSite = records.filter((r) => r.url.startsWith(SITE));
  // Prefer discounted products (they're what the feed shows), but when nothing
  // is on sale keep building coverage from the rest.
  const discounted = onSite.filter((r) => r.listPrice != null);
  const pickFrom = discounted.length > 0 ? discounted : onSite;
  for (let j = pickFrom.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [pickFrom[j], pickFrom[k]] = [pickFrom[k], pickFrom[j]];
  }
  await pool(pickFrom.slice(0, limit), 6, async (r) => {
    const v = await fetchVariants(r.url.slice(SITE.length));
    if (v) {
      r.variants = v;
      // Listing `in_stock` is one SKU's stock and is often false while other
      // sizes are buyable; the per-size flags are the accurate aggregate.
      if (v.sizes.length > 0) r.inStock = v.sizes.some((s) => s.availability !== "out_of_stock");
    }
  });

  return records;
}
