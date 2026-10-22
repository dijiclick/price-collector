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

/**
 * Markets opened after the "every market" helpers below were written
 * (2026-10-21). They are NOT implied by EVERYWHERE / except() / GUESS — an
 * Inditex brand there may have no storefront, or a different platform — so
 * each brand lists them explicitly where its adapter was verified.
 */
const LATER: CountryCode[] = ["QA", "KW", "JP", "KR", "SG", "HK"];
/** Turkish retailers with no other storefront. */
const TR_ONLY: CountryCode[] = ["TR"];
/**
 * Every market. The six Inditex brands plus Mango: itxrest answers per store
 * id for all of them, and Mango's orchestrator takes `countryIso`.
 */
const EVERYWHERE: CountryCode[] = ALL_COUNTRIES.filter((c) => !LATER.includes(c));
/**
 * Where an Inditex brand has no storefront of its own, the store list maps the
 * country to a worldwide ("WW") store that prices in another currency, and the
 * adapter refuses it. Seen on the first sweep, 2026-09-23.
 */
const except = (...no: CountryCode[]): CountryCode[] => EVERYWHERE.filter((c) => !no.includes(c));
/**
 * Turkey, Britain and Europe. Guess's Algolia has no `en_US`, `en_CA`,
 * `en_AU`, `en_AE` or `en_SA` index (404) — those storefronts are other
 * platforms. Verified 2026-09-20 and 2026-09-23.
 */
const GUESS: CountryCode[] = EVERYWHERE.filter(
  (c) => !["CA", "AU", "AE", "SA"].includes(c),
);

