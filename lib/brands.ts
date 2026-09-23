import { ALL_COUNTRIES, type CountryCode } from "./countries";

/** Brand catalog for onboarding, rail and filters. Order = display order. */
export interface BrandInfo {
  slug: string;
  label: string;
  category: string;
  /** Official logo asset under /public (Wikimedia Commons, PD-textlogo). */
  logo: string;
  /**
   * Which countries this brand can actually be collected in.
   *
   * Not "where the brand has shops" — where an endpoint answered with that
   * country's prices (verified 2026-09-20, see the plan's §1.9 matrix). A brand
   * listed for a country it cannot serve is a brand name over an empty feed,
   * which reads as a broken app rather than a missing market.
   */
  countries: CountryCode[];
}

/** Turkish retailers with no other storefront. */
const TR_ONLY: CountryCode[] = ["TR"];
/**
 * Every market. The six Inditex brands plus Mango: itxrest answers per store
 * id for all of them, and Mango's orchestrator takes `countryIso`.
 */
const EVERYWHERE: CountryCode[] = [...ALL_COUNTRIES];
/**
 * Everywhere but the Gulf. H&M's `api.hm.com` answers 422 "validlocale" for
 * `en_ae`/`en_sa` — Gulf H&M is Alshaya's own platform on `ae.hm.com`
 * (verified 2026-09-20). Every other market answered 200 on 2026-09-23.
 */
const HM: CountryCode[] = ALL_COUNTRIES.filter((c) => c !== "AE" && c !== "SA");
/**
 * Turkey, Britain and Europe. Guess's Algolia has no `en_US`, `en_CA`,
 * `en_AU`, `en_AE` or `en_SA` index (404) — those storefronts are other
 * platforms. Verified 2026-09-20 and 2026-09-23.
 */
const GUESS: CountryCode[] = ALL_COUNTRIES.filter(
  (c) => !["US", "CA", "AU", "AE", "SA"].includes(c),
);

export const BRANDS: BrandInfo[] = [
  { slug: "zara", label: "ZARA", category: "Giyim", logo: "/brands/zara.svg", countries: EVERYWHERE },
  { slug: "mango", label: "MANGO", category: "Giyim", logo: "/brands/mango.svg", countries: EVERYWHERE },
  { slug: "hm", label: "H&M", category: "Giyim", logo: "/brands/hm.svg", countries: HM },
  { slug: "bershka", label: "BERSHKA", category: "Giyim", logo: "/brands/bershka.svg", countries: EVERYWHERE },
  { slug: "stradivarius", label: "Stradivarius", category: "Giyim", logo: "/brands/stradivarius.svg", countries: EVERYWHERE },
  { slug: "pullandbear", label: "PULL&BEAR", category: "Giyim", logo: "/brands/pullandbear.svg", countries: EVERYWHERE },
  { slug: "massimodutti", label: "Massimo Dutti", category: "Giyim", logo: "/brands/massimodutti.svg", countries: EVERYWHERE },
  { slug: "koton", label: "KOTON", category: "Giyim", logo: "/brands/koton.svg", countries: TR_ONLY },
  { slug: "guess", label: "GUESS", category: "Giyim", logo: "/brands/guess.svg", countries: GUESS },
  { slug: "penti", label: "penti", category: "İç giyim", logo: "/brands/penti.png", countries: TR_ONLY },
  { slug: "oysho", label: "OYSHO", category: "İç giyim", logo: "/brands/oysho.svg", countries: EVERYWHERE },
  { slug: "sephora", label: "SEPHORA", category: "Kozmetik", logo: "/brands/sephora.svg", countries: TR_ONLY },
  { slug: "gratis", label: "gratis", category: "Kozmetik", logo: "/brands/gratis.svg", countries: TR_ONLY },
  { slug: "rossmann", label: "ROSSMANN", category: "Kozmetik", logo: "/brands/rossmann.svg", countries: TR_ONLY },
  { slug: "watsons", label: "Watsons", category: "Kişisel bakım", logo: "/brands/watsons.svg", countries: TR_ONLY },
  // Non-TR Pandora storefronts are a DIFFERENT Salesforce org behind Cloudflare
  // (uk/us/de… .pandora.net answered 403 from this Mac for both the token
  // endpoint and the homepage), so it stays Turkish until someone reads a
  // non-TR storefront's commerceAPI block from a browser session.
  { slug: "pandora", label: "PANDORA", category: "Takı", logo: "/brands/pandora.svg", countries: TR_ONLY },
  { slug: "boyner", label: "Boyner", category: "Çok markalı", logo: "/brands/boyner.svg", countries: TR_ONLY },
  { slug: "beymen", label: "Beymen", category: "Çok markalı", logo: "/brands/beymen.svg", countries: TR_ONLY },
];

export const BRAND_SLUGS = BRANDS.map((b) => b.slug);
export const brandInfo = (slug: string) => BRANDS.find((b) => b.slug === slug);

/**
 * The brands worth showing in a country, in display order.
 *
 * Order is preserved rather than recomputed so the brand rail does not reshuffle
 * when someone switches country — the same brands stay in the same places, and
 * only the unavailable ones disappear.
 */
export const brandsFor = (country: CountryCode): string[] =>
  BRANDS.filter((b) => b.countries.includes(country)).map((b) => b.slug);

/** True when this brand can be collected in this country. */
export const brandServes = (slug: string, country: CountryCode): boolean =>
  !!brandInfo(slug)?.countries.includes(country);
