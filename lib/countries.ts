/**
 * Which countries Modadrop serves, in ONE place.
 *
 * Turkey used to be a constant baked into four layers — adapter store ids, the
 * `(brand, external_id)` key, `PRICE_CLAUSE` in `lib/db.ts`, and `₺` in 46
 * screens. This module is the parameter that replaces it, so opening a market
 * is an entry here plus that market's adapter work, not a refactor.
 *
 * NO PLATFORM IMPORTS. The mobile app imports this (via `lib/format.ts` and
 * `lib/brands.ts`), and one Node-only import here would make Metro try to
 * bundle `node:events` and kill every `expo export` — the exact failure
 * `lib/scan-url.ts` exists to avoid. Keep it pure data and pure functions.
 */

export interface CountryInfo {
  /** ISO 4217 code, stored on `products.currency` and returned on every Deal. */
  currency: string;
  /** What a price is printed with. "AED" is a symbol here: the Gulf has no glyph. */
  symbol: string;
  /** False would put the symbol after the number (no launch country needs it). */
  symbolBefore: boolean;
  /**
   * Which residential exit to leave from. A Turkish shop answered from a German
   * IP is the request most likely to be challenged or served another locale.
   */
  proxyExit: string;
  /**
   * The junk-price floor, in MINOR units of this country's currency.
   *
   * `current_price >= 2000` in `lib/db.ts` means ₺20 — a real gate against
   * 1-kuruş rows. The same integer in pence is £20 and would hide most of a GB
   * catalogue, so the number has to travel with the currency.
   */
  minPrice: number;
  /** Price-bucket edges in minor units: [lt|mid, mid|gt]. Drives the chips. */
  buckets: [number, number];
  /**
   * A locale tag, for dates only. Money never goes through Intl currency
   * formatting — Hermes does not reliably ship the ICU data (see lib/format.ts).
   */
  dateLocale: string;
  /**
   * Offered in the app. False means the collector may sweep it but no phone
   * resolves to it and the picker does not list it — a market is switched on
   * only once its feed has real rows, because an empty feed is a bad review.
   */
  launched: boolean;
}

/**
 * Wave 1 is AE, SA and GB beside the existing TR.
 *
 * Chosen over the EU because demand is proven there and no competitor covers
 * it (docs/competitors/country-availability-2026-09-20.md), the storefronts are
 * in English so `lib/productTypes.ts` still classifies, and a GB/AE/SA store
 * listing does not re-open the EU DSA trader declaration that Turkey-only
 * availability currently skips.
 *
 * DE/FR/ES/IT/NL/US are verified reachable in the plan and deliberately absent:
 * adding one is an entry here plus that market's adapter parameters.
 */