export const BRANDS: BrandInfo[] = [
  { slug: "zara", label: "ZARA", category: "Giyim", logo: "/brands/zara.svg", countries: [...EVERYWHERE, "QA", "KW", "JP", "KR", "SG", "HK"] },
  { slug: "mango", label: "MANGO", category: "Giyim", logo: "/brands/mango.svg", countries: [...EVERYWHERE, "QA", "KW", "SG", "HK"] },
  { slug: "hm", label: "H&M", category: "Giyim", logo: "/brands/hm.svg", countries: [...EVERYWHERE, "QA", "KW", "JP", "KR", "SG"] },
  { slug: "bershka", label: "BERSHKA", category: "Giyim", logo: "/brands/bershka.svg", countries: [...except("AU"), "QA", "KW"] },
  { slug: "stradivarius", label: "Stradivarius", category: "Giyim", logo: "/brands/stradivarius.svg", countries: [...except("AU"), "KW"] },
  { slug: "pullandbear", label: "PULL&BEAR", category: "Giyim", logo: "/brands/pullandbear.svg", countries: [...except("NO"), "QA", "KW"] },
  { slug: "massimodutti", label: "Massimo Dutti", category: "Giyim", logo: "/brands/massimodutti.svg", countries: [...except("AU"), "QA", "KW", "SG", "HK", "KR"] },
  { slug: "koton", label: "KOTON", category: "Giyim", logo: "/brands/koton.svg", countries: TR_ONLY },
  { slug: "guess", label: "GUESS", category: "Giyim", logo: "/brands/guess.svg", countries: [...GUESS, "CA"] },
  { slug: "penti", label: "penti", category: "İç giyim", logo: "/brands/penti.png", countries: TR_ONLY },
  { slug: "oysho", label: "OYSHO", category: "İç giyim", logo: "/brands/oysho.svg", countries: [...except("AU", "NO"), "QA", "KW"] },
  { slug: "sephora", label: "SEPHORA", category: "Kozmetik", logo: "/brands/sephora.svg", countries: ["TR", "US", "CA", "AU", "DE", "FR", "IT", "CH", "SG", "HK"] },
  { slug: "gratis", label: "gratis", category: "Kozmetik", logo: "/brands/gratis.svg", countries: TR_ONLY },
  { slug: "rossmann", label: "ROSSMANN", category: "Kozmetik", logo: "/brands/rossmann.svg", countries: ["TR", "DE"] },
  { slug: "watsons", label: "Watsons", category: "Kişisel bakım", logo: "/brands/watsons.svg", countries: TR_ONLY },
  // Pandora US/CA (2026-10-12): the storefront's SLAS guest token still answers
  // through Cloudflare and Salesforce's own API host has no wall — see
  // pandora-intl.ts. GB/AU/CH/NO have no real markdowns today.
  { slug: "pandora", label: "PANDORA", category: "Takı", logo: "/brands/pandora.svg", countries: ["TR", "US", "CA"] },
  { slug: "boyner", label: "Boyner", category: "Çok markalı", logo: "/brands/boyner.svg", countries: TR_ONLY },
  { slug: "beymen", label: "Beymen", category: "Çok markalı", logo: "/brands/beymen.svg", countries: TR_ONLY },
  // Added 2026-10-10 — brands competitors cover that we did not.
  { slug: "lefties", label: "Lefties", category: "Giyim", logo: "/brands/lefties.svg", countries: ["TR", "FR", "ES", "IT", "PT", "AE", "SA"] },
  { slug: "vakko", label: "VAKKO", category: "Giyim", logo: "/brands/vakko.svg", countries: TR_ONLY },
  { slug: "vakkorama", label: "Vakkorama", category: "Çok markalı", logo: "/brands/vakkorama.svg", countries: TR_ONLY },
  { slug: "nike", label: "Nike", category: "Ayakkabı", logo: "/brands/nike.svg", countries: ["TR", "GB", "US", "IE", "DE", "FR", "NL", "BE", "AT", "ES", "IT", "FI", "CH", "SE", "DK", "NO", "JP", "KR", "SG", "CA", "AU"] },
  { slug: "newbalance", label: "New Balance", category: "Ayakkabı", logo: "/brands/newbalance.svg", countries: ["TR", "US", "CA", "IE", "DE", "FR", "NL", "BE", "AT", "ES", "IT", "PT", "FI", "SE", "DK", "GB"] },
  { slug: "puma", label: "PUMA", category: "Ayakkabı", logo: "/brands/puma.svg", countries: ["TR", "GB", "US", "CA", "IE", "DE", "FR", "NL", "BE", "AT", "ES", "IT", "PT", "FI", "CH", "SE", "DK", "AU"] },
  { slug: "superstep", label: "SuperStep", category: "Çok markalı", logo: "/brands/superstep.svg", countries: TR_ONLY },
  { slug: "modanisa", label: "Modanisa", category: "Çok markalı", logo: "/brands/modanisa.svg", countries: ["TR", "AE", "SA", "QA", "KW"] },
  { slug: "network", label: "Network", category: "Giyim", logo: "/brands/network.svg", countries: TR_ONLY },
  { slug: "ipekyol", label: "İpekyol", category: "Giyim", logo: "/brands/ipekyol.svg", countries: TR_ONLY },
  { slug: "twist", label: "Twist", category: "Giyim", logo: "/brands/twist.svg", countries: TR_ONLY },
  { slug: "lacoste", label: "Lacoste", category: "Giyim", logo: "/brands/lacoste.svg", countries: ["TR", "US"] },
  { slug: "pierrecardin", label: "Pierre Cardin", category: "Giyim", logo: "/brands/pierrecardin.svg", countries: TR_ONLY },
  { slug: "derimod", label: "Derimod", category: "Ayakkabı", logo: "/brands/derimod.svg", countries: TR_ONLY },
  // Added 2026-10-18 — owner: jewellery, watches (Saat&Saat), Levi's and other good missing brands.
  { slug: "saatvesaat", label: "Saat&Saat", category: "Saat", logo: "/brands/saatvesaat.svg", countries: TR_ONLY },
  { slug: "altinbas", label: "Altınbaş", category: "Takı", logo: "/brands/altinbas.svg", countries: TR_ONLY },
  { slug: "atasay", label: "Atasay", category: "Takı", logo: "/brands/atasay.svg", countries: TR_ONLY },
  { slug: "zenpirlanta", label: "Zen Pırlanta", category: "Takı", logo: "/brands/zenpirlanta.svg", countries: TR_ONLY },
  { slug: "casio", label: "Casio", category: "Saat", logo: "/brands/casio.svg", countries: TR_ONLY },
  { slug: "machka", label: "Machka", category: "Giyim", logo: "/brands/machka.svg", countries: TR_ONLY },
  { slug: "adl", label: "ADL", category: "Giyim", logo: "/brands/adl.svg", countries: TR_ONLY },
  { slug: "wcollection", label: "W Collection", category: "Giyim", logo: "/brands/wcollection.svg", countries: TR_ONLY },
  { slug: "jimmykey", label: "Jimmy Key", category: "Giyim", logo: "/brands/jimmykey.svg", countries: TR_ONLY },
  { slug: "loft", label: "LOFT", category: "Giyim", logo: "/brands/loft.svg", countries: ["TR", "US"] },
  { slug: "quzu", label: "QUZU", category: "Giyim", logo: "/brands/quzu.svg", countries: TR_ONLY },
  { slug: "lesbenjamins", label: "Les Benjamins", category: "Giyim", logo: "/brands/lesbenjamins.svg", countries: TR_ONLY },
  { slug: "underarmour", label: "Under Armour", category: "Spor", logo: "/brands/underarmour.svg", countries: ["TR", "US", "CA"] },
  { slug: "timberland", label: "Timberland", category: "Ayakkabı", logo: "/brands/timberland.svg", countries: TR_ONLY },
  { slug: "marksandspencer", label: "Marks & Spencer", category: "Giyim", logo: "/brands/marksandspencer.svg", countries: ["TR", "GB", "IE"] },
  { slug: "victoriassecret", label: "Victoria's Secret", category: "İç giyim", logo: "/brands/victoriassecret.svg", countries: ["TR", "AE", "SA", "QA", "KW"] },
  { slug: "lcw", label: "LC Waikiki", category: "Giyim", logo: "/brands/lcw.svg", countries: TR_ONLY },
  { slug: "defacto", label: "DeFacto", category: "Giyim", logo: "/brands/defacto.svg", countries: TR_ONLY },
  { slug: "mavi", label: "Mavi", category: "Giyim", logo: "/brands/mavi.svg", countries: TR_ONLY },
  { slug: "colins", label: "Colin's", category: "Giyim", logo: "/brands/colins.svg", countries: TR_ONLY },
  { slug: "mudo", label: "Mudo", category: "Giyim", logo: "/brands/mudo.svg", countries: TR_ONLY },
  // 2026-10-11: Shopify storefronts (packages/collector/src/brands/shopify-stores.ts).
  { slug: "rarebeauty", label: "Rare Beauty", category: "Kozmetik", logo: "/brands/rarebeauty.svg", countries: ["US"] },
  { slug: "aloyoga", label: "Alo Yoga", category: "Spor", logo: "/brands/aloyoga.svg", countries: ["US", "CA"] },
  { slug: "princesspolly", label: "Princess Polly", category: "Giyim", logo: "/brands/princesspolly.svg", countries: ["US", "AU", "CA"] },
  { slug: "stevemadden", label: "Steve Madden", category: "Ayakkabı", logo: "/brands/stevemadden.svg", countries: ["US", "CA", "GB", "AU"] },
  { slug: "gymshark", label: "Gymshark", category: "Spor", logo: "/brands/gymshark.svg", countries: ["GB", "US", "CA", "AU", "IE", "DE", "FR", "NL", "BE", "AT", "ES", "IT", "PT", "FI", "CH", "SE", "DK"] },
  { slug: "whitefox", label: "White Fox", category: "Giyim", logo: "/brands/whitefox.svg", countries: ["US", "GB", "AU", "CA"] },
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
  { slug: "ohpolly", label: "Oh Polly", category: "Giyim", logo: "/brands/ohpolly.svg", countries: ["GB", "US", "AU", "IE"] },
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
  { slug: "converse", label: "Converse", category: "Ayakkabı", logo: "/brands/converse.svg", countries: ["TR", "US"] },
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
  { slug: "zappos", label: "Zappos", category: "Çok markalı", logo: "/brands/zappos.svg", countries: ["US"] },
  { slug: "altitudesports", label: "Altitude Sports", category: "Spor", logo: "/brands/altitudesports.svg", countries: ["CA"] },
  { slug: "jcrew", label: "J.Crew", category: "Giyim", logo: "/brands/jcrew.svg", countries: ["US", "CA"] },
  { slug: "madewell", label: "Madewell", category: "Giyim", logo: "/brands/madewell.svg", countries: ["US"] },
  { slug: "crocs", label: "Crocs", category: "Ayakkabı", logo: "/brands/crocs.svg", countries: ["US", "CA", "GB", "DE", "FR", "NL", "FI", "ES"] },
  { slug: "levis", label: "Levi's", category: "Giyim", logo: "/brands/levis.svg", countries: ["US", "CA", "TR"] },
  { slug: "calvinklein", label: "Calvin Klein", category: "Giyim", logo: "/brands/calvinklein.svg", countries: ["TR", "US", "AU"] },
  { slug: "tommyhilfiger", label: "Tommy Hilfiger", category: "Giyim", logo: "/brands/tommyhilfiger.svg", countries: ["TR", "US", "AU", "CA"] },
  { slug: "michaelkors", label: "Michael Kors", category: "Çanta", logo: "/brands/michaelkors.svg", countries: ["US", "CA", "GB", "CH", "AU", "DE", "FR", "IT"] },
  { slug: "columbia", label: "Columbia", category: "Spor", logo: "/brands/columbia.svg", countries: ["TR", "US", "CA"] },
  { slug: "coachoutlet", label: "Coach Outlet", category: "Çanta", logo: "/brands/coachoutlet.svg", countries: ["US", "CA"] },
  { slug: "katespadeoutlet", label: "Kate Spade Outlet", category: "Çanta", logo: "/brands/katespadeoutlet.svg", countries: ["US"] },
  { slug: "nordstromrack", label: "Nordstrom Rack", category: "Çok markalı", logo: "/brands/nordstromrack.svg", countries: ["US"] },
  { slug: "adidas", label: "adidas", category: "Ayakkabı", logo: "/brands/adidas.svg", countries: ["TR", "GB", "US", "CA", "AU", "IE", "DE", "FR", "NL", "BE", "AT", "ES", "IT", "PT", "FI", "CH", "SE", "DK", "NO", "JP", "KR", "SG", "HK", "AE", "SA", "KW"] },
  { slug: "swarovski", label: "Swarovski", category: "Takı", logo: "/brands/swarovski.svg", countries: ["TR", "US", "CA", "AU", "AE"] },
  { slug: "urbanoutfitters", label: "Urban Outfitters", category: "Giyim", logo: "/brands/urbanoutfitters.svg", countries: ["US", "CA", "GB"] },
  { slug: "freepeople", label: "Free People", category: "Giyim", logo: "/brands/freepeople.svg", countries: ["US", "GB"] },
  { slug: "anthropologie", label: "Anthropologie", category: "Giyim", logo: "/brands/anthropologie.svg", countries: ["US", "GB"] },
  { slug: "vans", label: "Vans", category: "Ayakkabı", logo: "/brands/vans.svg", countries: ["AU", "TR", "US"] },
  { slug: "athleta", label: "Athleta", category: "Spor", logo: "/brands/athleta.svg", countries: ["US", "CA"] },
  { slug: "abercrombie", label: "Abercrombie & Fitch", category: "Giyim", logo: "/brands/abercrombie.svg", countries: ["US", "CA", "GB"] },
  { slug: "hollister", label: "Hollister", category: "Giyim", logo: "/brands/hollister.svg", countries: ["US", "CA", "GB"] },
  { slug: "ulta", label: "Ulta Beauty", category: "Kozmetik", logo: "/brands/ulta.svg", countries: ["US"] },
  { slug: "skims", label: "SKIMS", category: "Giyim", logo: "/brands/skims.svg", countries: ["US", "CA", "GB", "AU", "HK", "JP", "KR", "SG"] },
  { slug: "fashionnova", label: "Fashion Nova", category: "Giyim", logo: "/brands/fashionnova.svg", countries: ["US", "CA"] },
  { slug: "aldo", label: "ALDO", category: "Ayakkabı", logo: "/brands/aldo.svg", countries: ["US", "CA", "TR"] },
  { slug: "on", label: "On", category: "Spor", logo: "/brands/on.svg", countries: ["US", "CH", "GB", "DE", "FR", "IT", "ES", "NL", "BE", "AT", "IE", "PT", "FI", "SE", "DK", "AU", "JP", "HK"] },
  { slug: "roots", label: "Roots", category: "Giyim", logo: "/brands/roots.svg", countries: ["CA"] },
  { slug: "lavieenrose", label: "La Vie en Rose", category: "İç giyim", logo: "/brands/lavieenrose.svg", countries: ["CA"] },
  { slug: "aritzia", label: "Aritzia", category: "Giyim", logo: "/brands/aritzia.svg", countries: ["US", "CA"] },
  { slug: "lululemon", label: "lululemon", category: "Spor", logo: "/brands/lululemon.svg", countries: ["US", "CA", "TR"] },
  // 2026-10-11 round 2: big brands behind bot walls (registry-intl.ts).
  { slug: "boots", label: "Boots", category: "Kozmetik", logo: "/brands/boots.svg", countries: ["GB", "AE", "SA", "KW", "IE"] },
  { slug: "uniqlo", label: "UNIQLO", category: "Giyim", logo: "/brands/uniqlo.svg", countries: ["GB", "AU", "IE", "DE", "FR", "NL", "BE", "AT", "ES", "IT", "PT", "FI", "SE", "DK"] },
  { slug: "faces", label: "FACES", category: "Kozmetik", logo: "/brands/faces.svg", countries: ["AE", "SA"] },
  { slug: "garage", label: "Garage", category: "Giyim", logo: "/brands/garage.svg", countries: ["CA"] },
  { slug: "dynamite", label: "Dynamite", category: "Giyim", logo: "/brands/dynamite.svg", countries: ["CA"] },
  { slug: "theiconic", label: "THE ICONIC", category: "Çok markalı", logo: "/brands/theiconic.svg", countries: ["AU"] },
  { slug: "glassons", label: "Glassons", category: "Giyim", logo: "/brands/glassons.svg", countries: ["AU"] },
  { slug: "hellomolly", label: "Hello Molly", category: "Giyim", logo: "/brands/hellomolly.svg", countries: ["AU", "US"] },
  { slug: "meshki", label: "MESHKI", category: "Giyim", logo: "/brands/meshki.svg", countries: ["AU"] },
  { slug: "adorebeauty", label: "Adore Beauty", category: "Kozmetik", logo: "/brands/adorebeauty.svg", countries: ["AU"] },
  { slug: "zalando", label: "Zalando", category: "Çok markalı", logo: "/brands/zalando.svg", countries: ["IE", "DE", "FR", "NL", "BE", "AT", "ES", "IT", "PT", "FI", "CH", "SE", "DK", "NO"] },
  { slug: "douglas", label: "Douglas", category: "Kozmetik", logo: "/brands/douglas.svg", countries: ["CH"] },
  { slug: "cubus", label: "Cubus", category: "Giyim", logo: "/brands/cubus.svg", countries: ["NO", "SE", "FI"] },
  { slug: "bikbok", label: "Bik Bok", category: "Giyim", logo: "/brands/bikbok.svg", countries: ["NO", "SE", "FI"] },
  { slug: "lindex", label: "Lindex", category: "Giyim", logo: "/brands/lindex.svg", countries: ["NO", "SE", "FI", "DK"] },
  { slug: "nelly", label: "Nelly", category: "Giyim", logo: "/brands/nelly.svg", countries: ["NO", "SE", "FI", "DK"] },
  { slug: "lyko", label: "Lyko", category: "Kozmetik", logo: "/brands/lyko.svg", countries: ["NO", "SE", "FI", "DK"] },
  { slug: "aivi", label: "AIVI", category: "Çok markalı", logo: "/brands/aivi.svg", countries: ["AE", "SA", "QA", "KW"] },
  { slug: "styli", label: "Styli", category: "Çok markalı", logo: "/brands/styli.svg", countries: ["AE", "SA", "QA", "KW"] },
  { slug: "centrepoint", label: "Centrepoint", category: "Çok markalı", logo: "/brands/centrepoint.svg", countries: ["AE", "SA", "QA", "KW"] },
  { slug: "maxfashion", label: "Max", category: "Giyim", logo: "/brands/maxfashion.svg", countries: ["AE", "SA", "QA", "KW"] },
  { slug: "splash", label: "Splash", category: "Giyim", logo: "/brands/splash.svg", countries: ["AE", "SA", "KW"] },
  { slug: "ounass", label: "Ounass", category: "Çok markalı", logo: "/brands/ounass.svg", countries: ["AE", "SA"] },
  { slug: "flo", label: "FLO", category: "Ayakkabı", logo: "/brands/flo.svg", countries: ["TR"] },
  { slug: "instreet", label: "In Street", category: "Spor", logo: "/brands/instreet.svg", countries: ["TR"] },
  { slug: "lumberjack", label: "Lumberjack", category: "Ayakkabı", logo: "/brands/lumberjack.svg", countries: ["TR"] },
  { slug: "kinetix", label: "Kinetix", category: "Spor", logo: "/brands/kinetix.svg", countries: ["TR"] },
  { slug: "reebok", label: "Reebok", category: "Spor", logo: "/brands/reebok.svg", countries: ["TR", "US", "CA"] },
  { slug: "kiko", label: "KIKO Milano", category: "Kozmetik", logo: "/brands/kiko.svg", countries: ["TR", "IT", "ES", "PT", "FR", "DE", "AT", "NL", "BE", "IE", "GB", "CH"] },
  { slug: "skechers", label: "Skechers", category: "Ayakkabı", logo: "/brands/skechers.svg", countries: ["TR", "US", "CA"] },
  { slug: "sneaksup", label: "Sneaks Up", category: "Spor", logo: "/brands/sneaksup.svg", countries: ["TR"] },
  { slug: "arket", label: "ARKET", category: "Giyim", logo: "/brands/arket.svg", countries: ["GB", "IE", "DE", "NL", "BE", "AT", "PT", "FI", "CH", "SE", "DK", "NO"] },
  { slug: "stories", label: "& Other Stories", category: "Giyim", logo: "/brands/stories.svg", countries: ["US", "IE", "DE", "FR", "NL", "BE", "AT", "ES", "IT", "PT", "FI", "CH", "SE", "DK", "NO", "GB"] },
  { slug: "weekday", label: "Weekday", category: "Giyim", logo: "/brands/weekday.svg", countries: ["IE", "DE", "FR", "NL", "BE", "AT", "PT", "FI", "SE", "DK", "NO"] },
  { slug: "topshop", label: "Topshop", category: "Giyim", logo: "/brands/topshop.svg", countries: ["GB"] },
  { slug: "newlook", label: "New Look", category: "Giyim", logo: "/brands/newlook.svg", countries: ["GB"] },
  { slug: "asos", label: "ASOS", category: "Çok markalı", logo: "/brands/asos.svg", countries: ["GB", "IE", "DE", "FR", "NL", "BE", "AT", "ES", "IT", "PT", "FI", "SE", "DK", "US", "CA", "AU"] },
  { slug: "next", label: "Next", category: "Giyim", logo: "/brands/next.svg", countries: ["GB"] },
  { slug: "reiss", label: "Reiss", category: "Giyim", logo: "/brands/reiss.svg", countries: ["GB"] },
  { slug: "riverisland", label: "River Island", category: "Giyim", logo: "/brands/riverisland.svg", countries: ["GB", "IE"] },
  { slug: "jdsports", label: "JD Sports", category: "Spor", logo: "/brands/jdsports.svg", countries: ["GB", "IE", "DE", "FR", "NL", "BE", "AT", "ES", "IT", "PT", "FI", "SE", "DK", "CA"] },
  { slug: "cottonon", label: "Cotton On", category: "Giyim", logo: "/brands/cottonon.svg", countries: ["AU", "SG"] },
  { slug: "showpo", label: "Showpo", category: "Giyim", logo: "/brands/showpo.svg", countries: ["AU", "US", "CA"] },
  { slug: "sportsgirl", label: "Sportsgirl", category: "Giyim", logo: "/brands/sportsgirl.svg", countries: ["AU"] },
  { slug: "jd-sports", label: "JD Sports", category: "Spor", logo: "/brands/jd-sports.svg", countries: ["AU"] },
  { slug: "dosenbach", label: "Dosenbach", category: "Ayakkabı", logo: "/brands/dosenbach.svg", countries: ["CH"] },
  { slug: "ochsnershoes", label: "Ochsner Shoes", category: "Ayakkabı", logo: "/brands/ochsnershoes.svg", countries: ["CH"] },
  { slug: "ochsnersport", label: "Ochsner Sport", category: "Spor", logo: "/brands/ochsnersport.svg", countries: ["CH"] },
  { slug: "snipes", label: "SNIPES", category: "Ayakkabı", logo: "/brands/snipes.svg", countries: ["DE", "FR", "NL", "BE", "AT", "ES", "IT", "PT", "CH"] },
  { slug: "chicoree", label: "Chicorée", category: "Giyim", logo: "/brands/chicoree.svg", countries: ["CH"] },
  { slug: "c-and-a", label: "C&A", category: "Giyim", logo: "/brands/c-and-a.svg", countries: ["DE", "FR", "NL", "BE", "AT", "ES", "CH"] },
  { slug: "manor", label: "Manor", category: "Çok markalı", logo: "/brands/manor.svg", countries: ["CH"] },
  { slug: "aboutyou", label: "About You", category: "Çok markalı", logo: "/brands/aboutyou.svg", countries: ["DE", "FR", "NL", "BE", "AT", "ES", "IT", "PT", "FI", "CH", "SE", "DK"] },
  { slug: "impo", label: "Impo", category: "Kozmetik", logo: "/brands/impo.svg", countries: ["CH"] },
  { slug: "only", label: "ONLY", category: "Giyim", logo: "/brands/only.svg", countries: ["IE", "DE", "FR", "NL", "BE", "AT", "ES", "IT", "PT", "FI", "CH", "SE", "DK", "NO"] },
  { slug: "veromoda", label: "VERO MODA", category: "Giyim", logo: "/brands/veromoda.svg", countries: ["IE", "DE", "FR", "NL", "AT", "ES", "IT", "PT", "FI", "CH", "SE", "DK", "NO"] },
  { slug: "kappahl", label: "KappAhl", category: "Giyim", logo: "/brands/kappahl.svg", countries: ["NO", "SE", "FI"] },
  { slug: "vita", label: "Vita", category: "Kozmetik", logo: "/brands/vita.svg", countries: ["NO"] },
  { slug: "xxl", label: "XXL", category: "Spor", logo: "/brands/xxl.svg", countries: ["NO", "SE", "FI"] },
  { slug: "blivakker", label: "Blivakker", category: "Kozmetik", logo: "/brands/blivakker.svg", countries: ["NO"] },
  { slug: "ginatricot", label: "Gina Tricot", category: "Giyim", logo: "/brands/ginatricot.svg", countries: ["NO", "SE", "FI", "DK", "NL", "DE", "FR", "AT", "BE", "IE"] },
  { slug: "na-kd", label: "NA-KD", category: "Giyim", logo: "/brands/na-kd.svg", countries: ["NO"] },
  { slug: "ellos", label: "Ellos", category: "Çok markalı", logo: "/brands/ellos.svg", countries: ["NO", "SE", "FI", "DK"] },
  { slug: "fredrikoglouisa", label: "Fredrik & Louisa", category: "Kozmetik", logo: "/brands/fredrikoglouisa.svg", countries: ["NO"] },
  { slug: "gullfunn", label: "Gullfunn", category: "Takı", logo: "/brands/gullfunn.svg", countries: ["NO"] },
  { slug: "bathandbodyworks", label: "Bath & Body Works", category: "Kişisel bakım", logo: "/brands/bathandbodyworks.svg", countries: ["TR", "AE", "SA", "US", "QA", "KW"] },
  { slug: "americaneagle", label: "American Eagle", category: "Giyim", logo: "/brands/americaneagle.svg", countries: ["AE", "SA", "US", "CA", "QA", "KW"] },
  { slug: "goldenscent", label: "Golden Scent", category: "Kozmetik", logo: "/brands/goldenscent.svg", countries: ["AE", "SA"] },
  { slug: "vperfumes", label: "VPerfumes", category: "Kozmetik", logo: "/brands/vperfumes.svg", countries: ["AE", "SA"] },
  { slug: "bloomingdales", label: "Bloomingdale's", category: "Çok markalı", logo: "/brands/bloomingdales.svg", countries: ["AE", "US", "KW"] },
  // US/CA, added 2026-10-18.
  { slug: "asics", label: "ASICS", category: "Ayakkabı", logo: "/brands/asics.svg", countries: ["US", "GB", "FR", "DE", "IT", "ES", "NL", "BE", "AT", "IE", "PT", "FI", "SE", "DK"] },
  { slug: "benefit", label: "Benefit", category: "Kozmetik", logo: "/brands/benefit.svg", countries: ["US"] },
  { slug: "kohls", label: "Kohl's", category: "Çok markalı", logo: "/brands/kohls.svg", countries: ["US"] },
  { slug: "patagonia", label: "Patagonia", category: "Spor", logo: "/brands/patagonia.svg", countries: ["US", "CA"] },
  { slug: "ralphlauren", label: "Ralph Lauren", category: "Giyim", logo: "/brands/ralphlauren.svg", countries: ["US", "CA"] },
  { slug: "kendrascott", label: "Kendra Scott", category: "Takı", logo: "/brands/kendrascott.svg", countries: ["US"] },
  { slug: "toryburch", label: "Tory Burch", category: "Giyim", logo: "/brands/toryburch.svg", countries: ["US", "CA"] },
  { slug: "dsw", label: "DSW", category: "Ayakkabı", logo: "/brands/dsw.svg", countries: ["US", "CA"] },
  { slug: "anntaylor", label: "Ann Taylor", category: "Giyim", logo: "/brands/anntaylor.svg", countries: ["US"] },
  { slug: "lanebryant", label: "Lane Bryant", category: "Giyim", logo: "/brands/lanebryant.svg", countries: ["US"] },
  { slug: "pacsun", label: "PacSun", category: "Giyim", logo: "/brands/pacsun.svg", countries: ["US"] },
  { slug: "birkenstock", label: "Birkenstock", category: "Ayakkabı", logo: "/brands/birkenstock.svg", countries: ["US", "CA"] },
  { slug: "torrid", label: "Torrid", category: "Giyim", logo: "/brands/torrid.svg", countries: ["US"] },
  { slug: "express", label: "Express", category: "Giyim", logo: "/brands/express.svg", countries: ["US"] },
  { slug: "marcjacobs", label: "Marc Jacobs", category: "Çanta", logo: "/brands/marcjacobs.svg", countries: ["US", "CA"] },
  { slug: "cos", label: "COS", category: "Giyim", logo: "/brands/cos.svg", countries: ["US", "GB", "CH", "NO"] },
  { slug: "joefresh", label: "Joe Fresh", category: "Giyim", logo: "/brands/joefresh.svg", countries: ["CA"] },
  { slug: "sportchek", label: "Sport Chek", category: "Spor", logo: "/brands/sportchek.svg", countries: ["CA"] },
  { slug: "marks", label: "Mark's", category: "Giyim", logo: "/brands/marks.svg", countries: ["CA"] },
  { slug: "sportinglife", label: "Sporting Life", category: "Spor", logo: "/brands/sportinglife.svg", countries: ["CA"] },
  { slug: "ssense", label: "SSENSE", category: "Çok markalı", logo: "/brands/ssense.svg", countries: ["CA"] },
  { slug: "damas", label: "Damas", category: "Takı", logo: "/brands/damas.svg", countries: ["AE"] },
  { slug: "ajmal", label: "Ajmal", category: "Kozmetik", logo: "/brands/ajmal.svg", countries: ["AE", "SA"] },
  { slug: "nahdi", label: "Nahdi", category: "Kozmetik", logo: "/brands/nahdi.svg", countries: ["AE", "SA"] },
  { slug: "calzedonia", label: "Calzedonia", category: "İç giyim", logo: "/brands/calzedonia.svg", countries: ["TR", "ES", "PT", "CH"] },
  { slug: "intimissimi", label: "Intimissimi", category: "İç giyim", logo: "/brands/intimissimi.svg", countries: ["TR", "CH"] },
  { slug: "falconeri", label: "Falconeri", category: "Giyim", logo: "/brands/falconeri.svg", countries: ["TR", "CH", "IT", "FR", "ES", "PT", "AT", "NL"] },
  { slug: "desa", label: "Desa", category: "Çanta", logo: "/brands/desa.svg", countries: ["TR"] },
  { slug: "elifstil", label: "Elifstil", category: "Giyim", logo: "/brands/elifstil.svg", countries: ["TR"] },
  { slug: "noteshop", label: "Note Cosmetics", category: "Kozmetik", logo: "/brands/noteshop.svg", countries: ["TR"] },
  { slug: "yargici", label: "Yargıcı", category: "Giyim", logo: "/brands/yargici.svg", countries: ["TR"] },
  { slug: "hotic", label: "Hotiç", category: "Ayakkabı", logo: "/brands/hotic.svg", countries: ["TR"] },
  { slug: "suwen", label: "Suwen", category: "İç giyim", logo: "/brands/suwen.svg", countries: ["TR"] },
  { slug: "haydigiy", label: "HaydiGiy", category: "Giyim", logo: "/brands/haydigiy.svg", countries: ["TR"] },
  { slug: "boohoo", label: "boohoo", category: "Giyim", logo: "/brands/boohoo.svg", countries: ["GB"] },
  { slug: "whistles", label: "Whistles", category: "Giyim", logo: "/brands/whistles.svg", countries: ["GB"] },
  { slug: "hobbs", label: "Hobbs", category: "Giyim", logo: "/brands/hobbs.svg", countries: ["GB"] },
  // EU wave 1 (2026-10-21): brands ranked by each country's own Google search demand.
  { slug: "decathlon", label: "Decathlon", category: "Spor", logo: "/brands/decathlon.svg", countries: ["TR", "DE", "FR", "NL", "BE", "AT", "ES", "IT", "PT", "SG", "GB", "CH", "AU"] },
  { slug: "intersport", label: "Intersport", category: "Spor", logo: "/brands/intersport.svg", countries: ["FR"] },
  { slug: "promod", label: "Promod", category: "Giyim", logo: "/brands/promod.svg", countries: ["FR"] },
  { slug: "undiz", label: "Undiz", category: "İç giyim", logo: "/brands/undiz.svg", countries: ["FR"] },
  { slug: "courir", label: "Courir", category: "Ayakkabı", logo: "/brands/courir.svg", countries: ["FR"] },
  { slug: "gemo", label: "Gémo", category: "Giyim", logo: "/brands/gemo.jpg", countries: ["FR"] },
  { slug: "deichmann", label: "DEICHMANN", category: "Ayakkabı", logo: "/brands/deichmann.svg", countries: ["DE", "FR", "AT", "ES", "IT", "PT", "SE", "DK"] },
  { slug: "soliver", label: "s.Oliver", category: "Giyim", logo: "/brands/soliver.svg", countries: ["DE", "AT", "CH", "NL", "BE", "FR"] },
  { slug: "tomtailor", label: "TOM TAILOR", category: "Giyim", logo: "/brands/tomtailor.svg", countries: ["DE", "AT", "CH", "NL", "BE"] },
  { slug: "newyorker", label: "NEW YORKER", category: "Giyim", logo: "/brands/newyorker.svg", countries: ["DE", "AT", "CH", "FR", "NL", "BE", "ES", "IT", "PT", "SE", "DK", "FI", "NO"] },
  { slug: "tchibo", label: "Tchibo", category: "Giyim", logo: "/brands/tchibo.svg", countries: ["DE", "AT", "CH"] },
  { slug: "bonprix", label: "bonprix", category: "Giyim", logo: "/brands/bonprix.svg", countries: ["DE", "AT", "CH", "IT", "SE", "NO", "FR", "NL", "BE"] },
  { slug: "breuninger", label: "Breuninger", category: "Çok markalı", logo: "/brands/breuninger.svg", countries: ["DE", "AT", "CH"] },
  { slug: "marcopolo", label: "Marc O'Polo", category: "Giyim", logo: "/brands/marcopolo.svg", countries: ["DE", "AT", "NL", "ES", "IT"] },
  { slug: "elcorteingles", label: "El Corte Inglés", category: "Çok markalı", logo: "/brands/elcorteingles.svg", countries: ["ES", "PT"] },
  { slug: "primor", label: "Primor", category: "Kozmetik", logo: "/brands/primor.png", countries: ["ES", "PT", "FR"] },
  { slug: "druni", label: "Druni", category: "Kozmetik", logo: "/brands/druni.svg", countries: ["ES", "PT"] },
  { slug: "parfois", label: "PARFOIS", category: "Aksesuar", logo: "/brands/parfois.jpg", countries: ["IE", "DE", "FR", "NL", "BE", "AT", "ES", "IT", "PT", "FI"] },
  { slug: "womensecret", label: "women'secret", category: "İç giyim", logo: "/brands/womensecret.svg", countries: ["ES", "PT"] },
  { slug: "springfield", label: "Springfield", category: "Giyim", logo: "/brands/springfield.svg", countries: ["ES", "PT"] },
  { slug: "cortefiel", label: "Cortefiel", category: "Giyim", logo: "/brands/cortefiel.svg", countries: ["ES", "PT"] },
  { slug: "sprinter", label: "Sprinter", category: "Spor", logo: "/brands/sprinter.svg", countries: ["ES", "PT"] },
  { slug: "sfera", label: "sfera", category: "Giyim", logo: "/brands/sfera.svg", countries: ["ES"] },
  { slug: "tous", label: "TOUS", category: "Takı", logo: "/brands/tous.svg", countries: ["ES", "PT"] },
  { slug: "bimbaylola", label: "BIMBA Y LOLA", category: "Çanta", logo: "/brands/bimbaylola.svg", countries: ["ES", "PT"] },
  { slug: "scalpers", label: "Scalpers", category: "Giyim", logo: "/brands/scalpers.svg", countries: ["ES", "PT"] },
  // Wave 2 (2026-10-21): Netherlands/Belgium, Ireland, Nordics, Italy. Same rules: runner-verified, no proxy, real strike prices only.
  { slug: "kruidvat", label: "Kruidvat", category: "Kozmetik", logo: "/brands/kruidvat.svg", countries: ["NL", "BE"] },
  { slug: "rituals", label: "Rituals", category: "Kozmetik", logo: "/brands/rituals.svg", countries: ["NL", "BE", "DE", "AT", "FR", "ES", "IT", "PT", "IE", "FI", "SE", "DK", "GB", "CH", "NO"] },
  { slug: "hunkemoller", label: "Hunkemöller", category: "İç giyim", logo: "/brands/hunkemoller.svg", countries: ["NL", "BE", "DE", "AT", "FR", "ES", "CH", "SE", "NO", "DK"] },
  { slug: "wefashion", label: "WE Fashion", category: "Giyim", logo: "/brands/wefashion.svg", countries: ["NL", "BE"] },
  { slug: "jbc", label: "JBC", category: "Giyim", logo: "/brands/jbc.svg", countries: ["BE"] },
  { slug: "scapino", label: "Scapino", category: "Ayakkabı", logo: "/brands/scapino.png", countries: ["NL"] },
  { slug: "onlyandsons", label: "ONLY & SONS", category: "Giyim", logo: "/brands/onlyandsons.png", countries: ["NL", "BE"] },
  { slug: "elverys", label: "Intersport Elverys", category: "Spor", logo: "/brands/elverys.svg", countries: ["IE"] },
  { slug: "brownthomas", label: "Brown Thomas", category: "Mağaza", logo: "/brands/brownthomas.svg", countries: ["IE"] },
  { slug: "arnotts", label: "Arnotts", category: "Mağaza", logo: "/brands/arnotts.svg", countries: ["IE"] },
  { slug: "dunnes", label: "Dunnes Stores", category: "Mağaza", logo: "/brands/dunnes.svg", countries: ["IE"] },
  { slug: "jackjones", label: "JACK & JONES", category: "Giyim", logo: "/brands/jackjones.svg", countries: ["IE", "DE", "FR", "NL", "AT", "ES", "IT", "PT", "FI", "CH", "SE", "DK", "NO"] },
  { slug: "vila", label: "VILA", category: "Giyim", logo: "/brands/vila.png", countries: ["SE", "FI", "DK"] },
  { slug: "pieces", label: "PIECES", category: "Giyim", logo: "/brands/pieces.png", countries: ["SE", "FI", "DK"] },
  { slug: "stadium", label: "Stadium", category: "Spor", logo: "/brands/stadium.svg", countries: ["SE", "FI"] },
  { slug: "ahlens", label: "Åhléns", category: "Mağaza", logo: "/brands/ahlens.svg", countries: ["SE"] },
  { slug: "apotea", label: "Apotea", category: "Kozmetik", logo: "/brands/apotea.png", countries: ["SE"] },
  { slug: "stockmann", label: "Stockmann", category: "Mağaza", logo: "/brands/stockmann.svg", countries: ["FI"] },
  { slug: "matas", label: "Matas", category: "Kozmetik", logo: "/brands/matas.svg", countries: ["DK"] },
  { slug: "magasin", label: "Magasin du Nord", category: "Mağaza", logo: "/brands/magasin.svg", countries: ["DK"] },
  { slug: "ovs", label: "OVS", category: "Giyim", logo: "/brands/ovs.svg", countries: ["IT"] },
  { slug: "tigota", label: "Tigotà", category: "Kozmetik", logo: "/brands/tigota.svg", countries: ["IT"] },
  { slug: "yamamay", label: "Yamamay", category: "İç giyim", logo: "/brands/yamamay.svg", countries: ["IT"] },
  { slug: "benetton", label: "United Colors of Benetton", category: "Giyim", logo: "/brands/benetton.svg", countries: ["IT"] },
  { slug: "sisley", label: "Sisley", category: "Giyim", logo: "/brands/sisley.svg", countries: ["IT"] },
  { slug: "terranova", label: "Terranova", category: "Giyim", logo: "/brands/terranova.png", countries: ["IT"] },
  { slug: "calliope", label: "Calliope", category: "Giyim", logo: "/brands/calliope.svg", countries: ["IT"] },
  { slug: "pittarosso", label: "PittaRosso", category: "Ayakkabı", logo: "/brands/pittarosso.png", countries: ["IT"] },
  { slug: "motivi", label: "Motivi", category: "Giyim", logo: "/brands/motivi.png", countries: ["IT"] },
  // Wave 3 (2026-10-21): Japan and South Korea (names stay in the local language).
  { slug: "honeys", label: "Honeys", category: "Giyim", logo: "/brands/honeys.svg", countries: ["JP"] },
  { slug: "earthmusic", label: "earth music&ecology", category: "Giyim", logo: "/brands/earthmusic.png", countries: ["JP"] },
  { slug: "globalwork", label: "GLOBAL WORK", category: "Giyim", logo: "/brands/globalwork.svg", countries: ["JP"] },
  { slug: "musinsa", label: "MUSINSA", category: "Çok markalı", logo: "/brands/musinsa.png", countries: ["KR"] },
  { slug: "29cm", label: "29CM", category: "Çok markalı", logo: "/brands/29cm.png", countries: ["KR"] },
  { slug: "wconcept", label: "W Concept", category: "Çok markalı", logo: "/brands/wconcept.svg", countries: ["KR"] },
  { slug: "spao", label: "SPAO", category: "Giyim", logo: "/brands/spao.png", countries: ["KR"] },
  { slug: "topten", label: "TOPTEN", category: "Giyim", logo: "/brands/topten.png", countries: ["KR"] },
  { slug: "8seconds", label: "8seconds", category: "Giyim", logo: "/brands/8seconds.png", countries: ["KR"] },
  // Singapore and Hong Kong (2026-10-21).
  { slug: "charleskeith", label: "CHARLES & KEITH", category: "Çanta", logo: "/brands/charleskeith.svg", countries: ["SG", "HK", "AE", "SA", "QA", "KW", "AU", "KR"] },
  { slug: "pedro", label: "PEDRO", category: "Ayakkabı", logo: "/brands/pedro.svg", countries: ["SG"] },
  { slug: "lovebonito", label: "Love, Bonito", category: "Giyim", logo: "/brands/lovebonito.svg", countries: ["SG", "HK"] },
  { slug: "mannings", label: "Mannings", category: "Kozmetik", logo: "/brands/mannings.png", countries: ["HK"] },
  { slug: "guardian", label: "Guardian", category: "Kozmetik", logo: "/brands/guardian.png", countries: ["SG"] },
  // US / Canada (2026-10-21)
  { slug: "eddiebauer", label: "Eddie Bauer", category: "Giyim", logo: "/brands/eddiebauer.svg", countries: ["US", "CA"] },
  { slug: "ninewest", label: "Nine West", category: "Ayakkabı", logo: "/brands/ninewest.png", countries: ["US", "CA"] },
  { slug: "tuckernuck", label: "Tuckernuck", category: "Giyim", logo: "/brands/tuckernuck.png", countries: ["US"] },
  { slug: "dollskill", label: "Dolls Kill", category: "Giyim", logo: "/brands/dollskill.svg", countries: ["US", "CA"] },
  { slug: "charlotterusse", label: "Charlotte Russe", category: "Giyim", logo: "/brands/charlotterusse.png", countries: ["US"] },
  { slug: "marinelayer", label: "Marine Layer", category: "Giyim", logo: "/brands/marinelayer.svg", countries: ["US"] },
  { slug: "petalandpup", label: "Petal & Pup", category: "Giyim", logo: "/brands/petalandpup.svg", countries: ["US", "CA"] },
  { slug: "motelrocks", label: "Motel Rocks", category: "Giyim", logo: "/brands/motelrocks.png", countries: ["US", "CA"] },
  { slug: "goodamerican", label: "Good American", category: "Giyim", logo: "/brands/goodamerican.svg", countries: ["US", "CA"] },
  { slug: "calpak", label: "Calpak", category: "Çanta", logo: "/brands/calpak.svg", countries: ["US", "CA"] },
  { slug: "sperry", label: "Sperry", category: "Ayakkabı", logo: "/brands/sperry.svg", countries: ["US", "CA"] },
  { slug: "betseyjohnson", label: "Betsey Johnson", category: "Çanta", logo: "/brands/betseyjohnson.png", countries: ["US"] },
  { slug: "cupshe", label: "Cupshe", category: "Giyim", logo: "/brands/cupshe.png", countries: ["US", "CA"] },
  { slug: "merrell", label: "Merrell", category: "Ayakkabı", logo: "/brands/merrell.png", countries: ["US", "CA"] },
  { slug: "everlane", label: "Everlane", category: "Giyim", logo: "/brands/everlane.png", countries: ["US", "CA"] },
  { slug: "spanx", label: "Spanx", category: "İç giyim", logo: "/brands/spanx.svg", countries: ["US", "CA"] },
  { slug: "boden", label: "Boden", category: "Giyim", logo: "/brands/boden.svg", countries: ["US"] },
  { slug: "beyondyoga", label: "Beyond Yoga", category: "Spor", logo: "/brands/beyondyoga.svg", countries: ["US", "CA"] },
  { slug: "faherty", label: "Faherty", category: "Giyim", logo: "/brands/faherty.svg", countries: ["US", "CA"] },
  { slug: "alexandani", label: "Alex and Ani", category: "Takı", logo: "/brands/alexandani.svg", countries: ["US", "CA"] },
  { slug: "vici", label: "VICI", category: "Giyim", logo: "/brands/vici.svg", countries: ["US"] },
  { slug: "away", label: "Away", category: "Çanta", logo: "/brands/away.svg", countries: ["US"] },
  { slug: "vuori", label: "Vuori", category: "Spor", logo: "/brands/vuori.png", countries: ["US", "CA"] },
  { slug: "colehaan", label: "Cole Haan", category: "Ayakkabı", logo: "/brands/colehaan.svg", countries: ["US"] },
  { slug: "toms", label: "TOMS", category: "Ayakkabı", logo: "/brands/toms.svg", countries: ["US"] },
  { slug: "rothys", label: "Rothy's", category: "Ayakkabı", logo: "/brands/rothys.png", countries: ["US", "CA"] },
  { slug: "champion", label: "Champion", category: "Spor", logo: "/brands/champion.png", countries: ["US"] },
  { slug: "verabradley", label: "Vera Bradley", category: "Çanta", logo: "/brands/verabradley.png", countries: ["US"] },
  { slug: "dooney", label: "Dooney & Bourke", category: "Çanta", logo: "/brands/dooney.png", countries: ["US"] },
  { slug: "setactive", label: "Set Active", category: "Spor", logo: "/brands/setactive.png", countries: ["US"] },
  { slug: "allbirds", label: "Allbirds", category: "Ayakkabı", logo: "/brands/allbirds.svg", countries: ["US"] },
  { slug: "baublebar", label: "BaubleBar", category: "Takı", logo: "/brands/baublebar.svg", countries: ["US"] },
  { slug: "fentybeauty", label: "Fenty Beauty", category: "Kozmetik", logo: "/brands/fentybeauty.svg", countries: ["US", "CA"] },
  { slug: "tarte", label: "tarte", category: "Kozmetik", logo: "/brands/tarte.png", countries: ["US", "CA"] },
  { slug: "bluemercury", label: "Bluemercury", category: "Kozmetik", logo: "/brands/bluemercury.svg", countries: ["US"] },
  { slug: "colourpop", label: "ColourPop", category: "Kozmetik", logo: "/brands/colourpop.svg", countries: ["US"] },
  { slug: "bareminerals", label: "bareMinerals", category: "Kozmetik", logo: "/brands/bareminerals.png", countries: ["US"] },
  { slug: "shoecarnival", label: "Shoe Carnival", category: "Ayakkabı", logo: "/brands/shoecarnival.png", countries: ["US"] },
  { slug: "hottopic", label: "Hot Topic", category: "Giyim", logo: "/brands/hottopic.svg", countries: ["US"] },
  { slug: "ariat", label: "Ariat", category: "Ayakkabı", logo: "/brands/ariat.png", countries: ["US"] },
  { slug: "vineyardvines", label: "Vineyard Vines", category: "Giyim", logo: "/brands/vineyardvines.svg", countries: ["US"] },
  { slug: "ragandbone", label: "rag & bone", category: "Giyim", logo: "/brands/ragandbone.svg", countries: ["US"] },
  { slug: "heydude", label: "HEYDUDE", category: "Ayakkabı", logo: "/brands/heydude.png", countries: ["US", "CA"] },
  { slug: "saucony", label: "Saucony", category: "Ayakkabı", logo: "/brands/saucony.svg", countries: ["US", "CA"] },
  { slug: "bootbarn", label: "Boot Barn", category: "Ayakkabı", logo: "/brands/bootbarn.png", countries: ["US"] },
  { slug: "talbots", label: "Talbots", category: "Giyim", logo: "/brands/talbots.svg", countries: ["US"] },
  { slug: "sallybeauty", label: "Sally Beauty", category: "Kozmetik", logo: "/brands/sallybeauty.svg", countries: ["US"] },
  { slug: "michaelhill", label: "Michael Hill", category: "Takı", logo: "/brands/michaelhill.svg", countries: ["CA"] },
  { slug: "rickis", label: "Ricki's", category: "Giyim", logo: "/brands/rickis.png", countries: ["CA"] },
  { slug: "nordstrom", label: "Nordstrom", category: "Mağaza", logo: "/brands/nordstrom.svg", countries: ["US"] },
  { slug: "boscovs", label: "Boscov's", category: "Mağaza", logo: "/brands/boscovs.svg", countries: ["US"] },
  { slug: "footlocker", label: "Foot Locker", category: "Ayakkabı", logo: "/brands/footlocker.svg", countries: ["US", "CA"] },
  { slug: "champssports", label: "Champs Sports", category: "Ayakkabı", logo: "/brands/champssports.svg", countries: ["US"] },
  { slug: "rackroom", label: "Rack Room Shoes", category: "Ayakkabı", logo: "/brands/rackroom.svg", countries: ["US"] },
  { slug: "journeys", label: "Journeys", category: "Ayakkabı", logo: "/brands/journeys.png", countries: ["US", "CA"] },
  { slug: "softmoc", label: "SoftMoc", category: "Ayakkabı", logo: "/brands/softmoc.png", countries: ["CA"] },
  { slug: "academy", label: "Academy Sports", category: "Spor", logo: "/brands/academy.svg", countries: ["US"] },
  { slug: "zumiez", label: "Zumiez", category: "Çok markalı", logo: "/brands/zumiez.png", countries: ["US", "CA"] },
  { slug: "shopbop", label: "Shopbop", category: "Çok markalı", logo: "/brands/shopbop.png", countries: ["US", "CA"] },
  { slug: "sixpm", label: "6pm", category: "Çok markalı", logo: "/brands/sixpm.png", countries: ["US"] },
  { slug: "boathouse", label: "Boathouse", category: "Çok markalı", logo: "/brands/boathouse.png", countries: ["CA"] },
  { slug: "penningtons", label: "Penningtons", category: "Giyim", logo: "/brands/penningtons.svg", countries: ["CA"] },
  { slug: "callitspring", label: "Call It Spring", category: "Ayakkabı", logo: "/brands/callitspring.svg", countries: ["CA"] },
  { slug: "rwco", label: "RW&CO", category: "Giyim", logo: "/brands/rwco.svg", countries: ["CA"] },
  { slug: "oakandfort", label: "Oak + Fort", category: "Giyim", logo: "/brands/oakandfort.svg", countries: ["CA"] },
  { slug: "frankandoak", label: "Frank And Oak", category: "Giyim", logo: "/brands/frankandoak.svg", countries: ["CA"] },
  { slug: "kotn", label: "Kotn", category: "Giyim", logo: "/brands/kotn.svg", countries: ["CA"] },
  { slug: "rudsak", label: "Rudsak", category: "Giyim", logo: "/brands/rudsak.svg", countries: ["CA"] },
  { slug: "mackage", label: "Mackage", category: "Giyim", logo: "/brands/mackage.png", countries: ["CA"] },
  { slug: "kitandace", label: "Kit and Ace", category: "Giyim", logo: "/brands/kitandace.svg", countries: ["CA"] },
  { slug: "urbanplanet", label: "Urban Planet", category: "Giyim", logo: "/brands/urbanplanet.png", countries: ["CA"] },
  { slug: "bikinivillage", label: "Bikini Village", category: "İç giyim", logo: "/brands/bikinivillage.png", countries: ["CA"] },
  { slug: "northernreflections", label: "Northern Reflections", category: "Giyim", logo: "/brands/northernreflections.png", countries: ["CA"] },
  { slug: "lulus", label: "Lulus", category: "Giyim", logo: "/brands/lulus.png", countries: ["US"] },
  { slug: "chicos", label: "Chico's", category: "Giyim", logo: "/brands/chicos.svg", countries: ["US"] },
  { slug: "whitehouseblackmarket", label: "White House Black Market", category: "Giyim", logo: "/brands/whitehouseblackmarket.png", countries: ["US"] },
  { slug: "arcteryx", label: "Arc'teryx", category: "Spor", logo: "/brands/arcteryx.svg", countries: ["US", "CA"] },
  { slug: "jjill", label: "J.Jill", category: "Giyim", logo: "/brands/jjill.svg", countries: ["US"] },
  { slug: "clarks", label: "Clarks", category: "Ayakkabı", logo: "/brands/clarks.svg", countries: ["US", "CA"] },
  { slug: "adoreme", label: "Adore Me", category: "İç giyim", logo: "/brands/adoreme.svg", countries: ["US"] },
  { slug: "veja", label: "VEJA", category: "Ayakkabı", logo: "/brands/veja.png", countries: ["US", "CA"] },
  { slug: "quay", label: "QUAY", category: "Aksesuar", logo: "/brands/quay.png", countries: ["US"] },
  // Rest of the world (2026-10-21)
  { slug: "tezenis", label: "Tezenis", category: "İç giyim", logo: "/brands/tezenis.svg", countries: ["ES"] },
  { slug: "pedrodelhierro", label: "Pedro del Hierro", category: "Giyim", logo: "/brands/pedrodelhierro.svg", countries: ["ES", "PT"] },
  { slug: "dressmann", label: "Dressmann", category: "Giyim", logo: "/brands/dressmann.png", countries: ["NO", "SE", "FI"] },
  { slug: "volt", label: "Volt", category: "Giyim", logo: "/brands/volt.svg", countries: ["NO", "FI"] },
  { slug: "shoemart", label: "Shoemart", category: "Ayakkabı", logo: "/brands/shoemart.svg", countries: ["AE"] },
  { slug: "nikoand", label: "niko and ...", category: "Giyim", logo: "/brands/nikoand.svg", countries: ["JP"] },
  { slug: "lowrysfarm", label: "LOWRYS FARM", category: "Giyim", logo: "/brands/lowrysfarm.svg", countries: ["JP"] },
  { slug: "studioclip", label: "studio CLIP", category: "Giyim", logo: "/brands/studioclip.svg", countries: ["JP"] },
  { slug: "nanouniverse", label: "nano・universe", category: "Giyim", logo: "/brands/nanouniverse.svg", countries: ["JP"] },
  { slug: "lepsim", label: "LEPSIM", category: "Giyim", logo: "/brands/lepsim.svg", countries: ["JP"] },
  { slug: "bayflow", label: "BAYFLOW", category: "Giyim", logo: "/brands/bayflow.svg", countries: ["JP"] },
  { slug: "jeanasis", label: "JEANASIS", category: "Giyim", logo: "/brands/jeanasis.svg", countries: ["JP"] },
  { slug: "rageblue", label: "RAGEBLUE", category: "Giyim", logo: "/brands/rageblue.png", countries: ["JP"] },
  { slug: "heather", label: "Heather", category: "Giyim", logo: "/brands/heather.svg", countries: ["JP"] },
  { slug: "apartbylowrys", label: "apart by lowrys", category: "Giyim", logo: "/brands/apartbylowrys.png", countries: ["JP"] },
  { slug: "lakole", label: "LAKOLE", category: "Giyim", logo: "/brands/lakole.svg", countries: ["JP"] },
  { slug: "azulbymoussy", label: "AZUL BY MOUSSY", category: "Giyim", logo: "/brands/azulbymoussy.png", countries: ["JP"] },
  { slug: "musinsastandard", label: "MUSINSA STANDARD", category: "Giyim", logo: "/brands/musinsastandard.png", countries: ["KR"] },
  { slug: "mixxo", label: "MIXXO", category: "Giyim", logo: "/brands/mixxo.png", countries: ["KR"] },
  { slug: "whoau", label: "WHO.A.U", category: "Giyim", logo: "/brands/whoau.png", countries: ["KR"] },
  { slug: "andar", label: "andar", category: "Spor", logo: "/brands/andar.png", countries: ["KR"] },
  { slug: "matinkim", label: "Matin Kim", category: "Giyim", logo: "/brands/matinkim.png", countries: ["KR"] },
  { slug: "thisisneverthat", label: "thisisneverthat", category: "Giyim", logo: "/brands/thisisneverthat.png", countries: ["KR"] },
  { slug: "trenery", label: "Trenery", category: "Giyim", logo: "/brands/trenery.svg", countries: ["AU"] },
  { slug: "platypus", label: "Platypus", category: "Ayakkabı", logo: "/brands/platypus.png", countries: ["AU"] },
  // Re-added 2026-10-21 (dropped 10-11 only for the old 30-brand cap; re-verified).
  { slug: "karenmillen", label: "Karen Millen", category: "Giyim", logo: "/brands/karenmillen.svg", countries: ["GB"] },
  { slug: "phase-eight", label: "Phase Eight", category: "Giyim", logo: "/brands/phase-eight.svg", countries: ["GB"] },
  { slug: "sweatybetty", label: "Sweaty Betty", category: "Spor", logo: "/brands/sweatybetty.svg", countries: ["GB"] },
  { slug: "spacenk", label: "Space NK", category: "Kozmetik", logo: "/brands/spacenk.svg", countries: ["GB"] },
  { slug: "neverfullydressed", label: "Never Fully Dressed", category: "Giyim", logo: "/brands/neverfullydressed.svg", countries: ["GB"] },
  { slug: "lounge", label: "Lounge", category: "İç giyim", logo: "/brands/lounge.svg", countries: ["GB"] },
  { slug: "tigerlily", label: "Tigerlily", category: "Mayo", logo: "/brands/tigerlily.svg", countries: ["AU"] },
  { slug: "lovisa", label: "Lovisa", category: "Takı", logo: "/brands/lovisa.svg", countries: ["AU"] },
  { slug: "spell", label: "Spell", category: "Giyim", logo: "/brands/spell.svg", countries: ["AU"] },
  { slug: "billini", label: "Billini", category: "Ayakkabı", logo: "/brands/billini.svg", countries: ["AU"] },
  { slug: "seed", label: "Seed Heritage", category: "Giyim", logo: "/brands/seed.svg", countries: ["AU"] },
  { slug: "wittner", label: "Wittner", category: "Ayakkabı", logo: "/brands/wittner.svg", countries: ["AU"] },
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

/** A brand name reduced to letters and digits: "Pull&Bear" and "pull & bear" → "pullbear". */
const brandKey = (s: string): string =>
  s
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" })[c] ?? c)
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
const SLUGS = new Set(BRANDS.map((b) => b.slug));
const BY_KEY = new Map<string, string>();
for (const b of BRANDS) {
  BY_KEY.set(b.slug, b.slug);
  if (!BY_KEY.has(brandKey(b.label))) BY_KEY.set(brandKey(b.label), b.slug);
}

/**
 * A `brand`/`brands` query value as slugs (owner 2026-10-22: "when I filter by
 * brands it doesn't show"). `brand=zara,adidas` answered 0 — the comma list
 * was compared to the column as one string — and so did `brand=ZARA` or
 * `brand=H%26M`, a label where a slug belongs. Splits on commas, maps a label
 * or any casing to its slug, and keeps an unknown value lowercased, so a
 * filter on a brand we do not carry still finds nothing rather than vanishing
 * into the unfiltered feed.
 */
export function toBrandSlugs(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const v = part.trim();
    if (!v || v === "all") continue;
    // An exact slug wins before the letters-only key: "jd-sports" (AU) and
    // "jdsports" (Europe/CA) share the key "jdsports", and mapping the AU slug
    // to the other one emptied JD Sports AU's brand page (2026-10-22).
    const lower = v.toLowerCase();
    const slug = SLUGS.has(lower) ? lower : BY_KEY.get(brandKey(v)) ?? BY_KEY.get(brandKey(v.replace(/&/g, ""))) ?? lower;
    if (!out.includes(slug)) out.push(slug);
  }
  return out;
}
