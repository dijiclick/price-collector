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
  const v = (minor / 100).toLocaleString(numberLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `₺${v}`;
}

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
