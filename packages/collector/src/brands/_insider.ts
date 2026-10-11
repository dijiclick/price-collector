/**
 * Shared collector over Insider's Smart Recommender API — the product feed a
 * shop syncs to Insider (useinsider.com) for its on-site recommendation
 * widgets. Built 2026-10-11 for Mavi and Twist, whose own storefront APIs
 * (Cloudflare) refuse GitHub's runners outright.
 *
 *   https://recommendationv2.api.useinsider.com/v2/<strategy>
 *     ?partnerName=<shop>&locale=tr_TR&currency=TRY&details=true&size=100
 *     &clientId=<public client id from the shop's ins.js>&filter=<expr>
 *
 * No key beyond the public client id the shop's own `ins.js` ships (the same
 * value for every Insider shop), no cookie, plain GET. Answers a GitHub runner
 * with 200 (probe run 38135733879).
 *
 * The feed carries price, original price, gender, category tree, colour, the
 * product url and image, and only lists IN-STOCK items. Limits shape the walk:
 *   - `size` is at most 100 and there is no paging, so the discounted set is
 *     partitioned by price band (`[price.TRY][>][lo]` … `[<][hi]`) — every band
 *     stays under 100 rows;
 *   - each strategy (most-popular, new-arrivals, …) draws from its own pool and
 *     returns one row per product GROUP, so a few strategies are unioned to
 *     reach more colours/sizes of the same models.
 * So coverage is "most of the in-stock sale", not the whole catalogue; a pasted
 * link still resolves any product live.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export interface InsiderShop {
  brand: string;
  partnerName: string;
  /** Filter expression selecting discounted rows. */
  discountFilter: string;
  /** Price band edges (TRY); each adjacent pair is one request per strategy. */
  priceEdges: number[];
  strategies: string[];
  /**
   * How a feed row maps to a product:
   *  - "colour": one row per colourway (Mavi `item_id` = PDP code);
   *  - "size":   one row per size (Twist), merged by `groupcode`.
   */
  rowKind: "colour" | "size";
  /** Section when the feed's gender is missing (women-only labels). */
  defaultGender: ProductRecord["gender"];
}

export const INSIDER_ENDPOINT = "https://recommendationv2.api.useinsider.com/v2";
/** Public client id embedded in every Insider shop's ins.js (`misc.rcid`). */
export const INSIDER_CLIENT_ID = "g0uSLhenGOKvzAtz";

const PAUSE_MS = Number(process.env.INSIDER_PAUSE_MS ?? 500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function insiderUrl(shop: InsiderShop, strategy: string, lo: number, hi: number): string {
  const filter = `(${shop.discountFilter})*([price.TRY][>][${lo}])*([price.TRY][<][${hi}])`;
  const q = new URLSearchParams({
    details: "true",
    locale: "tr_TR",
    currency: "TRY",
    partnerName: shop.partnerName,
    clientId: INSIDER_CLIENT_ID,
    size: "100",
    filter,
  });
  return `${INSIDER_ENDPOINT}/${strategy}?${q}`;
}

const money = (v: any): number => Number(v?.TRY ?? v);

export function insiderGender(g: unknown, fallback: ProductRecord["gender"]): ProductRecord["gender"] {
  const s = String(g ?? "").toLocaleLowerCase("tr");
  if (/çocuk|cocuk|bebek|kids?|girl|boy|baby/.test(s)) return "cocuk";
  if (/kad|female|women/.test(s)) return "kadin";
  if (/erkek|^male|^men/.test(s)) return "erkek";
  return fallback;
}

/** Jeans carry waist × length stock as JSON strings: `{"size":"28","length":"30","hasStock":true}`. */
export function lengthSizes(x: any): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const raw of x?.product_attributes?.all_length_variants_v3 ?? []) {
    let v: any;
    try { v = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { continue; }
    const label = [v?.size, v?.length].filter((p) => p != null && String(p).trim()).join("/");
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, availability: v.hasStock ? "in_stock" : "out_of_stock" });
  }
  return out;
}

