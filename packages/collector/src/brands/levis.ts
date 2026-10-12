/**
 * Levi's (levi.com) — US and Canada, from the Constructor.io index the
 * storefront's own search and category pages read.
 *
 * levi.com is SAP Commerce behind Akamai: every HTML page answers 403 (Mac and
 * runners alike), and its GraphQL gateway (`/nextgen-webhooks/`) 403s Node's
 * default TLS hello. The product grid itself comes from Constructor, whose
 * public per-locale keys sit in the storefront's beacon bundle
 * (`cnstrc.com/js/cust/levis_uuLl-p.js`). `ac.cnstrc.com` answers a plain GET
 * from a GitHub runner — no proxy (probe run 38229348541, 2026-10-12).
 *
 * One Constructor result is one style; its `variations` are that style's
 * colours (US index) or colour × size SKUs (Canada index — the SKU id is the
 * 9-character colour code `pc9` plus a size code, `A55660012` + `02530` =
 * W25 L30). `filters[stockstatus]` keeps only buyable variations, so every row
 * is in stock and, in Canada, carries its in-stock sizes. Each colour's list
 * (`pricing`) and current price (`sale_price`, the site's strikethrough) are
 * read from its own variations.
 *
 * Markets: only US and CA. GB/CH/the EU have no sale group in Constructor and
 * their Constructor prices carry no strikethrough; AU and NO are not levi.com.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "levis";

interface Market {
  /** Public Constructor key for this storefront locale (from the beacon bundle). */
  key: string;
  /** Storefront path prefix, e.g. `US/en_US`. */
  path: string;
  currency: string;
}

export const LEVIS_MARKETS: Partial<Record<CountryCode, Market>> = {
  US: { key: "key_zFHxDQOZtEEStIHX", path: "US/en_US", currency: "USD" },
  CA: { key: "key_GfWB03r1rdbbOuWJ", path: "CA/en_CA", currency: "CAD" },
};

/** Sale sub-groups, women first so the cap (if ever reached) favours them. */
const GROUPS: { id: string; gender: ProductRecord["gender"] }[] = [
  { id: "levi_clothing_women_sale", gender: "kadin" },
  { id: "levi_clothing_men_sale", gender: "erkek" },
];
const PAGE_SIZE = 200;
const MAX_PAGES = 6;
const CAP = 1500;

export function browseUrl(country: CountryCode, group: string, page: number): string {
  const m = LEVIS_MARKETS[country];
  if (!m) throw new Error(`levis: no market ${country}`);
  // Hand-built so the repeated `filters[stockstatus]` stays an OR of both values.
  return (
    `https://ac.cnstrc.com/browse/group_id/${group}?key=${m.key}&c=ciojs-client-2.66.0` +
    `&num_results_per_page=${PAGE_SIZE}&page=${page}` +
    `&filters%5Bstockstatus%5D=IN_STOCK&filters%5Bstockstatus%5D=LIMITED_STOCK`
  );
}

