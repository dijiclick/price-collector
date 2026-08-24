import type { ProductRecord, ProductVariants, Availability } from "../types";
import { getJson } from "../http";

const BASE = "https://www.zara.com/tr/tr";

interface ZaraCategory {
  id: number;
  sectionName?: string;
  subcategories?: ZaraCategory[];
}

type Gender = ProductRecord["gender"];

/**
 * Every tree node carries `sectionName` ∈ WOMAN | MAN | KID | HOME | BEAUTY |
 * TRAVEL | BAMO — the only place gender exists (category names hold product
 * types, not sections). Non-gendered sections map to null, never guessed.
 */
function sectionGender(sectionName: string | undefined): Gender {
  const s = String(sectionName ?? "").toUpperCase();
  if (s === "WOMAN") return "kadin";
  if (s === "MAN") return "erkek";
  if (s === "KID" || s === "KIDS") return "cocuk";
  return null;
}

/** Collect leaf category ids (nodes with no subcategories) with their section
 *  gender. A leaf hanging under two conflicting sections degrades to null. */
function leafSections(
  cats: ZaraCategory[],
  inherited: Gender = null,
  out = new Map<number, Gender>(),
): Map<number, Gender> {
  for (const c of cats) {
    const gender = c.sectionName ? sectionGender(c.sectionName) : inherited;
    const subs = c.subcategories ?? [];
    if (subs.length === 0) {
      out.set(c.id, out.has(c.id) && out.get(c.id) !== gender ? null : gender);
    } else {
      leafSections(subs, gender, out);
    }
  }
  return out;
}

/** Zara listing availability -> orderable? Unknown values default to in stock. */
function buyable(availability: any): boolean {
  const a = String(availability ?? "").toLowerCase();
  if (!a) return true;
  return a === "in_stock" || a === "low_on_stock";
}

function mapComponent(c: any, gender: Gender = null): ProductRecord | null {
  if (!c?.id || !c?.seo?.keyword || !c?.seo?.seoProductId) return null;
  const color = c.detail?.colors?.[0] ?? {};
  const price: number | undefined = color.price ?? c.price;
  if (typeof price !== "number" || price <= 0) return null;
  const xmedia = color.xmedia?.[0];
  const imageUrl = xmedia?.url ? String(xmedia.url).replace("{width}", "750") : null;
  return {
    brand: "zara",
    externalId: String(c.id),
    name: c.name ?? "",
    url: `${BASE}/${c.seo.keyword}-p${c.seo.seoProductId}.html?v1=${c.id}`,
    imageUrl,
    price, // Zara prices are already integer minor units (59000 = 590,00 ₺)
    listPrice: typeof color.oldPrice === "number" ? color.oldPrice : null,
    currency: "TRY",
    // Listings keep sold-out and not-yet-released products, and their
    // `availability` matches real per-size stock ("coming_soon"/"out_of_stock"
    // products have no buyable sku), so trust it rather than assuming in stock.
    inStock: buyable(c.availability ?? color.availability),
    // Colours of one product are separate components sharing a seoProductId.
    groupKey: "zara:" + c.seo.seoProductId,
    colorName: color.name ?? null,
    gender,
  };
}

const normAvail = (a: any): Availability =>
  /out|coming|back|soon/i.test(String(a)) ? "out_of_stock" : /low/i.test(String(a)) ? "low_on_stock" : "in_stock";

/**
 * Sizes for every colour of a product, keyed by the colour's own component id
 * (`color.productId`, which equals a sibling record's externalId). One
 * products-details call returns ALL colours, so a single request covers the
 * whole colour group — that's what lets switching colour on the PDP show sizes,
 * not just the one colour we happened to query. Category listings carry no
 * sizes, so this per-group call is unavoidable.
 */
