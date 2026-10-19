import type { Snap, PriceEvent, SizeVariant } from "./types";
import { pctChange } from "./normalize";

/**
 * Which size labels transitioned from out-of-stock to available (in_stock or
 * low_on_stock) between two variant lists. Pure; used to raise per-size
 * back_in_stock events. Returns [] when `prev` is null (first sight — no
 * transition is knowable) or a label is new/unchanged.
 */
export function diffSizes(prev: SizeVariant[] | null, curr: SizeVariant[]): string[] {
  if (!prev || prev.length === 0) return [];
  const wasOut = new Map(prev.map((s) => [s.label, s.availability === "out_of_stock"]));
  const back: string[] = [];
  for (const s of curr) {
    if (s.availability !== "out_of_stock" && wasOut.get(s.label) === true) back.push(s.label);
  }
  return back;
}

/**
 * A run where most of what we return is "new" is a backfill — a brand switched
 * to its full catalogue, or was just added — not new stock. Those rows would
 * otherwise reach "N new for your search" pushes and the new-in counts as
 * if the shop had just released them. A real season drop is a few percent of
 * a catalogue per run (Zara ~4%), far under the bar.
 */
export function isBackfill(newCount: number, productCount: number): boolean {
  return newCount >= 300 && newCount > productCount * 0.3;
}

/**
 * Detect price/stock events between the previous snapshot and the current one.
 * `prev` is null the first time we ever see a product.
 * Pure function — no I/O.
 */
export function diff(prev: Snap | null, curr: Snap): PriceEvent[] {
  if (prev === null) {
    return [{ type: "new_product", oldPrice: null, newPrice: curr.price, pct: null }];
  }

  const events: PriceEvent[] = [];

  if (curr.price < prev.price) {
    events.push({
      type: "price_drop",
      oldPrice: prev.price,
      newPrice: curr.price,
      pct: pctChange(prev.price, curr.price),
    });
  } else if (curr.price > prev.price) {
    events.push({
      type: "price_rise",
      oldPrice: prev.price,
      newPrice: curr.price,
      pct: pctChange(prev.price, curr.price),
    });
  }

  if (!prev.inStock && curr.inStock) {
    events.push({ type: "back_in_stock", oldPrice: null, newPrice: curr.price, pct: null });
  } else if (prev.inStock && !curr.inStock) {
    events.push({ type: "sold_out", oldPrice: null, newPrice: curr.price, pct: null });
  }

  return events;
}
