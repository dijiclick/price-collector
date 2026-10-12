/**
 * URBN — Urban Outfitters, Free People, Anthropologie — through the Dynamic
 * Yield recommendation feed their own storefronts render product trays from.
 *
 * Every URBN storefront, its `api.*` host and its robots/sitemaps sit behind
 * DataDome and 403 a datacenter IP (and a Turkish home line). The storefront
 * config (`urbnConfig.dy.sitesBySiteGroup`) names the Dynamic Yield section of
 * each site; DY's public client-side recommendation endpoint
 * (`rcom.dynamicyield.com/v3/recommend/<section>`, the call the DY script
 * makes from every shopper's browser, no key) answers a GitHub runner directly
 * — probe run 38236432337, 2026-10-12, all eight market/brand calls 200.
 *
 * The feed row is one colour of one style and carries the list price
 * (`price`), the markdown price, `is_markdown`, `markdown_state`
 * (TEMPORARY/PERMANENT) and `in_stock`. The US section holds the base feed in
 * USD (`sale_price`); a `lng` context switches to a localized feed whose
 * `price`, `currency`, `url`, `name` and `sale price` (with a space) are that
 * market's — `sale_price` stays the US value there and is never used. The
 * European sections (UO EU, Anthropologie EU) are GBP-native with `sale price`.
 *
 *   UO   US 8793668 base · CA 8793668 en_CA · GB 8793880 (UO EU)
 *   FP   US 8793672 base · GB 8793672 en_GB (no Canadian store; fp-ca is the US site)
 *   AN   US 8793670 base · GB 8793883 (AN EU). Not CA: its en_CA feed has
 *        CAD list prices but no CAD sale price.
 *
 * A call returns at most 100 rows and ignores page/page_size. Paging works the
 * way DY's own script avoids repeats: the next call excludes the skus already
 * returned (`filtering: [{type: "exclude", field: "sku"}]`). DY honours at
 * most 500 excluded skus, so the sale is cut into six price slices of at most
 * six pages each (≤ 36 calls, ~250 KB each). The widget is a TOP_N one
 * (deterministic order) so the same colours come back run to run. The home,
 * furniture and music departments are cut server-side to spend the budget on
 * fashion. No per-size stock: the feed row is per colour.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export type UrbnBrand = "urbanoutfitters" | "freepeople" | "anthropologie";

interface Market {
  /** Dynamic Yield section id (`urbnConfig.dy.sitesBySiteGroup.*.siteId`). */
  section: number;
  /** Any recommendation widget on that section, and its product feed. */
  widget: number;
  feed: number;
  /** Localized feed for the market; absent = the section's own feed. */
  lng?: string;
}

export const URBN_MARKETS: Record<UrbnBrand, Partial<Record<CountryCode, Market>>> = {
  urbanoutfitters: {
    US: { section: 8793668, widget: 515577, feed: 980742 },
    CA: { section: 8793668, widget: 515577, feed: 980742, lng: "en_CA" },
    GB: { section: 8793880, widget: 515706, feed: 980741 },
  },
  freepeople: {
    US: { section: 8793672, widget: 515874, feed: 980739 },
    GB: { section: 8793672, widget: 515874, feed: 980739, lng: "en_GB" },
  },
  anthropologie: {
    US: { section: 8793670, widget: 515960, feed: 980738 },
    GB: { section: 8793883, widget: 515721, feed: 980737 },
  },
};

const PAGE = 100; // the endpoint's hard ceiling per call
// The endpoint honours at most 500 excluded skus, so a slice yields at most 600 colours.
const PAGES_PER_SLICE = 6;
const CAP = 1500;
// Price slices (feed currency). Each is paged on its own, so every price band is represented.
const PRICE_CUTS = [0, 25, 40, 60, 90, 150, 1e6];
// A fixed, anonymous visitor id: DY needs one, and a constant keeps the answer unpersonalized.
const UID = "-5231987654321";

const cond = (field: string, action: string, value: string | number) => ({ field, arguments: [{ action, value }] });

/**
 * Server-side cut of the home/furniture/music departments, so the request budget goes
 * on fashion. `mapUrbnItem` drops whatever home goods slip through by product type.
 */
const DEPT_FILTERS: Record<UrbnBrand, Partial<Record<CountryCode, ReturnType<typeof cond>[]>>> = {
  urbanoutfitters: Object.fromEntries(
    (["US", "CA", "GB"] as const).map((c) => [c, ["Home", "Lifestyle", "Music"].map((g) => cond("gender", "IS_NOT", g))]),
  ),
  freepeople: {},
  anthropologie: {
    US: ["house-home", "home-gifts", "collection-garden-outdoor", "shop-terrain", "all-gifts"].map((c) => cond("categories", "IS_NOT", c)),
    // DY silently drops the WHOLE rule past 10 conditions (3 are price/markdown), so at most 7 here.
    GB: ["home", "bedding", "soft-furnishings-rugs", "room-wall-decor", "wall-decor-art", "kitchen-aprons", "furniture-all"].map((c) =>
      cond("categories", "IS_NOT", c),
    ),
  },
};

/** The request body for one page of one price slice — the shape DY's own script posts. */
export function rcomBody(b: UrbnBrand, country: CountryCode, lo: number, hi: number, exclude: string[]): string {
  const m = URBN_MARKETS[b][country]!;
  const conditions = [
    cond("is_markdown", "IS", "1"),
    cond("price", "GTE", lo),
    cond("price", "LT", hi),
    ...(DEPT_FILTERS[b][country] ?? []),
  ];
  return JSON.stringify({
    data: [
      {
        wId: m.widget,
        fId: m.feed,
        maxProducts: PAGE,
        rules: [{ id: -1, type: "include", slots: [], query: { conditions } }],
        filtering: exclude.length ? [{ type: "exclude", field: "sku", value: exclude }] : [],
      },
    ],
    ctx: m.lng ? { type: "HOMEPAGE", lng: m.lng } : { type: "HOMEPAGE" },
    uid: UID,
  });
}

