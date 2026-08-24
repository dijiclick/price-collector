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