const num = (x: unknown): number | null => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const slug = (s: string) =>
  s.toLowerCase().replace(/®|™/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Constructor's url is a display path ("Clothing/Women/Jeans/Straight/501® …/p/A1959"); the storefront's is its slug. */
export function productUrl(country: CountryCode, rawUrl: string, pc9: string): string {
  const m = LEVIS_MARKETS[country]!;
  const segs = String(rawUrl ?? "").split("/p/")[0].split("/").map(slug).filter(Boolean);
  return `https://www.levi.com/${m.path}/${segs.length ? segs.join("/") + "/" : ""}p/${pc9}`;
}

// Sections, sale/merch buckets and fit ranges, not product types.
const SKIP_SEG =
  /^(clothing|accessories|accessories for all|women|men|kids|unisex|(women.s |men.s )?sale|deals|apparel|big & tall|plus size|jeans by fit number|\d+ .*series)$/i;
/** First merchandising segment of the display path that is not the section or the product's own name. */
export function categoryOf(rawUrl: string): string | null {
  const segs = String(rawUrl ?? "").split("/p/")[0].split("/").map((s) => s.trim()).filter(Boolean);
  segs.pop(); // product name
  const c = segs.find((s) => !SKIP_SEG.test(s) && !/\?/.test(s));
  return c ?? null;
}

/** Scene7 rendition small enough for a feed card (the `$qv_desktop$` preset is ~800 KB). */
const img = (u: string) => u.split("?")[0] + "?fmt=jpeg&qlt=80&wid=1000";

function galleryOf(d: any): string[] {
  const list: any[] = Array.isArray(d?.groupedmedias?.galleryImage) ? d.groupedmedias.galleryImage : [];
  const rank = (g: any) => {
    const ix = String(g?.galleryIndex ?? "");
    if (/-main$/.test(ix)) return -1;
    const n = Number(ix.match(/-alt(\d+)$/)?.[1]);
    return Number.isFinite(n) ? n : 999;
  };
  return [...list]
    // `_SW` is the colour swatch chip, not a photo.
    .filter((g) => typeof g?.url === "string" && /^https?:\/\//.test(g.url) && !/_SW(\?|$)/.test(g.url))
    .sort((a, b) => rank(a) - rank(b))
    .map((g) => img(g.url));
}

/** "02530" → "W25 L30", "028" → "28", "0XL" → "XL"; null when the SKU id carries no size. */
export function sizeLabel(variationId: string, pc9: string): string | null {
  if (!variationId.startsWith(pc9) || variationId.length <= pc9.length) return null;
  const code = variationId.slice(pc9.length).replace(/^0(?=.)/, "");
  const wl = code.match(/^(\d{2})(\d{2})$/);
  if (wl) return `W${wl[1]} L${wl[2]}`;
  return code || null;
}

/** Map one Constructor result (one style) to its discounted colours. Pure. */
export function mapLevisResult(country: CountryCode, res: any, gender: ProductRecord["gender"] = null): ProductRecord[] {
  const m = LEVIS_MARKETS[country];
  const item = res?.data;
  const name = String(res?.value ?? "").trim();
  if (!m || !item || !name) return [];
  const variations: any[] = Array.isArray(res?.variations) && res.variations.length ? res.variations : [{ data: item }];

  const byColour = new Map<string, any[]>();
  for (const v of variations) {
    const pc9 = String(v?.data?.pc9 ?? "");
    if (!/^[A-Z0-9]{9}$/i.test(pc9)) continue;
    if (Number(v.data.soldoutforever) === 1) continue;
    const list = byColour.get(pc9) ?? [];
    list.push(v.data);
    byColour.set(pc9, list);
  }

  const out: ProductRecord[] = [];
  for (const [pc9, rows] of byColour) {
    // Every SKU of a colour carries the same price pair; take the lowest pair
    // that is a real markdown, never min-sale vs max-list across sizes.
    let best: { sale: number; list: number } | null = null;
    for (const d of rows) {
      const list = num(d.pricing);
      const sale = num(d.sale_price);
      if (list == null || sale == null || sale >= list) continue;
      if (!best || sale < best.sale) best = { sale, list };
    }
    if (!best) continue;

    const sizes: SizeVariant[] = [];
    const seen = new Set<string>();
    for (const d of rows) {
      const label = sizeLabel(String(d.variation_id ?? ""), pc9);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      const st = String(d.stockstatus ?? "");
      sizes.push({ label, availability: st === "OUT_OF_STOCK" ? "out_of_stock" : st === "LIMITED_STOCK" ? "low_on_stock" : "in_stock" });
    }
    const stocks = rows.map((d) => String(d.stockstatus ?? ""));
    const inStock = stocks.some((s) => s === "IN_STOCK" || s === "LIMITED_STOCK");

    const head = rows.find((d) => d.groupedmedias) ?? rows[0];
    const gallery = galleryOf(head);
    const imageUrl = gallery[0] ?? null;
    out.push({
      brand,
      country,
      externalId: pc9,
      name,
      url: productUrl(country, head.url ?? item.url, pc9),
      imageUrl,
      images: cleanGallery(gallery, imageUrl),
      price: toMinor(best.sale),
      listPrice: toMinor(best.list),
      currency: m.currency,
      inStock,
      category: categoryOf(head.url ?? item.url),
      gender,
      variants: sizes.length ? { colors: [], sizes } : null,
      // Colours of one style share Constructor's item id (Levi's pdpGroupId).
      groupKey: item.id ? `${brand}:${country}:${item.id}` : null,
      colorName: null,
    });
  }
  return out;
}

export async function listLevis(country: CountryCode): Promise<ProductRecord[]> {
  if (!LEVIS_MARKETS[country]) return [];
  const byId = new Map<string, ProductRecord>();
  for (const g of GROUPS) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await getJson<any>(browseUrl(country, g.id, page), { country, retries: 2 });
      const r = data?.response;
      const results: any[] = Array.isArray(r?.results) ? r.results : [];
      for (const res of results) {
        for (const rec of mapLevisResult(country, res, g.gender)) {
          if (!byId.has(rec.externalId)) byId.set(rec.externalId, rec);
        }
      }
      const total = Number(r?.total_num_results ?? 0);
      if (results.length < PAGE_SIZE || page * PAGE_SIZE >= total) break;
    }
  }
  const rows = [...byId.values()];
  if (!rows.length) throw new Error(`levis/${country}: Constructor returned no discounted in-stock rows`);
  // In stock first (all are, by the filter), then deepest discount.
  rows.sort(
    (a, b) =>
      Number(b.inStock) - Number(a.inStock) ||
      a.price / (a.listPrice ?? a.price) - b.price / (b.listPrice ?? b.price),
  );
  return rows.slice(0, CAP);
}
