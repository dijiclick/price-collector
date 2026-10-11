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
}

export const SHOPIFY_STORES: ShopifySite[] = [
  // United States
  { brand: "rarebeauty", sites: { US: "https://www.rarebeauty.com" } },
  { brand: "aloyoga", sites: { US: "https://www.aloyoga.com" } },
  { brand: "princesspolly", sites: { US: "https://us.princesspolly.com", AU: "https://www.princesspolly.com.au" }, defaultGender: "kadin" },
  { brand: "stevemadden", sites: { US: "https://www.stevemadden.com" } },
  { brand: "glossier", sites: { US: "https://www.glossier.com" } },
  // Canada
  { brand: "ardene", sites: { CA: "https://www.ardene.com" }, defaultGender: "kadin" },
  { brand: "lasenza", sites: { CA: "https://www.lasenza.com" }, defaultGender: "kadin" },
  { brand: "knix", sites: { CA: "https://knix.ca" }, defaultGender: "kadin" },
  { brand: "reitmans", sites: { CA: "https://www.reitmans.com" }, defaultGender: "kadin" },
  { brand: "suzyshier", sites: { CA: "https://www.suzyshier.com" }, defaultGender: "kadin" },
  { brand: "laura", sites: { CA: "https://www.laura.ca" }, defaultGender: "kadin" },
  // United Kingdom
  { brand: "ohpolly", sites: { GB: "https://www.ohpolly.com" }, defaultGender: "kadin" },
  // Australia
  { brand: "kookai", sites: { AU: "https://www.kookai.com.au" }, defaultGender: "kadin" },
  { brand: "whitefox", sites: { AU: "https://whitefoxboutique.com.au" }, defaultGender: "kadin" },
  { brand: "dissh", sites: { AU: "https://www.dissh.com.au" }, defaultGender: "kadin" },
  { brand: "mimco", sites: { AU: "https://www.mimco.com.au" }, defaultGender: "kadin" },
  { brand: "peppermayo", sites: { AU: "https://www.peppermayo.com" }, defaultGender: "kadin" },
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
