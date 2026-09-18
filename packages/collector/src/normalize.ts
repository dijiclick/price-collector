/** Convert a major-unit price (e.g. 590.00 TRY) to integer minor units (kuruş). */
export const toMinor = (major: number): number => Math.round(major * 100);

/** Format minor units as Turkish Lira, e.g. 133399 -> "₺1.333,99". */
export function fromMinorTRY(minor: number, lang: "tr" | "en" | null = "tr"): string {
  // The currency stays lira whatever the language — it IS lira. Only the
  // separators move: ₺1.310,00 in Turkish, ₺1,310.00 in English. Getting this
  // wrong is the kind of thing that reads as a broken price rather than a
  // translation choice.
  const v = (minor / 100).toLocaleString(lang === "en" ? "en-US" : "tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `₺${v}`;
}

/** Percent change from old to new, rounded to an integer. Negative = drop. */
export function pctChange(oldMinor: number, newMinor: number): number {
  if (oldMinor <= 0) return 0;
  return Math.round(((newMinor - oldMinor) / oldMinor) * 100);
}

/**
 * The one place a list price is allowed to become a discount.
 *
 * A `listPrice` only means something when it is strictly above the price being
 * charged for the SAME sellable unit. Adapters were each enforcing that
 * themselves and not all of them did — Beymen passed its original through
 * unchecked — so a source glitch could store `listPrice <= price` and the feed
 * would render a 0% or negative "deal".
 *
 * This does NOT try to second-guess a large-but-real markdown: 70% off in a
 * clearance is ordinary here. The variant-range artifact that produced fake
 * discounts (a master's cheapest size quoted against its dearest) has to be
 * caught where the shape is known — in the adapter — because only it can tell a
 * range from a strikethrough. See sephora.ts.
 */
export function cleanListPrice(price: number, listPrice: number | null | undefined): number | null {
  if (typeof listPrice !== "number" || !Number.isFinite(listPrice)) return null;
  return listPrice > price ? listPrice : null;
}
