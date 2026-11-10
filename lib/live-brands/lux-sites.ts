/**
 * Luxury multi-brand and luxury off-price stores that run on Shopify with
 * Markets: ONE shop, one Storefront API, a price per country (2026-11-10).
 * Shared by the collector (packages/collector/src/brands/_luxstorefront.ts)
 * and the pasted-link resolver (./lux-storefront.ts).
 *
 * Every host answers the Storefront GraphQL API TOKENLESS on its own domain
 * (`https://<host>/api/2025-01/graphql.json`), from a GitHub runner too
 * (probe runs 42797853656 and the later ones named in the adapter). `@inContext(country:)`
 * prices in that market's currency; `markets` lists only the countries whose
 * `localization.availableCountries` currency IS our market's currency (a
 * country the shop prices in USD/EUR instead is left out, and the mapper drops
 * any row in a foreign currency anyway).
 *
 * NO PLATFORM IMPORTS (the app imports lib/): pure data and pure functions.
 */
import type { CountryCode } from "../countries";

export type LuxGender = "kadin" | "erkek" | "cocuk" | null;

export interface LuxWalk {
  /** Sale collection handle. */
  handle: string;
  /** What the collection itself says about every row in it. */
  gender: LuxGender;
  /** Rows to take from this collection (in-stock, reduced). */
  max: number;
}

export interface LuxSite {
  brand: string;
  /** Storefront API host (the shop's own domain). */
  host: string;
  /** Public product-page host, when `onlineStoreUrl` names another one. */
  siteHost?: string;
  /** Other hosts a pasted link may be on. */
  aliases?: string[];
  markets: CountryCode[];
  walks: (country: CountryCode) => LuxWalk[];
  /** Shop-specific tags that override the collection's gender. */
  tagGender?: (tags: string[], fallback: LuxGender) => LuxGender;
  /** Shop-specific category when `productType` is not one. */
  category?: (productType: string, tags: string[]) => string | null;
  /** Rows per market. */
  cap?: number;
}

const EURO: CountryCode[] = ["DE", "FR", "IT", "ES", "NL", "BE", "AT", "IE", "PT", "FI"];
const two = (women: string, men: string, w = 1000, m = 350): LuxWalk[] => [
  { handle: women, gender: "kadin", max: w },
  { handle: men, gender: "erkek", max: m },
];

/** Antonioli keeps one sale collection per price list: `sale-<region>-woman|man`. */
const ANTONIOLI_REGION: Partial<Record<CountryCode, string>> = {
  US: "us", CA: "ca", GB: "uk", DE: "de", FR: "fr", IT: "it", ES: "es", CH: "ch", AU: "au", JP: "jp", HK: "hk",
  NL: "eu", BE: "eu", AT: "eu", IE: "eu", PT: "eu", FI: "eu",
};

/** TheDoubleF's product types are its Italian department names. */
const DOUBLEF_TYPE: Record<string, string> = {
  ABBIGLIAMENTO: "clothing", CALZATURE: "shoes", BORSE: "bags", "ACCESSORI VARI": "accessories",
  "ACCESSORI ABBIGLIAMENTO": "accessories", GIOIELLI: "jewellery", MINUTERIA: "small leather goods",
};

