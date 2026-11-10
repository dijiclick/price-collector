/**
 * Frasers Group "new platform" stores — USC (usc.co.uk) and Cruise
 * (cruisefashion.com), GBP. Added 2026-11-10.
 *
 * Both are Next.js storefronts that list products straight from Algolia with a
 * public search-only key that sits in the page bundle (`NEXT_PUBLIC_ALGOLIA_ID`
 * / `_KEY`, one app per store, index `<storeKey>_production_search`). The
 * sites themselves sit behind Cloudflare, which rate-limits a runner after a
 * dozen requests; Algolia has no wall (probe run 42798407673).
 *
 * Flannels, House of Fraser, Sports Direct, Jack Wills and frasers.com are
 * still on the old platform and answer neither a runner nor a home line
 * (timeout on every path, same run) — not addable.
 *
 * What a row is: one colourway (`objectID` = the 8-digit colour code) with
 * `prices.GBP.{sellingPrice,ticketPrice}` and one entry in `sizeVariants` per
 * size the store can sell. `ticketPrice` is the RRP the site strikes through
 * ("RRP £1,875"). For a third-party label (Boss, Off-White, Levi's) that is the
 * maker's own price; for the group's house labels (Jack Wills, Firetrap,
 * SoulCal — `brandtype: "Group"`) it is a figure nobody charged, so those rows
 * are dropped. Share of the catalogue below RRP: USC 88%, Cruise 73% — these
 * are off-price stores, like Nordstrom Rack.
 *
 * Sizes can be priced differently (169 of 3,000 sampled rows). The row keeps
 * the HIGHEST size price against the ticket, so a single cheap leftover size
 * never invents a deeper discount (the −%81 variant-range trap).
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export type FrasersSlug = "usc" | "cruise";

interface FrasersSite {
  site: string;
  appId: string;
  key: string;
  /** Sorted replica (deepest discount first) when the app has one, else the search index in bands. */
  index: string;
  /** Rows per gender, in fill order. */
  quotas: [gender: string, cap: number][];
}

/** Public search-only keys from each storefront's bundle (2026-11-10). */
export const FRASERS_SITES: Record<FrasersSlug, FrasersSite> = {
  usc: {
    site: "https://www.usc.co.uk", appId: "AF4UUIODJ5", key: "66f33a38518bd4917cc5a7773e80ad54",
    index: "usc_production_search",
    quotas: [["Womens", 1400], ["Unisex Adults", 150], ["Mens", 700]],
  },
  cruise: {
    site: "https://www.cruisefashion.com", appId: "8G8K75SM1B", key: "4491ee4fdd6b26e195879b2178ffef46",
    index: "crus_production_search",
    quotas: [["Womens", 1700], ["Unisex Adults", 150], ["Mens", 650]],
  },
};

/** The storefront's own listing filter (`storeConfig.algolia.productsFilter`). */
const BASE = "isHidden:false AND hasInventory:true AND hideFromSearch:false AND hasDefaultPrice:true";
/** Deepest first; each band pages on its own so one gender never exhausts the 20,000-hit window. */
const BANDS = ["prices.GBP.discountPercentage >= 50", "prices.GBP.discountPercentage:30 TO 49.99", "prices.GBP.discountPercentage:10 TO 29.99"];
const HITS = 500;
const PAUSE_MS = Number(process.env.FRASERS_PAUSE_MS ?? 600);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const en = (v: any): string => {
  const x = v && typeof v === "object" ? v["en-GB"] : v;
  return String((Array.isArray(x) ? x[0] : x) ?? "").trim();
};

function genderOf(g: string): ProductRecord["gender"] {
  if (/^womens?$/i.test(g)) return "kadin";
  if (/^mens?$/i.test(g)) return "erkek";
  if (/boys|girls|kids|baby|infant/i.test(g)) return "cocuk";
  return null;
}

