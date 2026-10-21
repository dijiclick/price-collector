/**
 * Every Shopify storefront we collect, with its site per market — shared by the
 * collector (packages/collector/src/brands/shopify-stores.ts) and the pasted-
 * link resolver (./shopify.ts). Selection: docs/brand-plan-2026-10-11.md. Each
 * site answered a GitHub runner with an open `/products.json`, and its
 * `/meta.json` currency matched the market it is listed for (2026-10-11).
 * Tony Bianco was dropped: its AU store prices in USD.
 */
import type { CountryCode } from "../countries";

export interface ShopifySite {
  brand: string;
  /** Storefront origin per market; each must price in that market's currency. */
  sites: Partial<Record<CountryCode, string>>;
  /** Women-only labels: rows with no gender signal default to this. */
  defaultGender?: "kadin" | "erkek" | "cocuk" | null;
  maxProducts?: number;
  /**
   * Title/type pattern for rows to leave out of the feed: gift sets whose
   * compare-at is the sum of the parts ("worth $284"), not a markdown.
   */
  skipTitle?: RegExp;
}

export const SHOPIFY_STORES: ShopifySite[] = [
  // United States
  { brand: "rarebeauty", sites: { US: "https://www.rarebeauty.com" } },
  { brand: "aloyoga", sites: { US: "https://www.aloyoga.com" } },
  { brand: "princesspolly", sites: { US: "https://us.princesspolly.com", AU: "https://www.princesspolly.com.au" }, defaultGender: "kadin" },
  { brand: "stevemadden", sites: { US: "https://www.stevemadden.com", CA: "https://www.stevemadden.ca", GB: "https://www.stevemadden.co.uk", AU: "https://www.stevemadden.com.au" } },
  // Added 2026-10-12 (US/CA push): every site priced in its market's currency, sales live.
  { brand: "gymshark", sites: { US: "https://us.shop.gymshark.com", CA: "https://ca.shop.gymshark.com", AU: "https://au.shop.gymshark.com", CH: "https://ch.shop.gymshark.com",
    DE: "https://de.shop.gymshark.com", FR: "https://fr.shop.gymshark.com", NL: "https://nl.shop.gymshark.com", SE: "https://se.shop.gymshark.com", DK: "https://dk.shop.gymshark.com",
    IE: "https://eu.shop.gymshark.com", ES: "https://eu.shop.gymshark.com", IT: "https://eu.shop.gymshark.com", BE: "https://eu.shop.gymshark.com", AT: "https://eu.shop.gymshark.com", PT: "https://eu.shop.gymshark.com", FI: "https://eu.shop.gymshark.com" } },
  { brand: "scalpers", sites: { ES: "https://scalperscompany.com" } },
  { brand: "whitefox", sites: { US: "https://www.whitefoxboutique.com", GB: "https://www.whitefoxboutique.co.uk", AU: "https://www.whitefoxboutique.com.au" }, defaultGender: "kadin" },
  { brand: "dolcevita", sites: { US: "https://www.dolcevita.com", CA: "https://www.dolcevita.ca" }, defaultGender: "kadin" },
  { brand: "psychobunny", sites: { US: "https://www.psychobunny.com", CA: "https://www.psychobunny.ca" }, defaultGender: "erkek" },
  { brand: "herschel", sites: { US: "https://www.herschel.com", CA: "https://www.herschel.ca" } },
  { brand: "forever21", sites: { US: "https://www.forever21.com" } },
  { brand: "vincecamuto", sites: { US: "https://www.vincecamuto.com" }, defaultGender: "kadin" },
  { brand: "windsor", sites: { US: "https://www.windsorstore.com" }, defaultGender: "kadin" },
  { brand: "kyliecosmetics", sites: { US: "https://www.kyliecosmetics.com" } },
  { brand: "brownsshoes", sites: { CA: "https://www.brownsshoes.com" } },
  { brand: "glossier", sites: { US: "https://www.glossier.com" } },
  // Added 2026-10-18 (US/CA round): each answered a GitHub runner (probe runs
  // 39134646969 + 39134867271, no proxy) with /meta.json in USD/CAD, and the
  // runner's /variants/<id>.json price matched products.json.
  // Fenty: half its discounted rows are value sets priced against the parts.
  { brand: "fentybeauty", sites: { US: "https://fentybeauty.com" }, skipTitle: /\b(sets?|duo|trio|kits?|vault|bundle|advent|value|\d+-piece)\b|^testing\b/i },
  { brand: "baublebar", sites: { US: "https://www.baublebar.com" }, defaultGender: "kadin" },
  // Verified the same day, not in lib/brands.ts yet (inert until listed there).
  { brand: "petalandpup", sites: { US: "https://petalandpup.com" }, defaultGender: "kadin" },
  { brand: "goodamerican", sites: { US: "https://www.goodamerican.com" }, defaultGender: "kadin" },
  // Canada
  { brand: "ardene", sites: { CA: "https://www.ardene.com" }, defaultGender: "kadin" },
  { brand: "lasenza", sites: { CA: "https://www.lasenza.com" }, defaultGender: "kadin" },
  { brand: "knix", sites: { CA: "https://knix.ca" }, defaultGender: "kadin" },
  { brand: "reitmans", sites: { CA: "https://www.reitmans.com" }, defaultGender: "kadin" },
  { brand: "suzyshier", sites: { CA: "https://www.suzyshier.com" }, defaultGender: "kadin" },
  { brand: "laura", sites: { CA: "https://www.laura.ca" }, defaultGender: "kadin" },
  // Added 2026-10-18, same runner checks. Bluenotes (YM Inc) left out: 99% of
  // its catalogue carries a compare-at, mostly a flat 40% — a standing promo.
  { brand: "penningtons", sites: { CA: "https://www.penningtons.com" }, defaultGender: "kadin" },
  { brand: "frankandoak", sites: { CA: "https://www.frankandoak.com" } },
  { brand: "callitspring", sites: { CA: "https://www.callitspring.com" } },
  // United Kingdom
  // US sites (2026-10-18, runner-verified) run only once lib/brands.ts lists US.
  { brand: "ohpolly", sites: { GB: "https://www.ohpolly.com", US: "https://us.ohpolly.com" }, defaultGender: "kadin" },
  // Australia
  { brand: "kookai", sites: { AU: "https://www.kookai.com.au" }, defaultGender: "kadin" },
  { brand: "dissh", sites: { AU: "https://www.dissh.com.au" }, defaultGender: "kadin" },
  { brand: "mimco", sites: { AU: "https://www.mimco.com.au" }, defaultGender: "kadin" },
  { brand: "peppermayo", sites: { AU: "https://www.peppermayo.com", US: "https://us.peppermayo.com" }, defaultGender: "kadin" },
  { brand: "beginningboutique", sites: { AU: "https://www.beginningboutique.com.au" }, defaultGender: "kadin" },
  { brand: "decjuba", sites: { AU: "https://www.decjuba.com.au" }, defaultGender: "kadin" },
  { brand: "universalstore", sites: { AU: "https://www.universalstore.com" } },
  { brand: "seafolly", sites: { AU: "https://seafolly.com" }, defaultGender: "kadin" },
  { brand: "pe-nation", sites: { AU: "https://www.pe-nation.com" }, defaultGender: "kadin" },
  { brand: "forevernew", sites: { AU: "https://www.forevernew.com.au" }, defaultGender: "kadin" },
  { brand: "countryroad", sites: { AU: "https://www.countryroad.com.au" } },
  // Turkey
  { brand: "dagi", sites: { TR: "https://www.dagi.com.tr" } },
];