const SKIP_CATEGORY = /^(outlet|koleksiyon|giyim|kad[ıi]n|erkek|.*çocuk)$/i;

/** Map one product: a single row ("colour") or all rows of one group ("size"). Pure. */
export function mapInsider(shop: InsiderShop, rows: any[]): ProductRecord | null {
  const x = rows[0];
  const price = money(x?.price);
  const orig = money(x?.original_price);
  if (!x?.name || !x?.url || !Number.isFinite(price) || price <= 0) return null;
  const pa = x.product_attributes ?? {};
  const id = shop.rowKind === "size" ? String(pa.old_group_id || x.groupcode || "") : String(x.item_id ?? "");
  if (!id) return null;
  const url = String(x.url).split("#")[0];
  const first = typeof x.image_url === "string" && x.image_url ? x.image_url : null;
  const extra: string[] = Array.isArray(pa.additional_image_links) ? pa.additional_image_links : [];
  const cats: string[] = Array.isArray(x.category) ? x.category.map(String) : [];
  const category = cats.filter((c) => !SKIP_CATEGORY.test(c.trim()))[0] ?? null;
  let sizes: SizeVariant[] = [];
  if (shop.rowKind === "size") {
    const seen = new Set<string>();
    for (const r of rows) {
      const label = String(r?.size ?? "").trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      sizes.push({ label, availability: r.in_stock === 0 ? "out_of_stock" : "in_stock" });
    }
  } else {
    sizes = lengthSizes(x);
  }
  const colour = typeof x.color === "string" && x.color.trim() ? x.color.trim() : null;
  return {
    brand: shop.brand,
    country: "TR",
    externalId: id,
    name: String(x.name).trim(),
    url,
    imageUrl: first,
    images: cleanGallery(extra, first),
    price: toMinor(price),
    listPrice: Number.isFinite(orig) && orig > price ? toMinor(orig) : null,
    currency: "TRY",
    inStock: rows.some((r) => r?.in_stock !== 0),
    category,
    gender: insiderGender(x.gender ?? pa.custom_gender, shop.defaultGender),
    variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: shop.rowKind === "colour" && x.groupcode ? `${shop.brand}:${x.groupcode}` : null,
    colorName: colour,
  };
}

export async function listInsider(shop: InsiderShop, country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (country !== "TR") return [];
  const rows = new Map<string, any>();
  let requests = 0;
  let failures = 0;
  for (const strategy of shop.strategies) {
    for (let i = 0; i + 1 < shop.priceEdges.length; i++) {
      if (requests > 0) await sleep(PAUSE_MS);
      requests++;
      const d = await getJson<any>(insiderUrl(shop, strategy, shop.priceEdges[i], shop.priceEdges[i + 1]), { retries: 1 }).catch(() => null);
      if (!d?.success || !Array.isArray(d.data)) {
        failures++;
        if (requests === 1) throw new Error(`${shop.brand}: Insider feed refused`);
        continue;
      }
      for (const x of d.data) if (x?.item_id) rows.set(String(x.item_id), x);
    }
  }
  // Group: a colour row is its own product; size rows merge by groupcode.
  const groups = new Map<string, any[]>();
  for (const x of rows.values()) {
    const k = shop.rowKind === "size" ? String(x.groupcode ?? x.item_id) : String(x.item_id);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(x);
  }
  const out: ProductRecord[] = [];
  for (const g of groups.values()) {
    const r = mapInsider(shop, g);
    if (r && r.listPrice != null) out.push(r);
  }
  if (failures > requests / 2) console.warn(`${shop.brand}: ${failures}/${requests} Insider requests failed`);
  return [...out.filter((r) => r.inStock), ...out.filter((r) => !r.inStock)].slice(0, 1500);
}
