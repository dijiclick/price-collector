/**
 * boohoo group UK — boohoo.com, prettylittlething.com, karenmillen.com.
 *
 * All three run on the Debenhams Group platform (a Remix storefront), and all
 * three list products from Algolia with public search-only keys that sit in
 * the page bundle (one app per fascia). Each index also carries marketplace
 * brands, so the query is filtered to the house brand(s) and to
 * `discountPercentage > 0`. Hits list only the sizes IN stock (`sizesInStock`)
 * — the sold-out ones are not in the index at all.
 *
 * boohoo used to be read from Bloomreach Discovery (`core.dxpapi.com`, account
 * 7541), but the storefront switched it off (`enableBloomreachDiscovery:
 * false`) and that feed went stale: on 2026-10-21 only 3 of 20 sampled boohoo
 * rows carried the price the product page showed, and 6 of the 20 were sold
 * out on the page while Bloomreach still listed them in stock. The Algolia
 * index (`boohooww-dbz-prod`, the one the site queries) matched the page.
 *
 * boohoo shows a near-permanent "-60%": a row is kept only when its was-price
 * is strictly above the current price, nothing else is inferred.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export type BoohooGroupSlug = "boohoo" | "prettylittlething" | "karenmillen";

const PAUSE_MS = Number(process.env.BOOHOO_PAUSE_MS ?? 700);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface AlgoliaSite {
  site: string;
  appId: string;
  key: string;
  index: string;
  /** The house brand(s) as Algolia spells them; the index also sells other brands. */
  brandFacets: string[];
}

/** Public search-only keys from the storefront bundle (2026-10-11; boohoo 2026-10-21). */
export const BOOHOO_ALGOLIA: Record<BoohooGroupSlug, AlgoliaSite> = {
  boohoo: {
    // `enableAlgoliaAppSeparation` is off on boohoo.com, so it uses the shared prod app.
    site: "https://www.boohoo.com",
    appId: "HNC30IYYNP",
    key: "6e5de83d201b6bdaac45d449a9466a42",
    index: "boohooww-dbz-prod",
    brandFacets: ["boohoo", "DSGN Studio"],
  },
  prettylittlething: {
    site: "https://www.prettylittlething.com",
    appId: "PBL6WQH9VL",
    key: "aca5366ccc1a1abd3118258c97c7322f",
    index: "prettylittlething-dbz-prod",
    brandFacets: ["PrettyLittleThing"],
  },
  karenmillen: {
    site: "https://www.karenmillen.com",
    appId: "SYQZESK6ZL",
    key: "419d9334b83437ccffbc67e4636e9a01",
    index: "karenmillen-dbz-prod",
    brandFacets: ["KarenMillen"],
  },
};

function genderOf(g: unknown): ProductRecord["gender"] {
  const s = String(Array.isArray(g) ? g[0] : g ?? "").toLowerCase();
  if (s === "female") return "kadin";
  if (s === "male") return "erkek";
  if (/kid|child|girl|boy/.test(s)) return "cocuk";
  return null;
}

/** One Algolia hit → record. Pure. */
export function mapDbzHit(slug: BoohooGroupSlug, hit: any, country: CountryCode = "GB"): ProductRecord | null {
  const cfg = BOOHOO_ALGOLIA[slug];
  const price = Number(hit?.price);
  const was = Number(hit?.wasPrice);
  if (!hit?.objectID || !hit?.name || !hit?.slug || !Number.isFinite(price) || price <= 0) return null;
  const colour = String(hit.colour ?? "").trim();
  const cv = (hit.colourVariants ?? []).find((c: any) => String(c?.colour ?? "") === colour) ?? hit.colourVariants?.[0];
  const inSizes: string[] = (cv?.sizesInStock ?? hit.sizes ?? []).map((s: unknown) => String(s).trim()).filter(Boolean);
  const sizes: SizeVariant[] = [...new Set(inSizes)].map((label) => ({ label, availability: "in_stock" as const }));
  const imgs: string[] = (hit.images ?? []).filter((u: unknown) => typeof u === "string");
  const lead = imgs[0] ?? cv?.image ?? null;
  const url = `${cfg.site}/product/${hit.slug}${colour ? `?colour=${encodeURIComponent(colour)}` : ""}`;
  return {
    brand: slug,
    country,
    externalId: String(hit.objectID),
    name: String(hit.name).replace(/\s+/g, " ").trim(),
    url,
    imageUrl: lead,
    images: cleanGallery(imgs, lead),
    price: toMinor(price),
    listPrice: Number.isFinite(was) && was > price ? toMinor(was) : null,
    currency: COUNTRIES[country].currency,
    inStock: hit.isOnStock !== false && (sizes.length > 0 || hit.isOnStock === true),
    category: hit.styleTaxonomy ?? hit.categoryTaxonomy ?? null,
    gender: genderOf(hit.gender),
    variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: hit.productKey ? `${slug}:${hit.productKey}` : null,
    colorName: colour || null,
  };
}

/**
 * Discount bands, deepest first. Some indexes cap pagination at 1,000 hits
 * (Karen Millen's does: 5,088 matches, `nbPages` 1), so one query cannot reach
 * the cap — each band is its own query and pages on its own.
 */
const DISCOUNT_BANDS = ["discountPercentage >= 60", "discountPercentage:40 TO 59", "discountPercentage:1 TO 39"];

async function listAlgolia(slug: BoohooGroupSlug, country: CountryCode, cap: number): Promise<ProductRecord[]> {
  const cfg = BOOHOO_ALGOLIA[slug];
  const hitsPerPage = 1000;
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const band of DISCOUNT_BANDS) {
    for (let page = 0; page < 5 && byId.size < cap; page++) {
      if (calls++ > 0) await sleep(PAUSE_MS);
      const data = await getJson<any>(`https://${cfg.appId}-dsn.algolia.net/1/indexes/${cfg.index}/query`, {
        method: "POST",
        country,
        headers: { "X-Algolia-Application-Id": cfg.appId, "X-Algolia-API-Key": cfg.key, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "",
          page,
          hitsPerPage,
          filters: `(${cfg.brandFacets.map((b) => `brand:"${b}"`).join(" OR ")}) AND ${band}`,
          attributesToRetrieve: [
            "objectID", "name", "slug", "price", "wasPrice", "colour", "colourVariants", "sizes", "images",
            "isOnStock", "gender", "styleTaxonomy", "categoryTaxonomy", "productKey",
          ],
          attributesToHighlight: [],
        }),
      });
      const hits: any[] = data?.hits ?? [];
      for (const h of hits) {
        const r = mapDbzHit(slug, h, country);
        if (r && r.listPrice != null) byId.set(r.externalId, r);
      }
      if (hits.length < hitsPerPage || page + 1 >= (data?.nbPages ?? 0)) break;
    }
    if (byId.size >= cap) break;
  }
  return [...byId.values()];
}

/** Register as `listBoohooGroup("boohoo" | "prettylittlething" | "karenmillen", country)`. GB only. */
export async function listBoohooGroup(slug: BoohooGroupSlug, country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "GB") return [];
  const cap = 1500;
  const all = await listAlgolia(slug, country, cap);
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
}