// Product types that are home goods, not fashion. A row is dropped only when ALL its types are.
const HOME_TYPE =
  /^(drinkware|bedding|candles?|candle accessories|candleholders|towels|kitchen.*|table linens|linens & tableware|dinnerware|serveware|bar accessories|cooking & baking|door & house hardware|pull knobs & handles|curtain hardware|vases.*|picture frames|home.*|curtains|shower curtains|bath mats|bathroom.*|plants.*|planters|lighting|throw pillows|throws|rugs|.*furniture|accent tables|bed frames|seating|wall storage|bins.*|art & wall accents|decorative objects|holiday decor|mirrors|gift wrap|games toys & crafts|novelty|music|books|stationery.*|smoke accessories|tech accessories|travel|vitamins & supplements|jewel(le)?ry (boxes|stands).*)$/i;

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

function genderOf(b: UrbnBrand, g: unknown): ProductRecord["gender"] {
  if (b === "freepeople") return "kadin";
  const s = String(g ?? "");
  const w = /\bWomen\b/.test(s);
  const m = /\bMen\b/.test(s);
  if (w && !m) return "kadin";
  if (m && !w) return "erkek";
  return null;
}

/** Map one feed row (one colour). Pure; null unless this market's own price is genuinely reduced. */
export function mapUrbnItem(it: any, b: UrbnBrand, country: CountryCode): ProductRecord | null {
  const m = URBN_MARKETS[b][country];
  if (!m || !it?.sku || !it?.url || !it?.name) return null;
  const currency = COUNTRIES[country].currency;
  // A localized row that the market does not sell comes back with an empty currency and url.
  if ((it.currency || currency) !== currency) return null;
  if (it.is_markdown !== "1" && it.is_markdown !== 1) return null;
  const list = num(it.price);
  // Localized feeds carry the market's markdown in `sale price`; `sale_price` there is the US one.
  const sale = num(m.lng ? it["sale price"] : it.sale_price ?? it["sale price"]);
  if (list == null || sale == null || sale >= list) return null;

  const photos: string[] = [it.image_url, ...[1, 2, 3, 4, 5, 6].map((i) => it[`additional_image_link_${i}`])].filter(
    (u): u is string => typeof u === "string" && /^https?:\/\//.test(u),
  );
  const types = String(it.product_type ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (types.length && types.every((t) => HOME_TYPE.test(t))) return null;
  const colour = typeof it.color === "string" && it.color.trim() ? it.color.trim().replace(/^\w/, (c: string) => c.toUpperCase()) : null;

  return {
    brand: b,
    country,
    externalId: String(it.sku),
    // Some names end in an escaped zero-width space that arrives as literal "u200b".
    name: String(it.name).replace(/\u200b|\\?u200b$/g, "").trim(),
    url: String(it.url),
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency,
    inStock: it.in_stock !== false && it.in_stock !== "false",
    category: types[types.length - 1] || (typeof it.item_type === "string" && it.item_type.trim()) || null,
    gender: genderOf(b, it.gender),
    variants: null,
    groupKey: it.group_id ? `${b}-${it.group_id}` : null,
    colorName: colour,
  };
}

export async function listUrbn(b: UrbnBrand, country: CountryCode): Promise<ProductRecord[]> {
  const m = URBN_MARKETS[b]?.[country];
  if (!m) return [];
  const url = `https://rcom.dynamicyield.com/v3/recommend/${m.section}`;
  // rank = position in the widget's own (deterministic, popularity) order within the slice.
  const ranked: { r: ProductRecord; rank: number; slice: number }[] = [];
  const seen = new Set<string>();
  let calls = 0;
  let rows = 0;

  const slices = PRICE_CUTS.slice(0, -1).map((lo, i) => ({ lo, hi: PRICE_CUTS[i + 1], i }));
  await Promise.all(
    slices.map(async ({ lo, hi, i }) => {
      const skus: string[] = [];
      for (let page = 0; page < PAGES_PER_SLICE; page++) {
        calls++;
        const res = await getJson<any>(url, {
          country,
          method: "POST",
          // text/plain keeps it a "simple" request, exactly as the DY script sends it.
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: rcomBody(b, country, lo, hi, skus),
          timeoutMs: 45_000,
        });
        const slots: any[] = res?.response?.[0]?.slots ?? [];
        rows += slots.length;
        // A rule DY could not apply is dropped silently and the widget's default list comes back.
        if (slots.some((x) => x?.item?.is_markdown !== "1")) {
          console.warn(`${b}/${country}: DY ignored the markdown rule (slice ${lo}-${hi}); slice skipped`);
          break;
        }
        let fresh = 0;
        for (const x of slots) {
          const sku = x?.item?.sku;
          if (!sku || skus.includes(sku)) continue;
          skus.push(sku);
          fresh++;
          const r = mapUrbnItem(x.item, b, country);
          if (r && !seen.has(r.externalId)) {
            seen.add(r.externalId);
            ranked.push({ r, rank: skus.length, slice: i });
          }
        }
        if (slots.length < PAGE || !fresh) break;
      }
    }),
  );

  if (!ranked.length) throw new Error(`${b}/${country}: no discounted rows (${calls} calls, ${rows} feed rows)`);
  // Interleave the slices by rank so the cap keeps each price band's most popular colours.
  ranked.sort((a, z) => a.rank - z.rank || a.slice - z.slice);
  const all = ranked.map((x) => x.r);
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