export const COUNTRIES = {
  TR: {
    currency: "TRY", symbol: "₺", symbolBefore: true,
    proxyExit: "tr", minPrice: 2000, buckets: [50000, 150000],
    dateLocale: "tr-TR",
    launched: true,
  },
  AE: {
    currency: "AED", symbol: "AED", symbolBefore: true,
    proxyExit: "ae", minPrice: 1000, buckets: [10000, 30000],
    dateLocale: "en-AE",
    launched: true,
  },
  SA: {
    currency: "SAR", symbol: "SAR", symbolBefore: true,
    proxyExit: "sa", minPrice: 1000, buckets: [10000, 30000],
    dateLocale: "en-SA",
    launched: true,
  },
  GB: {
    currency: "GBP", symbol: "£", symbolBefore: true,
    proxyExit: "gb", minPrice: 500, buckets: [5000, 15000],
    dateLocale: "en-GB",
    launched: true,
  },
  // Wave 2 (2026-09-23): the markets that pay for subscriptions. Swept by the
  // collector, invisible in the app until `launched` flips on real data.
  US: {
    currency: "USD", symbol: "$", symbolBefore: true,
    proxyExit: "us", minPrice: 500, buckets: [5000, 15000],
    dateLocale: "en-US", launched: false,
  },
  CA: {
    currency: "CAD", symbol: "CA$", symbolBefore: true,
    proxyExit: "ca", minPrice: 500, buckets: [5000, 15000],
    dateLocale: "en-CA", launched: false,
  },
  AU: {
    currency: "AUD", symbol: "A$", symbolBefore: true,
    proxyExit: "au", minPrice: 500, buckets: [5000, 15000],
    dateLocale: "en-AU", launched: false,
  },
  IE: {
    currency: "EUR", symbol: "€", symbolBefore: true,
    proxyExit: "ie", minPrice: 500, buckets: [5000, 15000],
    dateLocale: "en-IE", launched: false,
  },
  DE: {
    currency: "EUR", symbol: "€", symbolBefore: true,
    proxyExit: "de", minPrice: 500, buckets: [5000, 15000],
    dateLocale: "en-DE", launched: false,
  },
  FR: {
    currency: "EUR", symbol: "€", symbolBefore: true,
    proxyExit: "fr", minPrice: 500, buckets: [5000, 15000],
    dateLocale: "en-FR", launched: false,
  },
  NL: {
    currency: "EUR", symbol: "€", symbolBefore: true,
    proxyExit: "nl", minPrice: 500, buckets: [5000, 15000],
    dateLocale: "en-NL", launched: false,
  },
  BE: {
    currency: "EUR", symbol: "€", symbolBefore: true,
    proxyExit: "be", minPrice: 500, buckets: [5000, 15000],
    dateLocale: "en-BE", launched: false,
  },
  AT: {
    currency: "EUR", symbol: "€", symbolBefore: true,
    proxyExit: "at", minPrice: 500, buckets: [5000, 15000],
    dateLocale: "en-AT", launched: false,
  },
  ES: {
    currency: "EUR", symbol: "€", symbolBefore: true,
    proxyExit: "es", minPrice: 500, buckets: [5000, 15000],
    dateLocale: "en-ES", launched: false,
  },
  IT: {
    currency: "EUR", symbol: "€", symbolBefore: true,
    proxyExit: "it", minPrice: 500, buckets: [5000, 15000],
    dateLocale: "en-IT", launched: false,
  },
  PT: {
    currency: "EUR", symbol: "€", symbolBefore: true,
    proxyExit: "pt", minPrice: 500, buckets: [5000, 15000],
    dateLocale: "en-PT", launched: false,
  },
  FI: {
    currency: "EUR", symbol: "€", symbolBefore: true,
    proxyExit: "fi", minPrice: 500, buckets: [5000, 15000],
    dateLocale: "en-FI", launched: false,
  },
  CH: {
    currency: "CHF", symbol: "CHF", symbolBefore: true,
    proxyExit: "ch", minPrice: 500, buckets: [5000, 15000],
    dateLocale: "en-CH", launched: false,
  },
  SE: {
    currency: "SEK", symbol: "kr", symbolBefore: false,
    proxyExit: "se", minPrice: 5000, buckets: [50000, 150000],
    dateLocale: "en-SE", launched: false,
  },
  DK: {
    currency: "DKK", symbol: "kr", symbolBefore: false,
    proxyExit: "dk", minPrice: 5000, buckets: [50000, 150000],
    dateLocale: "en-DK", launched: false,
  },
  NO: {
    currency: "NOK", symbol: "kr", symbolBefore: false,
    proxyExit: "no", minPrice: 5000, buckets: [50000, 150000],
    dateLocale: "en-NO", launched: false,
  },
} satisfies Record<string, CountryInfo>;

export type CountryCode = keyof typeof COUNTRIES;

/**
 * Turkey, and it must stay Turkey.
 *
 * Every API route defaults to this, which is what keeps the shipped 2.6.0 app —
 * which sends no `country` at all — getting exactly what it gets today.
 */
export const DEFAULT_COUNTRY: CountryCode = "TR";

/** Every market the collector can sweep, launched or not. */
export const ALL_COUNTRIES = Object.keys(COUNTRIES) as CountryCode[];

/** Markets the app offers. TR first because it is the default and the largest. */
export const ACTIVE_COUNTRIES = ALL_COUNTRIES.filter((c) => COUNTRIES[c].launched);

/** A market we know — the collector and the API accept these. */
export const isCountry = (v: unknown): v is CountryCode =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(COUNTRIES, v);

/** A market the app may resolve to or offer. */
export const isLaunched = (v: unknown): v is CountryCode =>
  isCountry(v) && COUNTRIES[v].launched;

/**
 * Anything at all → a country we serve, defaulting to Turkey.
 *
 * Never throws and never 400s: a shipped build sends no country, and a future
 * one may send `DE` before its adapters land. Both must see the Turkish
 * catalogue rather than an error, because an error is a blank feed on a phone
 * that cannot be updated.
 */
export function toCountry(v: unknown): CountryCode {
  if (typeof v !== "string") return DEFAULT_COUNTRY;
  const up = v.trim().toUpperCase();
  return isCountry(up) ? up : DEFAULT_COUNTRY;
}

export const countryInfo = (c: CountryCode): CountryInfo => COUNTRIES[c];
export const currencyFor = (c: CountryCode): string => COUNTRIES[c].currency;
export const minPriceFor = (c: CountryCode): number => COUNTRIES[c].minPrice;

/**
 * Currency → how to print it, derived from the country table so a new market
 * never needs a second list. First country wins when two share a currency,
 * which is fine: the symbol is a property of the currency, not the country.
 */
export const CURRENCY_STYLE: Record<string, { symbol: string; symbolBefore: boolean }> =
  Object.fromEntries(
    ACTIVE_COUNTRIES.map((c) => [
      COUNTRIES[c].currency,
      { symbol: COUNTRIES[c].symbol, symbolBefore: COUNTRIES[c].symbolBefore },
    ]),
  );
