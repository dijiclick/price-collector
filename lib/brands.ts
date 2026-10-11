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
 * Where an Inditex brand has no storefront of its own, the store list maps the
 * country to a worldwide ("WW") store that prices in another currency, and the
 * adapter refuses it. Seen on the first sweep, 2026-09-23.
 */
const except = (...no: CountryCode[]): CountryCode[] => ALL_COUNTRIES.filter((c) => !no.includes(c));
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
  { slug: "bershka", label: "BERSHKA", category: "Giyim", logo: "/brands/bershka.svg", countries: except("AU") },
  { slug: "stradivarius", label: "Stradivarius", category: "Giyim", logo: "/brands/stradivarius.svg", countries: except("AU") },
  { slug: "pullandbear", label: "PULL&BEAR", category: "Giyim", logo: "/brands/pullandbear.svg", countries: except("NO") },
  { slug: "massimodutti", label: "Massimo Dutti", category: "Giyim", logo: "/brands/massimodutti.svg", countries: except("AU") },
  { slug: "koton", label: "KOTON", category: "Giyim", logo: "/brands/koton.svg", countries: TR_ONLY },
  { slug: "guess", label: "GUESS", category: "Giyim", logo: "/brands/guess.svg", countries: GUESS },
  { slug: "penti", label: "penti", category: "İç giyim", logo: "/brands/penti.png", countries: TR_ONLY },
  { slug: "oysho", label: "OYSHO", category: "İç giyim", logo: "/brands/oysho.svg", countries: except("AU", "NO") },
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
  // Added 2026-10-10 — brands competitors cover that we did not.
  { slug: "lefties", label: "Lefties", category: "Giyim", logo: "/brands/lefties.svg", countries: TR_ONLY },
  { slug: "vakko", label: "VAKKO", category: "Giyim", logo: "/brands/vakko.svg", countries: TR_ONLY },
  { slug: "vakkorama", label: "Vakkorama", category: "Çok markalı", logo: "/brands/vakkorama.svg", countries: TR_ONLY },
  { slug: "nike", label: "Nike", category: "Ayakkabı", logo: "/brands/nike.svg", countries: TR_ONLY },
  { slug: "newbalance", label: "New Balance", category: "Ayakkabı", logo: "/brands/newbalance.svg", countries: TR_ONLY },
  { slug: "puma", label: "PUMA", category: "Ayakkabı", logo: "/brands/puma.svg", countries: TR_ONLY },
  { slug: "superstep", label: "SuperStep", category: "Çok markalı", logo: "/brands/superstep.svg", countries: TR_ONLY },
  { slug: "modanisa", label: "Modanisa", category: "Çok markalı", logo: "/brands/modanisa.svg", countries: TR_ONLY },
  { slug: "network", label: "Network", category: "Giyim", logo: "/brands/network.svg", countries: TR_ONLY },
  { slug: "ipekyol", label: "İpekyol", category: "Giyim", logo: "/brands/ipekyol.svg", countries: TR_ONLY },
  { slug: "twist", label: "Twist", category: "Giyim", logo: "/brands/twist.svg", countries: TR_ONLY },
  { slug: "lacoste", label: "Lacoste", category: "Giyim", logo: "/brands/lacoste.svg", countries: TR_ONLY },
  { slug: "pierrecardin", label: "Pierre Cardin", category: "Giyim", logo: "/brands/pierrecardin.svg", countries: TR_ONLY },
  { slug: "derimod", label: "Derimod", category: "Ayakkabı", logo: "/brands/derimod.svg", countries: TR_ONLY },
  { slug: "marksandspencer", label: "Marks & Spencer", category: "Giyim", logo: "/brands/marksandspencer.svg", countries: TR_ONLY },
  { slug: "victoriassecret", label: "Victoria's Secret", category: "İç giyim", logo: "/brands/victoriassecret.svg", countries: TR_ONLY },
  { slug: "lcw", label: "LC Waikiki", category: "Giyim", logo: "/brands/lcw.svg", countries: TR_ONLY },
  { slug: "defacto", label: "DeFacto", category: "Giyim", logo: "/brands/defacto.svg", countries: TR_ONLY },
  { slug: "mavi", label: "Mavi", category: "Giyim", logo: "/brands/mavi.svg", countries: TR_ONLY },
  { slug: "colins", label: "Colin's", category: "Giyim", logo: "/brands/colins.svg", countries: TR_ONLY },
  { slug: "mudo", label: "Mudo", category: "Giyim", logo: "/brands/mudo.svg", countries: TR_ONLY },
  // 2026-10-11: Shopify storefronts (packages/collector/src/brands/shopify-stores.ts).
  { slug: "rarebeauty", label: "Rare Beauty", category: "Kozmetik", logo: "/brands/rarebeauty.svg", countries: ["US"] },
  { slug: "aloyoga", label: "Alo Yoga", category: "Spor", logo: "/brands/aloyoga.svg", countries: ["US"] },
  { slug: "princesspolly", label: "Princess Polly", category: "Giyim", logo: "/brands/princesspolly.svg", countries: ["US", "AU"] },
  { slug: "stevemadden", label: "Steve Madden", category: "Ayakkabı", logo: "/brands/stevemadden.svg", countries: ["US"] },
  { slug: "glossier", label: "Glossier", category: "Kozmetik", logo: "/brands/glossier.svg", countries: ["US"] },
  { slug: "ardene", label: "Ardene", category: "Giyim", logo: "/brands/ardene.svg", countries: ["CA"] },
  { slug: "lasenza", label: "La Senza", category: "İç giyim", logo: "/brands/lasenza.svg", countries: ["CA"] },
  { slug: "knix", label: "Knix", category: "İç giyim", logo: "/brands/knix.svg", countries: ["CA"] },
  { slug: "frankandoak", label: "Frank And Oak", category: "Giyim", logo: "/brands/frankandoak.svg", countries: ["CA"] },
  { slug: "reitmans", label: "Reitmans", category: "Giyim", logo: "/brands/reitmans.svg", countries: ["CA"] },
  { slug: "suzyshier", label: "Suzy Shier", category: "Giyim", logo: "/brands/suzyshier.svg", countries: ["CA"] },
  { slug: "callitspring", label: "Call It Spring", category: "Ayakkabı", logo: "/brands/callitspring.svg", countries: ["CA"] },
  { slug: "laura", label: "Laura", category: "Giyim", logo: "/brands/laura.svg", countries: ["CA"] },
  { slug: "ohpolly", label: "Oh Polly", category: "Giyim", logo: "/brands/ohpolly.svg", countries: ["GB"] },
  { slug: "neverfullydressed", label: "Never Fully Dressed", category: "Giyim", logo: "/brands/neverfullydressed.svg", countries: ["GB"] },
  { slug: "lounge", label: "Lounge", category: "İç giyim", logo: "/brands/lounge.svg", countries: ["GB"] },
  { slug: "kookai", label: "KOOKAÏ", category: "Giyim", logo: "/brands/kookai.svg", countries: ["AU"] },
  { slug: "whitefox", label: "White Fox", category: "Giyim", logo: "/brands/whitefox.svg", countries: ["AU"] },
  { slug: "tigerlily", label: "Tigerlily", category: "Mayo", logo: "/brands/tigerlily.svg", countries: ["AU"] },
  { slug: "dissh", label: "DISSH", category: "Giyim", logo: "/brands/dissh.svg", countries: ["AU"] },
  { slug: "mimco", label: "MIMCO", category: "Çanta", logo: "/brands/mimco.svg", countries: ["AU"] },
  { slug: "peppermayo", label: "Peppermayo", category: "Giyim", logo: "/brands/peppermayo.svg", countries: ["AU"] },
  { slug: "beginningboutique", label: "Beginning Boutique", category: "Giyim", logo: "/brands/beginningboutique.svg", countries: ["AU"] },
  { slug: "decjuba", label: "Decjuba", category: "Giyim", logo: "/brands/decjuba.svg", countries: ["AU"] },
  { slug: "universalstore", label: "Universal Store", category: "Çok markalı", logo: "/brands/universalstore.svg", countries: ["AU"] },
  { slug: "seafolly", label: "Seafolly", category: "Mayo", logo: "/brands/seafolly.svg", countries: ["AU"] },
  { slug: "pe-nation", label: "P.E Nation", category: "Spor", logo: "/brands/pe-nation.svg", countries: ["AU"] },
  { slug: "lovisa", label: "Lovisa", category: "Takı", logo: "/brands/lovisa.svg", countries: ["AU"] },
  { slug: "spell", label: "Spell", category: "Giyim", logo: "/brands/spell.svg", countries: ["AU"] },
  { slug: "forevernew", label: "Forever New", category: "Giyim", logo: "/brands/forevernew.svg", countries: ["AU"] },
  { slug: "billini", label: "Billini", category: "Ayakkabı", logo: "/brands/billini.svg", countries: ["AU"] },
  { slug: "seed", label: "Seed Heritage", category: "Giyim", logo: "/brands/seed.svg", countries: ["AU"] },
  { slug: "countryroad", label: "Country Road", category: "Giyim", logo: "/brands/countryroad.svg", countries: ["AU"] },
  { slug: "wittner", label: "Wittner", category: "Ayakkabı", logo: "/brands/wittner.svg", countries: ["AU"] },
  { slug: "lornajane", label: "Lorna Jane", category: "Spor", logo: "/brands/lornajane.svg", countries: ["AU"] },
  { slug: "dagi", label: "Dagi", category: "İç giyim", logo: "/brands/dagi.svg", countries: ["TR"] },
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