/** One Algolia hit → record, or null when it is not a clean third-party markdown. Pure. */
export function mapFrasersHit(slug: FrasersSlug, hit: any, country: CountryCode = "GB"): ProductRecord | null {
  const cfg = FRASERS_SITES[slug];
  const code = String(hit?.objectID ?? hit?.colourCode ?? "").trim();
  const title = en(hit?.name);
  const link = String(hit?.productLink ?? "").trim();
  if (!code || !title || !link) return null;
  if (en(hit.brandtype) !== "3rd Party") return null;
  const variants: any[] = Array.isArray(hit.sizeVariants) ? hit.sizeVariants : [];
  const priced = variants.map((v) => v?.prices?.GBP).filter((p) => Number(p?.sellingPrice) > 0);
  const top = hit?.prices?.GBP;
  const price = priced.length ? Math.max(...priced.map((p) => Number(p.sellingPrice))) : Number(top?.sellingPrice);
  const was = priced.length ? Math.max(...priced.map((p) => Number(p.ticketPrice) || 0)) : Number(top?.ticketPrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  const maker = String(hit.brand ?? "").trim() || en(hit.webbrand) || null;
  const seen = new Set<string>();
  const sizes: SizeVariant[] = [];
  for (const v of variants) {
    const label = en(v?.description);
    if (!label || /^(one size|n\/?a|-)$/i.test(label) || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: "in_stock" });
  }
  const colour = en(hit.colourName);
  const lead = `https://cdn.media.amplience.net/i/frasersdev/${code}_o?fmt=auto&w=900`;
  const alts: string[] = (Array.isArray(hit.alternativeImages) ? hit.alternativeImages : [])
    .filter((u: unknown): u is string => typeof u === "string" && !/_o\.jpg/.test(u))
    .map((u: string) => `${u.split("?")[0].replace(/\.jpg$/, "")}?fmt=auto&w=900`);
  return {
    brand: slug,
    country,
    externalId: code,
    name: maker && !title.toLowerCase().startsWith(maker.toLowerCase()) ? `${maker} ${title}` : title,
    url: `${cfg.site}/${link}`,
    imageUrl: lead,
    images: cleanGallery(alts, lead),
    price: toMinor(price),
    listPrice: Number.isFinite(was) && was > price ? toMinor(was) : null,
    currency: COUNTRIES[country].currency,
    inStock: hit.hasInventory !== false,
    category: en(hit.webcat) || en(hit.category) || null,
    maker,
    gender: genderOf(en(hit.webgender)),
    variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
    // The index only lists sizes the store holds; a size missing next run sold out.
    sizesInStockOnly: sizes.length > 0,
    groupKey: hit.styleCode ? `${slug}:${hit.styleCode}` : null,
    colorName: colour || null,
  };
}

const ATTRS = [
  "objectID", "name", "brand", "webbrand", "brandtype", "productLink", "prices", "sizeVariants", "colourName",
  "alternativeImages", "hasInventory", "webcat", "category", "webgender", "styleCode",
];

/** Register as `listFrasers("usc" | "cruise", country)`. GB only. */
export async function listFrasers(slug: FrasersSlug, country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "GB") return [];
  const cfg = FRASERS_SITES[slug];
  const out: ProductRecord[] = [];
  const ids = new Set<string>();
  let calls = 0;
  for (const [gender, cap] of cfg.quotas) {
    let taken = 0;
    bands: for (const band of BANDS) {
      for (let page = 0; page < 6; page++) {
        if (calls++ > 0) await sleep(PAUSE_MS);
        const data = await getJson<any>(`https://${cfg.appId}-dsn.algolia.net/1/indexes/${cfg.index}/query`, {
          method: "POST",
          country,
          headers: { "X-Algolia-Application-Id": cfg.appId, "X-Algolia-API-Key": cfg.key, "Content-Type": "application/json" },
          body: JSON.stringify({
            query: "", page, hitsPerPage: HITS,
            filters: `${BASE} AND ${band} AND webgender.en-GB:"${gender}"`,
            attributesToRetrieve: ATTRS, attributesToHighlight: [],
          }),
        });
        const hits: any[] = data?.hits ?? [];
        for (const h of hits) {
          const r = mapFrasersHit(slug, h, country);
          if (!r || r.listPrice == null || ids.has(r.externalId)) continue;
          ids.add(r.externalId);
          out.push(r);
          if (++taken >= cap) break bands;
        }
        if (hits.length < HITS || page + 1 >= (data?.nbPages ?? 0)) break;
      }
    }
  }
  if (!out.length) throw new Error(`${slug}: Algolia returned no reduced rows`);
  return out;
}
