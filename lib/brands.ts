/** Brand catalog for onboarding, rail and filters. Order = display order. */
export interface BrandInfo {
  slug: string;
  label: string;
  category: string;
  /** Official logo asset under /public (Wikimedia Commons, PD-textlogo). */
  logo: string;
}

export const BRANDS: BrandInfo[] = [
  { slug: "zara", label: "ZARA", category: "Giyim", logo: "/brands/zara.svg" },
  { slug: "mango", label: "MANGO", category: "Giyim", logo: "/brands/mango.svg" },
  { slug: "hm", label: "H&M", category: "Giyim", logo: "/brands/hm.svg" },
  { slug: "bershka", label: "BERSHKA", category: "Giyim", logo: "/brands/bershka.svg" },
  { slug: "stradivarius", label: "Stradivarius", category: "Giyim", logo: "/brands/stradivarius.svg" },
  { slug: "pullandbear", label: "PULL&BEAR", category: "Giyim", logo: "/brands/pullandbear.svg" },
  { slug: "massimodutti", label: "Massimo Dutti", category: "Giyim", logo: "/brands/massimodutti.svg" },
  { slug: "koton", label: "KOTON", category: "Giyim", logo: "/brands/koton.svg" },
  { slug: "guess", label: "GUESS", category: "Giyim", logo: "/brands/guess.svg" },
  { slug: "penti", label: "penti", category: "İç giyim", logo: "/brands/penti.png" },
  { slug: "oysho", label: "OYSHO", category: "İç giyim", logo: "/brands/oysho.svg" },
  { slug: "sephora", label: "SEPHORA", category: "Kozmetik", logo: "/brands/sephora.svg" },
  { slug: "gratis", label: "gratis", category: "Kozmetik", logo: "/brands/gratis.svg" },
  { slug: "rossmann", label: "ROSSMANN", category: "Kozmetik", logo: "/brands/rossmann.svg" },
  { slug: "watsons", label: "Watsons", category: "Kişisel bakım", logo: "/brands/watsons.svg" },
  { slug: "pandora", label: "PANDORA", category: "Takı", logo: "/brands/pandora.svg" },
  { slug: "boyner", label: "Boyner", category: "Çok markalı", logo: "/brands/boyner.svg" },
  { slug: "beymen", label: "Beymen", category: "Çok markalı", logo: "/brands/beymen.svg" },
];

export const BRAND_SLUGS = BRANDS.map((b) => b.slug);
export const brandInfo = (slug: string) => BRANDS.find((b) => b.slug === slug);
