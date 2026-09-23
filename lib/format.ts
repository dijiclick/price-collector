import { COUNTRIES, CURRENCY_STYLE, DEFAULT_COUNTRY, type CountryCode } from "./countries";

/**
 * The language the app is currently speaking.
 *
 * A module-level value rather than an argument threaded through `tl`,
 * `productTypeLabel` and the 45 price call sites between them — the active
 * language genuinely is one global thing, the way it is in every i18n library.
 *
 * Only the mobile app sets it, from the root layout during render, so every
 * child renders under the right one. The web is Turkish, never calls the
 * setter, and therefore has no shared mutable state across requests.
 */
let lang: "tr" | "en" = "tr";

export function setAppLang(l: "tr" | "en"): void {
  lang = l;
}

export const appLang = (): "tr" | "en" => lang;

const numberLocale = () => (lang === "en" ? "en-US" : "tr-TR");

/**
 * Format integer minor units (kuruş) as Turkish Lira: 133399 -> "₺1.333,99",
 * or "₺1,333.99" in English.
 *
 * The CURRENCY does not follow the language — these are lira whoever is
 * reading, and converting them would be inventing a price the shop is not
 * charging. Only the separators move.
 */
export function tl(minor: number): string {
  return formatMoney(minor, "TRY");
}

/** Group separator and decimal mark per language. See formatMoney. */
const SEPARATORS = {
  tr: { group: ".", decimal: "," },
  en: { group: ",", decimal: "." },
} as const;

/**
 * Integer minor units → a printed price, in the currency the shop charges.
 *
 * TWO INDEPENDENT AXES, and keeping them apart is the whole design:
 *
 *   - the SYMBOL follows the CURRENCY. £27.99 is pounds whoever is reading, and
 *     converting it would invent a price the shop is not charging.
 *   - the SEPARATORS follow the READER's LANGUAGE. ₺1.310,00 in Turkish,
 *     ₺1,310.00 in English — the rule `tl()` documented, preserved exactly, so
 *     no existing screen changes when it migrates. A Turkish speaker shopping
 *     the UK therefore sees £27,99, which is how they read every other number
 *     in the app.
 *
 * Separators are assembled by hand rather than via `Intl.NumberFormat`'s
 * currency mode: Hermes does not reliably ship the ICU data (see `trUpper`),
 * so a locale-aware path looks right in Node tests and can silently degrade on
 * device. `toLocaleString` for plain grouping is what `tl()` already relied on,
 * but doing it manually makes the output identical on every engine.
 *
 * An unknown currency prints as its own code — a row written by a market whose
 * adapter shipped ahead of this table must never render as "undefined50,00".
 */
export function formatMoney(
  minor: number,
  currency?: string | null,
  l: "tr" | "en" = lang,
): string {
  const code = currency || "TRY";
  const style = CURRENCY_STYLE[code] ?? { symbol: code, symbolBefore: true };
  const { group, decimal } = SEPARATORS[l] ?? SEPARATORS.tr;

  const neg = minor < 0;
  const abs = Math.round(Math.abs(minor));
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const number = `${grouped}${decimal}${cents}`;
  // A multi-letter code needs air between it and the digits ("AED 1.200,00");
  // a glyph does not ("₺1.310,00").
  const gap = style.symbol.length > 1 ? " " : "";
  const body = style.symbolBefore ? `${style.symbol}${gap}${number}` : `${number}${gap}${style.symbol}`;
  return neg ? `-${body}` : body;
}

/**
 * The market the app is currently shopping.
 *
 * A module-level value for exactly the reason `lang` above is one: the active
 * market genuinely is one global thing, and threading it through the 46 price
 * call sites would be noise at every one of them. Set from the root layout
 * during render, before any child renders, beside `setAppLang`.
 *
 * The web never calls the setter and stays Turkish, so there is no shared
 * mutable state across requests there either.
 */
let market: CountryCode = DEFAULT_COUNTRY;

export function setAppCountry(c: CountryCode): void {
  market = c;
}

export const appCountry = (): CountryCode => market;
export const appCurrency = (): string => COUNTRIES[market].currency;

/**
 * A price on screen.
 *
 * `cur` is the row's OWN currency and always wins — pass `deal.currency`
 * wherever a Deal is at hand. A tracked list can legitimately hold rows from two
 * markets (someone who moved, or who switched country to look around), and
 * printing them all in the active currency would be inventing prices. Where
 * there is no row — a target-price input, a savings total, an insight — the
 * active market's currency is the honest answer.
 */
export function money(minor: number, cur?: string | null): string {
  return formatMoney(minor, cur ?? COUNTRIES[market].currency);
}

/**
 * A price with the minor units dropped: "₺1.500", not "₺1.500,00".
 *
 * For chips and sentences, where two decimal places are noise and cost the width
 * a filter chip does not have. This is what the old `fmtTl` produced ("2.000 TL")
 * — with a currency SYMBOL now, rather than a Turkish word appended to every
 * amount in every language.
 */
