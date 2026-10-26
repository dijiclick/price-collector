/**
 * The real brand behind a multi-brand store's product (owner 2026-10-18:
 * "Michael Kors at Saat&Saat", "Dior at Sephora"). Pure and platform-free:
 * the collector writes it, and the feed filters/facets read it.
 *
 * Stores whose own category field already IS the maker (measured on the live
 * feed 2026-10-18): Beymen's 674 categories are designers, Boyner's 188 are
 * brands, and so on. Every other store either sets `maker` in its adapter
 * (Saat&Saat reads the watch brand from its feed) or has none.
 */
const CATEGORY_IS_MAKER: Record<string, readonly string[] | "all"> = {
  beymen: "all", boyner: "all", superstep: "all", sportive: "all", fashfed: "all", modanisa: "all",
  // Sephora TR/AU store no category at all; CA/US/CH carry the house there.
  sephora: ["CA", "US", "CH"],
};

export function makerOf(r: { brand: string; country?: string | null; category?: string | null; maker?: string | null }): string | null {
  const own = r.maker?.trim();
  if (own) return own;
  const rule = CATEGORY_IS_MAKER[r.brand];
  // Since 2026-10-26 these adapters set `maker` and put the store's own
  // breadcrumb ("KOZMETİK > PARFÜM") in category: never a maker.
  if (!rule || !r.category?.trim() || r.category.includes(">")) return null;
  if (rule !== "all" && !rule.includes(r.country ?? "TR")) return null;
  return r.category.trim();
}

/** Brands that have makers, for the app to decide whether to offer the filter. */
export const MAKER_BRANDS = new Set([...Object.keys(CATEGORY_IS_MAKER), "saatvesaat"]);
