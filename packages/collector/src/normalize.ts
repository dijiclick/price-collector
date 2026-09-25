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

/** Rounded percent a price sits below its list price (20 for 48.00 vs 59.99). */
export function discountPct(price: number, listPrice: number | null | undefined): number | null {
  if (typeof listPrice !== "number" || !(listPrice > price) || price <= 0) return null;
  return Math.round((1 - price / listPrice) * 100);
}

/**
 * Which discount percent, if any, is a BLANKET PROMOTION rather than a markdown.
 *
 * A conditional offer — a members' day, "−20% when you buy two", a loyalty-card
 * price — reaches us as the same field a real markdown does, so it cannot be
 * told apart one product at a time. What gives it away is its footprint: it
 * prices a whole department at ONE percent. Measured 2026-09-25, H&M FI had
 * 29,810 of 31,702 products at exactly −20% ("−20% kun ostat min. 2 tuotetta,
 * jäsenille" — members, two items minimum; a guest cart charged the full
 * 59,99 € for one), and DE had its entire women's range at exactly −25%
 * ("gültig für Member … ab einem Einkauf von 50 €"). A genuine clearance is
 * never that uniform — H&M US's real sale spreads over 20/22/24/25/26/30/32%
 * and covers a few percent of any department.
 *
 * `share` is measured against EVERY product in the group, discounted or not, so
 * a small sale that happens to be all one percent never trips it.
 */
export function blanketPromotionPct(
  records: readonly { price: number; listPrice: number | null }[],
  { minShare = 0.3, minCount = 50 }: { minShare?: number; minCount?: number } = {},
): number | null {
  const counts = new Map<number, number>();
  for (const r of records) {
    const pct = discountPct(r.price, r.listPrice);
    if (pct != null) counts.set(pct, (counts.get(pct) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestN = 0;
  for (const [pct, n] of counts) if (n > bestN) [best, bestN] = [pct, n];
  if (best == null || bestN < minCount || bestN / Math.max(records.length, 1) < minShare) return null;
  return best;
}

/**
 * Undo a blanket promotion on the records it touched: the shopper pays the list
 * price, so that becomes `price` and there is no discount. Records at any OTHER
 * percent keep theirs — the H&M member offers explicitly exclude items already
 * in the sale, so a real markdown sitting alongside the promotion survives.
 * Returns how many records were reverted.
 */
export function revertBlanketPromotion(
  records: { price: number; listPrice: number | null }[],
  pct: number,
): number {
  let n = 0;
  for (const r of records) {
    if (r.listPrice != null && discountPct(r.price, r.listPrice) === pct) {
      r.price = r.listPrice;
      r.listPrice = null;
      n++;
    }
  }
  return n;
}
