import type { ProductRecord, SizeVariant, Availability } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";

const APP_ID = "YML5RK21LG";
const API_KEY = "769a17c8b936f70b64ab0c62f3fdf12e";
const INDEX = "production__products__tr_TR";
const URL = `https://${APP_ID}-dsn.algolia.net/1/indexes/${INDEX}/query`;

/**
 * The Algolia index carries no image field at all — `image_link`/`imageLink`
 * were never present, so every Guess row has been stored imageless. The
 * storefront builds its images from the objectID ("{style}-{COLOR}") against a
 * Cloudinary transform, which resolves for every product sampled.
 */
export function imageUrl(objectID: string): string {
  return (
    "https://img.guess.com/image/upload/f_auto,q_auto,fl_strip_profile," +
    `w_640,ar_2:3,c_fill/v1/EU/Style/ECOMM/${objectID}`
  );
}

/**
 * `guess_gender` is the index's own section facet (the same one the crawl
 * splits its buckets on). Values observed live: Women 4694, Men 1989,
 * Junior Girls 382, Junior Boys 265, Unisex 133, plus stray non-English
 * labels (Bambina/Bambino = IT kids, Kvinner = NO women). Unknowns stay null.
 */
export function mapGender(value: unknown): ProductRecord["gender"] {
  const v = String(value ?? "").trim().toLowerCase();
  if (v.includes("junior") || v.startsWith("bambin")) return "cocuk";
  if (v === "women" || v === "kvinner") return "kadin";
  if (v === "men") return "erkek";
  return null;
}

function mapHit(h: any): ProductRecord | null {
  const id = String(h.objectID ?? "");
  if (!id || id.startsWith("ENSEMBLE-")) return null; // skip "shop the look" bundles
  const price = h.master_price;
  if (typeof price !== "number" || price <= 0) return null;
  const retail = typeof h.master_price_retail === "number" ? h.master_price_retail : null;
  // Colours of one style share a baseProductID (objectID = "{base}-{COLOR}").
  const base = h.baseProductID ? String(h.baseProductID) : null;
  // Per-size stock is embedded in the hit: variants[] carries each size with its
  // own in_stock flag and ATS (available-to-sell qty). "T/U" = one-size
  // (bags/accessories) — not a real size grid, so drop it.
  const sizes: SizeVariant[] = (Array.isArray(h.variants) ? h.variants : [])
    .map((v: any) => {
      const label = String(v?.size ?? "").trim();
      const ats = Number(v?.ATS);
      const availability: Availability = !v?.in_stock
        ? "out_of_stock"
        : Number.isFinite(ats) && ats > 0 && ats <= 2
        ? "low_on_stock"
        : "in_stock";
      return { label, availability };
    })
    .filter((s: SizeVariant) => s.label && s.label.toUpperCase() !== "T/U");
  return {
    brand: "guess",
    externalId: id,
    name: h.name ?? "",
    url: h.url ? `https://www.guess.eu${h.url}` : `https://www.guess.eu/tr-tr/`,
    imageUrl: imageUrl(id),
    price: toMinor(price),
    listPrice: retail && retail > price ? toMinor(retail) : null,
    currency: "TRY",
    inStock: h.in_stock !== false,
    gender: mapGender(h.guess_gender),
    groupKey: base ? "guess:" + base : null,
    colorName: h.guess_colorDisplayName ?? h.color ?? null,
    variants: sizes.length > 0 ? { colors: [], sizes } : null,
  };
}

export const brand = "guess";

/**
 * Algolia's `paginationLimitedTo` caps this index at 5000 reachable hits per
 * query — page 5 answers with an error rather than hits, and `nbPages` doesn't
 * advertise the ceiling. A single unfiltered crawl therefore stopped at 5000 of
 * 7803 products while looking like it had paged to the end.
 *
 * Splitting the query into facet buckets keeps every bucket under the cap. The
 * facet values are read at runtime rather than hardcoded so the split follows
 * the catalog, and any bucket that still reaches the cap is split again by
 * brand line.
 */
const PAGE_CAP = 5000;
const SPLIT_FACET = "guess_gender";
const SUBSPLIT_FACET = "__primary_category.0";

function search(params: string): Promise<any> {
  return getJson<any>(URL, {
    method: "POST",
    headers: {
      "X-Algolia-Application-Id": APP_ID,
      "X-Algolia-API-Key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ params }),
  });
}

const withFilters = (filters: string[][], extra = "") =>
  `query=&${extra}facetFilters=${encodeURIComponent(JSON.stringify(filters))}`;

/** Page one bucket to exhaustion, mapping hits into `byId`. */
async function drain(filters: string[][], byId: Map<string, ProductRecord>): Promise<void> {
  let page = 0;
  let nbPages = 1;
  do {
    const res = await search(withFilters(filters, `hitsPerPage=1000&page=${page}&`));
    for (const h of res.hits ?? []) {
      const rec = mapHit(h);
      if (rec) byId.set(rec.externalId, rec);
    }
    nbPages = res.nbPages ?? 1;
    page++;
  } while (page < nbPages);
}

export async function listProducts(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  const head = await search(
    `query=&hitsPerPage=0&facets=${encodeURIComponent(JSON.stringify([SPLIT_FACET]))}`,
  );
  const values = Object.keys(head.facets?.[SPLIT_FACET] ?? {});

  for (const value of values) {
    const filters = [[`${SPLIT_FACET}:${value}`]];
    const probe = await search(
      withFilters(filters, `hitsPerPage=0&facets=${encodeURIComponent(JSON.stringify([SUBSPLIT_FACET]))}&`),
    );
    if ((probe.nbHits ?? 0) < PAGE_CAP) {
      await drain(filters, byId);
      continue;
    }
    // Bucket is itself unreachable past 5000 — split it once more.
    for (const sub of Object.keys(probe.facets?.[SUBSPLIT_FACET] ?? {})) {
      await drain([...filters, [`${SUBSPLIT_FACET}:${sub}`]], byId);
    }
  }

  // Products carrying none of the facet values are invisible to every bucket
  // above, so sweep them up by excluding all of them at once.
  if (values.length > 0) {
    await drain(values.map((v) => [`${SPLIT_FACET}:-${v}`]), byId);
  }
  return [...byId.values()];
}
