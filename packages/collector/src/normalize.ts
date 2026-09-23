import { formatMoney } from "../../../lib/format";

/** Convert a major-unit price (e.g. 590.00 TRY) to integer minor units (kuruş). */
export const toMinor = (major: number): number => Math.round(major * 100);

/**
 * Format minor units in the currency the shop is charging.
 *
 * The currency is a property of the PRODUCT (`products.currency`), and the
 * separators of the READER — ₺1.310,00 in Turkish, ₺1,310.00 in English. Getting
 * either wrong reads as a broken price rather than a translation choice, and
 * putting a lira sign on a £27.99 British product is a price nobody is charging,
 * pushed to a lock screen.
 *
 * A null/absent currency is lira, because every row stored before 2026-09-20
 * was lira and nothing backfills that.
 */
export function fromMinor(
  minor: number,
  currency: string | null | undefined,
  lang: "tr" | "en" | null = "tr",
): string {
  return formatMoney(minor, currency ?? "TRY", lang === "en" ? "en" : "tr");
}

/** The lira-only form, kept for callers that genuinely mean lira. */
export function fromMinorTRY(minor: number, lang: "tr" | "en" | null = "tr"): string {
  return fromMinor(minor, "TRY", lang);
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