async function fetchGroupSizes(id: string): Promise<Map<string, ProductVariants>> {
  const out = new Map<string, ProductVariants>();
  try {
    const arr = await getJson<any[]>(`${BASE}/products-details?productIds=${id}&ajax=true`, { retries: 1 });
    for (const color of arr?.[0]?.detail?.colors ?? []) {
      const ext = String(color?.productId ?? "");
      if (!ext) continue;
      const sizes = (color?.sizes ?? [])
        .map((s: any) => ({ label: String(s?.name ?? "").trim(), sku: Number(s?.sku), availability: normAvail(s?.availability) }))
        .filter((s: any) => s.label && Number.isFinite(s.sku));
      if (sizes.length) out.set(ext, { colors: color?.name ? [color.name] : [], sizes });
    }
  } catch {
    /* skip this group */
  }
  return out;
}

/** Run `fn` over `items` with bounded concurrency. */
async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export const brand = "zara";

export async function listProducts(): Promise<ProductRecord[]> {
  // 0 = the whole tree. This was 25, applied to the raw (duplicate-laden) id
  // list, so at most 25 of 1345 unique leaf categories were ever visited — under
  // 2% of the tree, which is why Zara reported ~2900 products against a catalog
  // of ~20000. There is no per-category pagination to worry about: a category
  // request returns all of its products at once, so the slice was the only
  // truncation.
  const maxCategories = Number(process.env.ZARA_MAX_CATEGORIES ?? 0);
  const tree = await getJson<{ categories: ZaraCategory[] }>(`${BASE}/categories?ajax=true`);
  const genderByCat = leafSections(tree.categories ?? []);
  const unique = [...genderByCat.keys()];
  const leaves = maxCategories > 0 ? unique.slice(0, maxCategories) : unique;

  const byId = new Map<string, ProductRecord>();
  // Sequentially the full tree is ~630s against a 240s per-brand timeout, and a
  // timeout collects nothing at all, so the listing pass is pooled.
  const listingConcurrency = Number(process.env.ZARA_CONCURRENCY ?? 16);
  let nextCat = 0;
  await Promise.all(
    Array.from({ length: Math.min(listingConcurrency, leaves.length) }, async () => {
      while (nextCat < leaves.length) {
        const catId = leaves[nextCat++];
        try {
          const data = await getJson<any>(`${BASE}/category/${catId}/products?ajax=true`);
          for (const group of data.productGroups ?? []) {
            for (const el of group.elements ?? []) {
              for (const comp of el.commercialComponents ?? []) {
                const rec = mapComponent(comp, genderByCat.get(catId) ?? null);
                if (rec) {
                  // Products repeat across categories; keep a known gender if a
                  // sectionless duplicate (e.g. TRAVEL) would overwrite it.
                  const prev = byId.get(rec.externalId);
                  if (rec.gender == null && prev?.gender != null) rec.gender = prev.gender;
                  byId.set(rec.externalId, rec);
                }
              }
            }
          }
        } catch {
          // skip a category that fails; keep going
        }
      }
    }),
  );

  // Sizes need a per-product call, so we cover a rotating (shuffled) subset each
  // run; captured sizes persist across runs (the upsert keeps prior variants),
  // so coverage accumulates. We work per colour GROUP: one call returns every
  // colour's sizes, which we attach to each sibling record — so once a group is
  // covered, switching colour on the PDP shows sizes for every colour.
  const records = [...byId.values()];
  const byExt = new Map(records.map((r) => [r.externalId, r]));
  const limit = Number(process.env.ZARA_DETAIL_LIMIT ?? 800);

  // One discounted representative per colour group (groups with no deal never
  // reach the feed, so we skip them).
  const reps = new Map<string, ProductRecord>();
  for (const r of records) {
    if (r.listPrice != null && r.groupKey && !reps.has(r.groupKey)) reps.set(r.groupKey, r);
  }
  const repList = [...reps.values()];
  for (let j = repList.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [repList[j], repList[k]] = [repList[k], repList[j]];
  }
  await pool(repList.slice(0, limit), 6, async (rep) => {
    const byColour = await fetchGroupSizes(rep.externalId);
    for (const [ext, v] of byColour) {
      const rec = byExt.get(ext);
      if (rec) rec.variants = v;
    }
  });

  return records;
}
