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
  { slug: "hm", label: "H&M", category: "Giyim", logo: "/brands/hm.svg", countries: EVERYWHERE },
  { slug: "bershka", label: "BERSHKA", category: "Giyim", logo: "/brands/bershka.svg", countries: except("AU") },
  { slug: "stradivarius", label: "Stradivarius", category: "Giyim", logo: "/brands/stradivarius.svg", countries: except("AU") },
  { slug: "pullandbear", label: "PULL&BEAR", category: "Giyim", logo: "/brands/pullandbear.svg", countries: except("NO") },
  { slug: "massimodutti", label: "Massimo Dutti", category: "Giyim", logo: "/brands/massimodutti.svg", countries: except("AU") },
  { slug: "koton", label: "KOTON", category: "Giyim", logo: "/brands/koton.svg", countries: TR_ONLY },
  { slug: "guess", label: "GUESS", category: "Giyim", logo: "/brands/guess.svg", countries: GUESS },
  { slug: "penti", label: "penti", category: "İç giyim", logo: "/brands/penti.png", countries: TR_ONLY },
  { slug: "oysho", label: "OYSHO", category: "İç giyim", logo: "/brands/oysho.svg", countries: except("AU", "NO") },
  { slug: "sephora", label: "SEPHORA", category: "Kozmetik", logo: "/brands/sephora.svg", countries: ["TR", "US", "CA", "AU", "CH"] },
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
  { slug: "nike", label: "Nike", category: "Ayakkabı", logo: "/brands/nike.svg", countries: ["TR", "US", "GB", "CH", "NO"] },
  { slug: "newbalance", label: "New Balance", category: "Ayakkabı", logo: "/brands/newbalance.svg", countries: TR_ONLY },
  { slug: "puma", label: "PUMA", category: "Ayakkabı", logo: "/brands/puma.svg", countries: TR_ONLY },
  { slug: "superstep", label: "SuperStep", category: "Çok markalı", logo: "/brands/superstep.svg", countries: TR_ONLY },
  { slug: "modanisa", label: "Modanisa", category: "Çok markalı", logo: "/brands/modanisa.svg", countries: ["TR", "AE", "SA"] },
  { slug: "network", label: "Network", category: "Giyim", logo: "/brands/network.svg", countries: TR_ONLY },
  { slug: "ipekyol", label: "İpekyol", category: "Giyim", logo: "/brands/ipekyol.svg", countries: TR_ONLY },
  { slug: "twist", label: "Twist", category: "Giyim", logo: "/brands/twist.svg", countries: TR_ONLY },
  { slug: "lacoste", label: "Lacoste", category: "Giyim", logo: "/brands/lacoste.svg", countries: TR_ONLY },
  { slug: "pierrecardin", label: "Pierre Cardin", category: "Giyim", logo: "/brands/pierrecardin.svg", countries: TR_ONLY },
  { slug: "derimod", label: "Derimod", category: "Ayakkabı", logo: "/brands/derimod.svg", countries: TR_ONLY },
  { slug: "marksandspencer", label: "Marks & Spencer", category: "Giyim", logo: "/brands/marksandspencer.svg", countries: ["TR", "GB"] },
  { slug: "victoriassecret", label: "Victoria's Secret", category: "İç giyim", logo: "/brands/victoriassecret.svg", countries: ["TR", "AE", "SA"] },
  { slug: "lcw", label: "LC Waikiki", category: "Giyim", logo: "/brands/lcw.svg", countries: TR_ONLY },
  { slug: "defacto", label: "DeFacto", category: "Giyim", logo: "/brands/defacto.svg", countries: TR_ONLY },
  { slug: "mavi", label: "Mavi", category: "Giyim", logo: "/brands/mavi.svg", countries: TR_ONLY },
  { slug: "colins", label: "Colin's", category: "Giyim", logo: "/brands/colins.svg", countries: TR_ONLY },
  { slug: "mudo", label: "Mudo", category: "Giyim", logo: "/brands/mudo.svg", countries: TR_ONLY },
  // 2026-10-11: Shopify storefronts (packages/collector/src/brands/shopify-stores.ts).
  { slug: "rarebeauty", label: "Rare Beauty", category: "Kozmetik", logo: "/brands/rarebeauty.svg", countries: ["US"] },
  { slug: "aloyoga", label: "Alo Yoga", category: "Spor", logo: "/brands/aloyoga.svg", countries: ["US"] },
  { slug: "princesspolly", label: "Princess Polly", category: "Giyim", logo: "/brands/princesspolly.svg", countries: ["US", "AU"] },
  { slug: "stevemadden", label: "Steve Madden", category: "Ayakkabı", logo: "/brands/stevemadden.svg", countries: ["US", "CA", "GB", "AU"] },
  { slug: "gymshark", label: "Gymshark", category: "Spor", logo: "/brands/gymshark.svg", countries: ["US", "CA", "GB", "AU", "CH"] },
  { slug: "whitefox", label: "White Fox", category: "Giyim", logo: "/brands/whitefox.svg", countries: ["US", "GB", "AU"] },
  { slug: "dolcevita", label: "Dolce Vita", category: "Ayakkabı", logo: "/brands/dolcevita.svg", countries: ["US", "CA"] },
  { slug: "psychobunny", label: "Psycho Bunny", category: "Giyim", logo: "/brands/psychobunny.svg", countries: ["US", "CA"] },
  { slug: "herschel", label: "Herschel", category: "Çanta", logo: "/brands/herschel.svg", countries: ["US", "CA"] },
  { slug: "forever21", label: "Forever 21", category: "Giyim", logo: "/brands/forever21.svg", countries: ["US"] },
  { slug: "vincecamuto", label: "Vince Camuto", category: "Ayakkabı", logo: "/brands/vincecamuto.svg", countries: ["US"] },
  { slug: "windsor", label: "Windsor", category: "Giyim", logo: "/brands/windsor.svg", countries: ["US"] },
  { slug: "kyliecosmetics", label: "Kylie Cosmetics", category: "Kozmetik", logo: "/brands/kyliecosmetics.svg", countries: ["US"] },
  { slug: "brownsshoes", label: "Browns Shoes", category: "Ayakkabı", logo: "/brands/brownsshoes.svg", countries: ["CA"] },
  { slug: "glossier", label: "Glossier", category: "Kozmetik", logo: "/brands/glossier.svg", countries: ["US"] },
  { slug: "ardene", label: "Ardene", category: "Giyim", logo: "/brands/ardene.svg", countries: ["CA"] },
  { slug: "lasenza", label: "La Senza", category: "İç giyim", logo: "/brands/lasenza.svg", countries: ["CA"] },
  { slug: "knix", label: "Knix", category: "İç giyim", logo: "/brands/knix.svg", countries: ["CA"] },
  { slug: "reitmans", label: "Reitmans", category: "Giyim", logo: "/brands/reitmans.svg", countries: ["CA"] },
  { slug: "suzyshier", label: "Suzy Shier", category: "Giyim", logo: "/brands/suzyshier.svg", countries: ["CA"] },
  { slug: "laura", label: "Laura", category: "Giyim", logo: "/brands/laura.svg", countries: ["CA"] },
  { slug: "ohpolly", label: "Oh Polly", category: "Giyim", logo: "/brands/ohpolly.svg", countries: ["GB"] },
  { slug: "kookai", label: "KOOKAÏ", category: "Giyim", logo: "/brands/kookai.svg", countries: ["AU"] },
  { slug: "dissh", label: "DISSH", category: "Giyim", logo: "/brands/dissh.svg", countries: ["AU"] },
  { slug: "mimco", label: "MIMCO", category: "Çanta", logo: "/brands/mimco.svg", countries: ["AU"] },
  { slug: "peppermayo", label: "Peppermayo", category: "Giyim", logo: "/brands/peppermayo.svg", countries: ["AU"] },
  { slug: "beginningboutique", label: "Beginning Boutique", category: "Giyim", logo: "/brands/beginningboutique.svg", countries: ["AU"] },
  { slug: "decjuba", label: "Decjuba", category: "Giyim", logo: "/brands/decjuba.svg", countries: ["AU"] },
  { slug: "universalstore", label: "Universal Store", category: "Çok markalı", logo: "/brands/universalstore.svg", countries: ["AU"] },
  { slug: "seafolly", label: "Seafolly", category: "Mayo", logo: "/brands/seafolly.svg", countries: ["AU"] },
  { slug: "pe-nation", label: "P.E Nation", category: "Spor", logo: "/brands/pe-nation.svg", countries: ["AU"] },
  { slug: "forevernew", label: "Forever New", category: "Giyim", logo: "/brands/forevernew.svg", countries: ["AU"] },
  { slug: "countryroad", label: "Country Road", category: "Giyim", logo: "/brands/countryroad.svg", countries: ["AU"] },
  { slug: "lornajane", label: "Lorna Jane", category: "Spor", logo: "/brands/lornajane.svg", countries: ["AU"] },
  { slug: "dagi", label: "Dagi", category: "İç giyim", logo: "/brands/dagi.svg", countries: ["TR"] },
  // 2026-10-11: per-market adapters (packages/collector/src/registry-intl.ts).
  { slug: "gap", label: "GAP", category: "Giyim", logo: "/brands/gap.svg", countries: ["TR", "US", "CA"] },
  { slug: "uspoloassn", label: "U.S. Polo Assn.", category: "Giyim", logo: "/brands/uspoloassn.svg", countries: ["TR"] },
  { slug: "cacharel", label: "Cacharel", category: "Giyim", logo: "/brands/cacharel.svg", countries: ["TR"] },
  { slug: "converse", label: "Converse", category: "Ayakkabı", logo: "/brands/converse.svg", countries: ["TR"] },
  { slug: "gant", label: "GANT", category: "Giyim", logo: "/brands/gant.svg", countries: ["TR"] },
  { slug: "maccosmetics", label: "M·A·C", category: "Kozmetik", logo: "/brands/maccosmetics.svg", countries: ["TR"] },
  { slug: "flormar", label: "Flormar", category: "Kozmetik", logo: "/brands/flormar.svg", countries: ["TR"] },
  { slug: "fashfed", label: "FashFed", category: "Çok markalı", logo: "/brands/fashfed.svg", countries: ["TR"] },
  { slug: "sportive", label: "Sportive", category: "Spor", logo: "/brands/sportive.svg", countries: ["TR"] },
  { slug: "oldnavy", label: "Old Navy", category: "Giyim", logo: "/brands/oldnavy.svg", countries: ["US", "CA"] },
  { slug: "bananarepublic", label: "Banana Republic", category: "Giyim", logo: "/brands/bananarepublic.svg", countries: ["US", "CA"] },
  { slug: "gapfactory", label: "Gap Factory", category: "Giyim", logo: "/brands/gapfactory.svg", countries: ["US", "CA"] },
  { slug: "brfactory", label: "Banana Republic Factory", category: "Giyim", logo: "/brands/brfactory.svg", countries: ["US", "CA"] },
  { slug: "macys", label: "Macy's", category: "Çok markalı", logo: "/brands/macys.svg", countries: ["US"] },
  { slug: "athleta", label: "Athleta", category: "Spor", logo: "/brands/athleta.svg", countries: ["US"] },
  { slug: "abercrombie", label: "Abercrombie & Fitch", category: "Giyim", logo: "/brands/abercrombie.svg", countries: ["US", "CA", "GB"] },
  { slug: "hollister", label: "Hollister", category: "Giyim", logo: "/brands/hollister.svg", countries: ["US", "CA", "GB"] },
  { slug: "ulta", label: "Ulta Beauty", category: "Kozmetik", logo: "/brands/ulta.svg", countries: ["US"] },
  { slug: "skims", label: "SKIMS", category: "Giyim", logo: "/brands/skims.svg", countries: ["US", "CA", "GB"] },
  { slug: "fashionnova", label: "Fashion Nova", category: "Giyim", logo: "/brands/fashionnova.svg", countries: ["US"] },
  { slug: "aldo", label: "ALDO", category: "Ayakkabı", logo: "/brands/aldo.svg", countries: ["US", "CA"] },
  { slug: "on", label: "On", category: "Spor", logo: "/brands/on.svg", countries: ["US", "CH"] },
  { slug: "roots", label: "Roots", category: "Giyim", logo: "/brands/roots.svg", countries: ["CA"] },
  { slug: "lavieenrose", label: "La Vie en Rose", category: "İç giyim", logo: "/brands/lavieenrose.svg", countries: ["CA"] },
  { slug: "aritzia", label: "Aritzia", category: "Giyim", logo: "/brands/aritzia.svg", countries: ["US", "CA"] },
  { slug: "lululemon", label: "lululemon", category: "Spor", logo: "/brands/lululemon.svg", countries: ["US", "CA"] },
  // 2026-10-11 round 2: big brands behind bot walls (registry-intl.ts).
  { slug: "boots", label: "Boots", category: "Kozmetik", logo: "/brands/boots.svg", countries: ["GB", "AE", "SA"] },
  { slug: "uniqlo", label: "UNIQLO", category: "Giyim", logo: "/brands/uniqlo.svg", countries: ["GB", "AU"] },
  { slug: "faces", label: "FACES", category: "Kozmetik", logo: "/brands/faces.svg", countries: ["AE", "SA"] },
  { slug: "garage", label: "Garage", category: "Giyim", logo: "/brands/garage.svg", countries: ["CA"] },
  { slug: "dynamite", label: "Dynamite", category: "Giyim", logo: "/brands/dynamite.svg", countries: ["CA"] },
  { slug: "theiconic", label: "THE ICONIC", category: "Çok markalı", logo: "/brands/theiconic.svg", countries: ["AU"] },
  { slug: "glassons", label: "Glassons", category: "Giyim", logo: "/brands/glassons.svg", countries: ["AU"] },
  { slug: "hellomolly", label: "Hello Molly", category: "Giyim", logo: "/brands/hellomolly.svg", countries: ["AU"] },
  { slug: "meshki", label: "MESHKI", category: "Giyim", logo: "/brands/meshki.svg", countries: ["AU"] },
  { slug: "adorebeauty", label: "Adore Beauty", category: "Kozmetik", logo: "/brands/adorebeauty.svg", countries: ["AU"] },
  { slug: "zalando", label: "Zalando", category: "Çok markalı", logo: "/brands/zalando.svg", countries: ["CH", "NO"] },
  { slug: "douglas", label: "Douglas", category: "Kozmetik", logo: "/brands/douglas.svg", countries: ["CH"] },
  { slug: "cubus", label: "Cubus", category: "Giyim", logo: "/brands/cubus.svg", countries: ["NO"] },
  { slug: "bikbok", label: "Bik Bok", category: "Giyim", logo: "/brands/bikbok.svg", countries: ["NO"] },
  { slug: "lindex", label: "Lindex", category: "Giyim", logo: "/brands/lindex.svg", countries: ["NO"] },
  { slug: "nelly", label: "Nelly", category: "Giyim", logo: "/brands/nelly.svg", countries: ["NO"] },
  { slug: "lyko", label: "Lyko", category: "Kozmetik", logo: "/brands/lyko.svg", countries: ["NO"] },
  { slug: "aivi", label: "AIVI", category: "Çok markalı", logo: "/brands/aivi.svg", countries: ["AE", "SA"] },
  { slug: "styli", label: "Styli", category: "Çok markalı", logo: "/brands/styli.svg", countries: ["AE", "SA"] },
  { slug: "centrepoint", label: "Centrepoint", category: "Çok markalı", logo: "/brands/centrepoint.svg", countries: ["AE", "SA"] },
  { slug: "maxfashion", label: "Max", category: "Giyim", logo: "/brands/maxfashion.svg", countries: ["AE", "SA"] },
  { slug: "splash", label: "Splash", category: "Giyim", logo: "/brands/splash.svg", countries: ["AE", "SA"] },
  { slug: "ounass", label: "Ounass", category: "Çok markalı", logo: "/brands/ounass.svg", countries: ["AE", "SA"] },
  { slug: "flo", label: "FLO", category: "Ayakkabı", logo: "/brands/flo.svg", countries: ["TR"] },
  { slug: "instreet", label: "In Street", category: "Spor", logo: "/brands/instreet.svg", countries: ["TR"] },
  { slug: "lumberjack", label: "Lumberjack", category: "Ayakkabı", logo: "/brands/lumberjack.svg", countries: ["TR"] },
  { slug: "kinetix", label: "Kinetix", category: "Spor", logo: "/brands/kinetix.svg", countries: ["TR"] },
  { slug: "reebok", label: "Reebok", category: "Spor", logo: "/brands/reebok.svg", countries: ["TR"] },
  { slug: "kiko", label: "KIKO Milano", category: "Kozmetik", logo: "/brands/kiko.svg", countries: ["TR"] },
  { slug: "skechers", label: "Skechers", category: "Ayakkabı", logo: "/brands/skechers.svg", countries: ["TR"] },
  { slug: "sneaksup", label: "Sneaks Up", category: "Spor", logo: "/brands/sneaksup.svg", countries: ["TR"] },
  { slug: "arket", label: "ARKET", category: "Giyim", logo: "/brands/arket.svg", countries: ["GB", "CH", "NO"] },
  { slug: "stories", label: "& Other Stories", category: "Giyim", logo: "/brands/stories.svg", countries: ["CH", "NO"] },
  { slug: "weekday", label: "Weekday", category: "Giyim", logo: "/brands/weekday.svg", countries: ["NO"] },
  { slug: "topshop", label: "Topshop", category: "Giyim", logo: "/brands/topshop.svg", countries: ["GB"] },
  { slug: "newlook", label: "New Look", category: "Giyim", logo: "/brands/newlook.svg", countries: ["GB"] },
  { slug: "asos", label: "ASOS", category: "Çok markalı", logo: "/brands/asos.svg", countries: ["GB"] },
  { slug: "next", label: "Next", category: "Giyim", logo: "/brands/next.svg", countries: ["GB"] },
  { slug: "reiss", label: "Reiss", category: "Giyim", logo: "/brands/reiss.svg", countries: ["GB"] },
  { slug: "riverisland", label: "River Island", category: "Giyim", logo: "/brands/riverisland.svg", countries: ["GB"] },
  { slug: "jdsports", label: "JD Sports", category: "Spor", logo: "/brands/jdsports.svg", countries: ["GB"] },
  { slug: "cottonon", label: "Cotton On", category: "Giyim", logo: "/brands/cottonon.svg", countries: ["AU"] },
  { slug: "showpo", label: "Showpo", category: "Giyim", logo: "/brands/showpo.svg", countries: ["AU"] },
  { slug: "sportsgirl", label: "Sportsgirl", category: "Giyim", logo: "/brands/sportsgirl.svg", countries: ["AU"] },
  { slug: "jd-sports", label: "JD Sports", category: "Spor", logo: "/brands/jd-sports.svg", countries: ["AU"] },
  { slug: "dosenbach", label: "Dosenbach", category: "Ayakkabı", logo: "/brands/dosenbach.svg", countries: ["CH"] },
  { slug: "ochsnershoes", label: "Ochsner Shoes", category: "Ayakkabı", logo: "/brands/ochsnershoes.svg", countries: ["CH"] },
  { slug: "ochsnersport", label: "Ochsner Sport", category: "Spor", logo: "/brands/ochsnersport.svg", countries: ["CH"] },
  { slug: "snipes", label: "SNIPES", category: "Ayakkabı", logo: "/brands/snipes.svg", countries: ["CH"] },
  { slug: "chicoree", label: "Chicorée", category: "Giyim", logo: "/brands/chicoree.svg", countries: ["CH"] },
  { slug: "c-and-a", label: "C&A", category: "Giyim", logo: "/brands/c-and-a.svg", countries: ["CH"] },
  { slug: "manor", label: "Manor", category: "Çok markalı", logo: "/brands/manor.svg", countries: ["CH"] },
  { slug: "aboutyou", label: "About You", category: "Çok markalı", logo: "/brands/aboutyou.svg", countries: ["CH"] },
  { slug: "impo", label: "Impo", category: "Kozmetik", logo: "/brands/impo.svg", countries: ["CH"] },
  { slug: "only", label: "ONLY", category: "Giyim", logo: "/brands/only.svg", countries: ["CH", "NO"] },
  { slug: "veromoda", label: "VERO MODA", category: "Giyim", logo: "/brands/veromoda.svg", countries: ["CH", "NO"] },
  { slug: "kappahl", label: "KappAhl", category: "Giyim", logo: "/brands/kappahl.svg", countries: ["NO"] },
  { slug: "vita", label: "Vita", category: "Kozmetik", logo: "/brands/vita.svg", countries: ["NO"] },
  { slug: "xxl", label: "XXL", category: "Spor", logo: "/brands/xxl.svg", countries: ["NO"] },
  { slug: "blivakker", label: "Blivakker", category: "Kozmetik", logo: "/brands/blivakker.svg", countries: ["NO"] },
  { slug: "ginatricot", label: "Gina Tricot", category: "Giyim", logo: "/brands/ginatricot.svg", countries: ["NO"] },
  { slug: "na-kd", label: "NA-KD", category: "Giyim", logo: "/brands/na-kd.svg", countries: ["NO"] },
  { slug: "ellos", label: "Ellos", category: "Çok markalı", logo: "/brands/ellos.svg", countries: ["NO"] },
  { slug: "fredrikoglouisa", label: "Fredrik & Louisa", category: "Kozmetik", logo: "/brands/fredrikoglouisa.svg", countries: ["NO"] },
  { slug: "gullfunn", label: "Gullfunn", category: "Takı", logo: "/brands/gullfunn.svg", countries: ["NO"] },
  { slug: "bathandbodyworks", label: "Bath & Body Works", category: "Kişisel bakım", logo: "/brands/bathandbodyworks.svg", countries: ["TR", "AE", "SA"] },
  { slug: "americaneagle", label: "American Eagle", category: "Giyim", logo: "/brands/americaneagle.svg", countries: ["AE", "SA", "US", "CA"] },
  { slug: "goldenscent", label: "Golden Scent", category: "Kozmetik", logo: "/brands/goldenscent.svg", countries: ["AE", "SA"] },
  { slug: "vperfumes", label: "VPerfumes", category: "Kozmetik", logo: "/brands/vperfumes.svg", countries: ["AE", "SA"] },
  { slug: "bloomingdales", label: "Bloomingdale's", category: "Çok markalı", logo: "/brands/bloomingdales.svg", countries: ["AE"] },
  { slug: "damas", label: "Damas", category: "Takı", logo: "/brands/damas.svg", countries: ["AE"] },
  { slug: "ajmal", label: "Ajmal", category: "Kozmetik", logo: "/brands/ajmal.svg", countries: ["AE", "SA"] },
  { slug: "nahdi", label: "Nahdi", category: "Kozmetik", logo: "/brands/nahdi.svg", countries: ["AE", "SA"] },
  { slug: "calzedonia", label: "Calzedonia", category: "İç giyim", logo: "/brands/calzedonia.svg", countries: ["TR", "CH"] },
  { slug: "intimissimi", label: "Intimissimi", category: "İç giyim", logo: "/brands/intimissimi.svg", countries: ["TR", "CH"] },
  { slug: "falconeri", label: "Falconeri", category: "Giyim", logo: "/brands/falconeri.svg", countries: ["TR", "CH"] },
  { slug: "desa", label: "Desa", category: "Çanta", logo: "/brands/desa.svg", countries: ["TR"] },
  { slug: "elifstil", label: "Elifstil", category: "Giyim", logo: "/brands/elifstil.svg", countries: ["TR"] },
  { slug: "noteshop", label: "Note Cosmetics", category: "Kozmetik", logo: "/brands/noteshop.svg", countries: ["TR"] },
  { slug: "yargici", label: "Yargıcı", category: "Giyim", logo: "/brands/yargici.svg", countries: ["TR"] },
  { slug: "hotic", label: "Hotiç", category: "Ayakkabı", logo: "/brands/hotic.svg", countries: ["TR"] },
  { slug: "suwen", label: "Suwen", category: "İç giyim", logo: "/brands/suwen.svg", countries: ["TR"] },
  { slug: "haydigiy", label: "HaydiGiy", category: "Giyim", logo: "/brands/haydigiy.svg", countries: ["TR"] },
  { slug: "boohoo", label: "boohoo", category: "Giyim", logo: "/brands/boohoo.svg", countries: ["GB"] },
  { slug: "prettylittlething", label: "PrettyLittleThing", category: "Giyim", logo: "/brands/prettylittlething.svg", countries: ["GB"] },
  { slug: "whistles", label: "Whistles", category: "Giyim", logo: "/brands/whistles.svg", countries: ["GB"] },
  { slug: "hobbs", label: "Hobbs", category: "Giyim", logo: "/brands/hobbs.svg", countries: ["GB"] },
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