export function moneyRound(minor: number, cur?: string | null): string {
  const code = cur || COUNTRIES[market].currency;
  const style = CURRENCY_STYLE[code] ?? { symbol: code, symbolBefore: true };
  const gap = style.symbol.length > 1 ? " " : "";
  const n = numberRound(minor);
  return style.symbolBefore ? `${style.symbol}${gap}${n}` : `${n}${gap}${style.symbol}`;
}

/** The grouped whole-unit number alone — the second half of a "₺500–1.500" range. */
export function numberRound(minor: number): string {
  const { group } = SEPARATORS[lang] ?? SEPARATORS.tr;
  return String(Math.round(minor / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, group);
}

/** Just the symbol, for a price INPUT where the number is the user's to type. */
export function currencySymbol(cur?: string | null): string {
  const code = cur || COUNTRIES[market].currency;
  return (CURRENCY_STYLE[code] ?? { symbol: code }).symbol;
}

/** The price-bucket edges of the active market, in minor units. */
export const priceBuckets = (): readonly [number, number] => COUNTRIES[market].buckets;

/** Locale tag for dates. Follows the LANGUAGE, not the market — a date is words. */
export const dateLocale = (): string => (lang === "en" ? "en-US" : "tr-TR");

/** Plain grouped integer: 3037 -> "3.037" / "3,037". Counts, not money. */
export const nf = (n: number): string => n.toLocaleString(numberLocale());

export const BRAND_LABELS: Record<string, string> = {
  zara: "Zara",
  guess: "Guess",
  penti: "Penti",
  sephora: "Sephora",
  hm: "H&M",
  gratis: "Gratis",
  mango: "Mango",
  watsons: "Watsons",
  pandora: "Pandora",
  massimodutti: "Massimo Dutti",
  pullandbear: "Pull&Bear",
  bershka: "Bershka",
  stradivarius: "Stradivarius",
  oysho: "Oysho",
  koton: "Koton",
  rossmann: "Rossmann",
  boyner: "Boyner",
  beymen: "Beymen",
};

export const brandLabel = (b: string) => BRAND_LABELS[b] ?? b;

/**
 * Short label for the tight brand rail (56px), where long names like
 * "Massimo Dutti" get mid-word ellipsis-cut and read badly. Falls back to
 * the full label everywhere it isn't overridden.
 */
const BRAND_SHORT: Record<string, string> = {
  massimodutti: "M. Dutti",
  stradivarius: "Stradi",
  pullandbear: "Pull&Bear",
};

export const brandShort = (b: string) => BRAND_SHORT[b] ?? brandLabel(b);

/**
 * Uppercase for Turkish, where dotted and dotless i are separate letters:
 * i→İ and ı→I. Plain `toUpperCase()` renders "bana ait" as "BANA AIT" and
 * "eşik" as "EŞIK", which reads as a typo to every Turkish speaker — and CSS
 * `textTransform: "uppercase"` has the same flaw, so every small-caps label in
 * the app was wrong.
 *
 * The two letters are remapped BEFORE `toUpperCase()` rather than delegating to
 * `toLocaleUpperCase("tr-TR")`, because Hermes does not reliably ship the ICU
 * data that locale-aware casing needs — it would silently fall back to the
 * broken mapping on device while looking correct in Node tests. Every other
 * Turkish letter (ç ğ ö ş ü) uppercases correctly without help.
 */
export function trUpper(s: string): string {
  // Only in Turkish. Applied to English it produces "NOTİFİCATİONS", which is
  // the same class of typo in the other direction — the dotted capital is a
  // Turkish letter, not a decoration.
  if (lang === "en") return s.toUpperCase();
  return s.replace(/i/g, "İ").replace(/ı/g, "I").toUpperCase();
}

/**
 * Retailer product names usually end in the vendor's own article code —
 * "… Örgü Sweatshirt M4WL-SWT-1927", "… Kadın Sweatshirt 75PAIG05". It means
 * nothing to a shopper and it is what makes a product title spill onto a third
 * line, so drop it for display. The raw name is still what we match and search
 * on; this is presentation only.
 *
 * Deliberately conservative: the trailing token must be all-caps/digits/dashes,
 * at least five characters, and contain a digit — so "Sweatshirt", "XL" and
 * "Pull&Bear" survive, and anything ambiguous is left alone.
 */
export function productTitle(name: string): string {
  const trimmed = name.trim();
  const stripped = trimmed.replace(/\s+[A-Z0-9][A-Z0-9./-]{4,}$/, (m) =>
    /\d/.test(m) ? "" : m,
  );
  // Never hand back an empty or near-empty title.
  return stripped.trim().length >= 3 ? stripped.trim() : trimmed;
}