export const LUX_SITES: LuxSite[] = [
  // THE OUTNET — luxury off-price (ex-YNAP, on Shopify Hydrogen since 2026). Every
  // product carries the designer's original price as compare-at; `sale` is its
  // "up to 70% off" clearance (women), `mens-list-up-to-70-off` the men's.
  {
    brand: "theoutnet",
    host: "theoutnet.com",
    siteHost: "www.theoutnet.com",
    aliases: ["checkout.theoutnet.com"],
    markets: ["US", "GB", ...EURO, "CH", "AU", "AE", "SA", "JP", "KR", "SG", "HK"],
    walks: () => two("sale", "mens-list-up-to-70-off"),
  },
  // Browns (London). Markdown collections; 3–4% of the catalogue is reduced.
  {
    brand: "brownsfashion",
    host: "brownsfashion.com",
    markets: ["GB", "US", "CA", ...EURO, "CH", "SE", "DK", "AU", "AE", "SA", "QA", "JP", "KR", "SG", "HK"],
    walks: () => two("sale-woman", "sale-man"),
    tagGender: (tags, fb) => {
      const w = tags.includes("Women"), m = tags.includes("Men");
      return w && !m ? "kadin" : m && !w ? "erkek" : fb;
    },
  },
  // END. (Newcastle) — sneakers/streetwear/designer. Unisex rows sit in both sales.
  {
    brand: "endclothing",
    host: "www.endclothing.com",
    markets: ["GB", "US", "CA", ...EURO, "AU", "JP", "HK"],
    walks: () => two("womens-sale", "mens-sale", 700, 600),
    tagGender: (tags, fb) => {
      const w = tags.includes("gender:Womens"), m = tags.includes("gender:Mens");
      return w && !m ? "kadin" : m && !w ? "erkek" : w && m ? null : fb;
    },
    category: (type, tags) => type || tags.find((t) => t.startsWith("cat_low:"))?.slice(8) || null,
  },
  // Julian Fashion (Italy). One sale list per region: Italy, Asia, world.
  {
    brand: "julian-fashion",
    host: "www.julian-fashion.com",
    markets: ["US", "CA", "GB", ...EURO, "CH", "AU", "JP", "KR", "HK"],
    walks: (c) =>
      c === "IT" ? two("sale-women-it", "sale-men-it")
      : c === "JP" || c === "KR" || c === "HK" ? two("women-sales-asia", "men-sales-asia")
      : two("women-sale-mondo", "men-sale-mondo"),
  },
  // Antonioli (Milan).
  {
    brand: "antonioli",
    host: "antonioli.eu",
    markets: ["US", "CA", "GB", ...EURO, "CH", "AU", "JP", "HK"],
    walks: (c) => {
      const r = ANTONIOLI_REGION[c];
      return r ? two(`sale-${r}-woman`, `sale-${r}-man`, 700, 500) : [];
    },
    category: (type) => (type ? type.toLowerCase() : null),
  },
  // TheDoubleF (Mantua). Italy and France have their own sale list; the rest share the "ROW" one.
  {
    brand: "thedoublef",
    host: "www.thedoublef.com",
    markets: ["US", "CA", "GB", ...EURO, "CH", "SE", "DK", "NO", "AU", "AE", "SA", "QA", "JP", "KR", "SG", "HK"],
    walks: (c) => (c === "IT" || c === "FR" ? two("sale-it-fr-woman", "sale-it-fr-man") : two("sale-woman", "sale-man")),
    category: (type) => DOUBLEF_TYPE[type.toUpperCase()] ?? (type ? type.toLowerCase() : null),
  },
  // Slam Jam (Ferrara) — streetwear/designer. Unisex rows sit in both sales.
  {
    brand: "slamjam",
    host: "www.slamjam.com",
    siteHost: "slamjam.com",
    markets: ["US", "CA", "GB", ...EURO, "CH", "AU", "JP", "KR", "HK"],
    walks: () => two("sale-women", "sale-men", 700, 600),
    tagGender: (tags, fb) => {
      const w = tags.includes("filter-gender_Women"), m = tags.includes("filter-gender_Men");
      return w && !m ? "kadin" : m && !w ? "erkek" : w && m ? null : fb;
    },
  },
  // The Webster (Miami) — US only.
  {
    brand: "thewebster",
    host: "thewebster.com",
    markets: ["US"],
    walks: () => two("on-sale-women", "on-sale-men"),
    // productType is a migration artefact ("Migration_Size").
    category: (_type, tags) => tags.find((t) => t.startsWith("product_type_merchandise:"))?.slice(25) || null,
  },
];

export const luxSite = (brand: string): LuxSite | undefined => LUX_SITES.find((s) => s.brand === brand);

const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");

/** The public product url: the API's own `onlineStoreUrl` (it carries the market's path), on the public host. */
export function luxProductUrl(site: LuxSite, onlineStoreUrl: unknown, handle: string): string {
  const host = site.siteHost ?? site.host;
  if (typeof onlineStoreUrl === "string" && onlineStoreUrl.startsWith("https://")) {
    try {
      const u = new URL(onlineStoreUrl);
      u.hostname = host;
      u.search = "";
      return u.toString();
    } catch { /* fall through */ }
  }
  return `https://${host}/products/${handle}`;
}

/**
 * The store, handle and market a pasted link points at, or null. The market is
 * the url's `/en-<cc>/` prefix when the shop sells there in our currency; else
 * the shop's first (home) market.
 */
export function luxTarget(url: string): { site: LuxSite; handle: string; country: CountryCode } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = bare(u.hostname);
  const site = LUX_SITES.find((s) => [s.host, s.siteHost, ...(s.aliases ?? [])].some((h) => h && bare(h) === host));
  if (!site) return null;
  const m = u.pathname.match(/^(?:\/([a-z]{2})-([a-z]{2}))?\/products\/([^/?#]+?)\/?$/i);
  if (!m) return null;
  // `/en-eu/` (END., Julian Fashion) is the shop's one euro price list: quote it as Germany.
  const raw = m[2]?.toUpperCase();
  const cc = (raw === "EU" ? "DE" : raw) as CountryCode | undefined;
  return { site, handle: decodeURIComponent(m[3]), country: cc && site.markets.includes(cc) ? cc : site.markets[0] };
}
