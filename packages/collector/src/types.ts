export type Availability = "in_stock" | "low_on_stock" | "out_of_stock";
export interface SizeVariant {
  label: string;
  availability: Availability;
  /** Brand SKU id — lets the PDP refresh live per-size stock (Zara itxrest). */
  sku?: number;
}
/** Colours + per-size availability captured at collection time (brand API). */
export interface ProductVariants {
  colors: string[];
  sizes: SizeVariant[];
}

/** A single product as returned by a brand adapter. Prices are in minor units (kuruş). */
export interface ProductRecord {
  brand: string;
  externalId: string;
  name: string;
  url: string;
  imageUrl: string | null;
  /** Current selling price, in minor units (kuruş). */
  price: number;
  /** Original / strikethrough price in minor units, or null if not on sale. */
  listPrice: number | null;
  currency: string;
  inStock: boolean;
  /**
   * Every EAN-13/UPC printed on this product's tags — one per size, since that
   * is what a shopper actually scans. Only some brands publish them (see
   * docs/barcode-feasibility.md); the rest stay null and resolve by article
   * number instead.
   */
  barcodes?: string[] | null;
  category?: string | null;
  /**
   * Which section tree the adapter found this product in. Only the adapter can
   * know this (the stored category text holds product types, not sections), so
   * set it at crawl time. null = unknown or genuinely unisex (most cosmetics).
   */
  gender?: "kadin" | "erkek" | "cocuk" | null;
  /** Colour/size availability, when the adapter can surface it. */
  variants?: ProductVariants | null;
  /**
   * Stable id shared by every variant (colour/shade) of the SAME product, so
   * the feed can collapse them into one card. Only set from an explicit,
   * source-provided grouping — never from name similarity (brands reuse generic
   * names like "KISA ELBİSE"). Null = standalone product.
   */
  groupKey?: string | null;
  /** This variant's colour/shade name, for the collapsed card's variant list. */
  colorName?: string | null;
}

/** A brand adapter: pure over HTTP, no DB knowledge. */
export interface BrandAdapter {
  brand: string;
  listProducts(): Promise<ProductRecord[]>;
}

export type EventType =
  | "price_drop"
  | "price_rise"
  | "back_in_stock"
  | "sold_out"
  | "new_product";

export interface Snap {
  price: number;
  listPrice: number | null;
  inStock: boolean;
}

export interface PriceEvent {
  type: EventType;
  oldPrice: number | null;
  newPrice: number;
  /** Percent change, negative for a drop (e.g. -33). null for stock-only events. */
  pct: number | null;
  /** For a per-size back_in_stock event: which size returned. Omitted otherwise. */
  size?: string;
}
