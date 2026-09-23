import type { ProductRecord, ProductVariants, Availability } from "../types";
import { getJson } from "../http";
import { currencyFor, type CountryCode } from "../../../../lib/countries";

/**
 * Storefront path per market: `{cc}/{lang}`. Turkey stays `tr/tr` (Turkish
 * names and slugs, live in production); every other market is its English
 * storefront, the language `lib/productTypes.ts` can classify.
 *
 * GB is `uk`, not `gb` — which is why this is a table and not derived from the
 * country code. Every entry answered `/categories?ajax=true` with 200 via Node
 * fetch on 2026-09-23 (curl is useless here: Akamai keys on TLS fingerprint).
 */
export const ZARA_PATHS: Partial<Record<CountryCode, string>> = {
  TR: "tr/tr",
  AE: "ae/en",
  SA: "sa/en",
  GB: "uk/en",
  US: "us/en",
  CA: "ca/en",
  AU: "au/en",
  IE: "ie/en",
  DE: "de/en",
  FR: "fr/en",
  NL: "nl/en",
  BE: "be/en",
  AT: "at/en",
  ES: "es/en",
  IT: "it/en",
  PT: "pt/en",
  FI: "fi/en",
  CH: "ch/en",
  SE: "se/en",
  DK: "dk/en",
  NO: "no/en",
};

/** `https://www.zara.com/{path}` for a market. Throws for a market with no
 *  storefront entry rather than silently collecting Turkey under its name. */
export function zaraBase(country: CountryCode): string {
  const path = ZARA_PATHS[country];
  if (!path) throw new Error(`zara: no storefront path for ${country}`);
  return `https://www.zara.com/${path}`;
}

interface ZaraCategory {
  id: number;
  name?: string;
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

/**
 * Top-level sections that are not Zara's own catalogue. zara.com/us and /ca
 * carry a whole MASSIMO DUTTI section (~5.6k products, same names, prices and
 * references as massimodutti.com) — collected under "zara" they duplicated
 * Massimo Dutti in the feed and put its products behind Zara's logo. PRE-OWNED
 * is resale, priced per item, not a discount on anything. Seen 2026-09-23.
 */
const FOREIGN_SECTION = /massimo|dutti|pre-?owned/i;
export function ownSections(cats: ZaraCategory[]): ZaraCategory[] {
  return cats.filter((c) => !FOREIGN_SECTION.test(c.name ?? ""));
}

/** Zara listing availability -> orderable? Unknown values default to in stock. */
function buyable(availability: any): boolean {
  const a = String(availability ?? "").toLowerCase();
  if (!a) return true;
  return a === "in_stock" || a === "low_on_stock";
}

export function mapComponent(
  c: any,
  gender: Gender = null,
  country: CountryCode = "TR",
): ProductRecord | null {
  if (!c?.id || !c?.seo?.keyword || !c?.seo?.seoProductId) return null;
  // Another brand's product sold on zara.com (see ownSections) — not Zara's.
  const group = c?.brand?.brandGroupCode;
  if (group && group !== "zara") return null;
  const color = c.detail?.colors?.[0] ?? {};
  const price: number | undefined = color.price ?? c.price;
  if (typeof price !== "number" || price <= 0) return null;
  const xmedia = color.xmedia?.[0];
  const imageUrl = xmedia?.url ? String(xmedia.url).replace("{width}", "750") : null;
  return {
    brand: "zara",
    country,
    externalId: String(c.id),
    name: c.name ?? "",
    url: `${zaraBase(country)}/${c.seo.keyword}-p${c.seo.seoProductId}.html?v1=${c.id}`,
    imageUrl,
    // Integer minor units in every market (59000 = 590,00 ₺, 2799 = £27.99,
    // 37900 = 379 kr, 5990 = CHF 59.90). The listing carries no currency code,
    // so it comes from the country table.
    price,
    listPrice: typeof color.oldPrice === "number" ? color.oldPrice : null,
    currency: currencyFor(country),
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
 * (`color.productId`, which equals a sibling record's externalId). One product
 * page covers every colour, so a single request serves the whole colour group —
 * that's what lets switching colour on the PDP show sizes, not just the one
 * colour we happened to query. Category listings carry no sizes, so this
 * per-group call is unavoidable.
 *
 * From the product page's JSON, NOT /products-details: on 2026-09-23 that
 * endpoint answered 403 in every market (Turkey too) while the page JSON, same
 * `detail.colors[].sizes` shape, still answered.
 */
export function sizesByColour(pdp: any): Map<string, ProductVariants> {
  const out = new Map<string, ProductVariants>();
  for (const color of pdp?.product?.detail?.colors ?? []) {
    const ext = String(color?.productId ?? "");
    if (!ext) continue;
    const sizes = (color?.sizes ?? [])
      .map((s: any) => ({ label: String(s?.name ?? "").trim(), sku: Number(s?.sku), availability: normAvail(s?.availability) }))
      .filter((s: any) => s.label && Number.isFinite(s.sku));
    if (sizes.length) out.set(ext, { colors: color?.name ? [color.name] : [], sizes });
  }
  return out;
}

export const pdpDetailUrl = (productUrl: string): string =>
  productUrl + (productUrl.includes("?") ? "&" : "?") + "ajax=true";

async function fetchGroupSizes(rec: ProductRecord, country: CountryCode): Promise<Map<string, ProductVariants> | null> {
  try {
    return sizesByColour(await getJson<any>(pdpDetailUrl(rec.url), { retries: 1, country }));
  } catch {
    return null; // counted by the caller — see the all-failed check below
  }
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

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  const base = zaraBase(country);
  // 0 = the whole tree. This was 25, applied to the raw (duplicate-laden) id
  // list, so at most 25 of 1345 unique leaf categories were ever visited — under
  // 2% of the tree, which is why Zara reported ~2900 products against a catalog
  // of ~20000. There is no per-category pagination to worry about: a category
  // request returns all of its products at once, so the slice was the only
  // truncation.
  const maxCategories = Number(process.env.ZARA_MAX_CATEGORIES ?? 0);
  const tree = await getJson<{ categories: ZaraCategory[] }>(`${base}/categories?ajax=true`, { country });
  const genderByCat = leafSections(ownSections(tree.categories ?? []));
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
          const data = await getJson<any>(`${base}/category/${catId}/products?ajax=true`, { country });
          for (const group of data.productGroups ?? []) {
            for (const el of group.elements ?? []) {
              for (const comp of el.commercialComponents ?? []) {
                const rec = mapComponent(comp, genderByCat.get(catId) ?? null, country);
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
  const batch = repList.slice(0, limit);
  let sizeFailures = 0;
  await pool(batch, 6, async (rep) => {
    const byColour = await fetchGroupSizes(rep, country);
    if (!byColour) {
      sizeFailures++;
      return;
    }
    for (const [ext, v] of byColour) {
      const rec = byExt.get(ext);
      if (rec) rec.variants = v;
    }
  });
  // The size pass used to swallow every error, so a blocked endpoint looked
  // exactly like "nothing changed" — for how long, nobody could say. Prices
  // still ship (they are the product), but the log says what broke.
  if (batch.length > 0 && sizeFailures > batch.length / 2) {
    console.warn(`zara/${country}: size lookup failed for ${sizeFailures}/${batch.length} products`);
  }

  return records;
}
