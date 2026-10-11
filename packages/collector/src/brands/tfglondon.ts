/**
 * TFG London UK — Whistles, Hobbs, Phase Eight. One SFCC (SFRA) platform, one
 * Constructor.io account (`tfg-london`), one adapter.
 *
 * Constructor's browse API answers with public keys but carries no prices (only
 * `max_price`), and OCAPI refuses without a registered client id, so the data
 * comes from the storefront's own grid endpoint, `Search-UpdateGrid` on the
 * sale category: each tile has a `data-tracking` JSON with price,
 * originalPrice, colour, group id, image and url (measured 2026-10-11, plain
 * request). Sizes are not on the tile — they would cost one QuickShop call per
 * product — so these rows carry no per-size stock.
 *
 * Hobbs and Phase Eight show "Promo price" tiles: the extra-off price the site
 * itself displays over the struck-through original. Kept only when strictly
 * below the original.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { attrValues, jsonOf, poundsOf } from "./_sfcchtml";

export type TfgSlug = "whistles" | "hobbs" | "phase-eight";

interface TfgSite {
  site: string;
  /** SFCC site id inside `/on/demandware.store/Sites-<id>-Site/en/`. */
  siteId: string;
  cgid: string;
  /** Tiles per grid call — the server caps it (Whistles 48, Hobbs/Phase Eight 60). */
  pageSize: number;
}

export const TFG_SITES: Record<TfgSlug, TfgSite> = {
  whistles: { site: "https://www.whistles.com", siteId: "WH-UK", cgid: "Sale_WW", pageSize: 48 },
  hobbs: { site: "https://www.hobbs.com", siteId: "HB-UK", cgid: "sale", pageSize: 60 },
  "phase-eight": { site: "https://www.phase-eight.com", siteId: "P8-UK", cgid: "sale", pageSize: 60 },
};

const PAUSE_MS = Number(process.env.TFG_PAUSE_MS ?? 600);
const MAX_CALLS = 45;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One tile's `data-tracking` object → record. Pure. */
export function mapTfgTile(slug: TfgSlug, tracking: any, country: CountryCode = "GB"): ProductRecord | null {
  const it = tracking?.item ?? tracking;
  const list = tracking?.item_list ?? {};
  const price = poundsOf(it?.price);
  const orig = poundsOf(it?.originalPrice);
  if (!it?.id || !it?.name || !it?.url || !Number.isFinite(price) || price <= 0) return null;
  const imgs: string[] = (it.images ?? []).filter((u: unknown) => typeof u === "string");
  const colour = typeof list.item_colour === "string" && list.item_colour.trim() ? list.item_colour.trim() : null;
  const cat = [it.category1, it.category0, list.item_category3, list.item_category2].find((c) => typeof c === "string" && c.trim());
  return {
    brand: slug,
    country,
    externalId: String(it.id),
    name: String(it.name).replace(/\s+/g, " ").trim(),
    url: String(it.url).startsWith("http") ? String(it.url) : `${TFG_SITES[slug].site}${it.url}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: Number.isFinite(orig) && orig > price ? toMinor(orig) : null,
    currency: COUNTRIES[country].currency,
    inStock: true, // the grid lists orderable products only; `stock` on the tile is always 0
    category: cat ? String(cat).trim() : null,
    gender: "kadin",
    variants: null,
    groupKey: it.group_id ? `${slug}:${it.group_id}` : null,
    colorName: colour,
  };
}

/** Every product tile on one grid page, in order. */
export function parseTfgGrid(html: string): any[] {
  return attrValues(html, "data-tracking")
    .map((v) => jsonOf(v))
    .filter((o): o is any => !!o && !!(o.item ?? o).id && (o.item ?? o).originalPrice !== undefined);
}

/** "2,264 items" / "3,785 styles" in the grid header, or null. */
export function gridTotal(html: string): number | null {
  const m = html.match(/([\d,]+)\s*(?:items|styles|products|results)\b/i);
  const n = m ? Number(m[1].replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Register as `listTfgLondon("whistles" | "hobbs" | "phase-eight", country)`. GB only. */
export async function listTfgLondon(slug: TfgSlug, country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "GB") return [];
  const cfg = TFG_SITES[slug];
  const cap = 1500;
  const byId = new Map<string, ProductRecord>();
  let pages = MAX_CALLS;
  for (let n = 1; n <= Math.min(pages, MAX_CALLS) && byId.size < cap; n++) {
    if (n > 1) await sleep(PAUSE_MS);
    // The grid is Constructor-backed: `startPageNumber` picks the page and `start`
    // is ignored. The default relevance order reshuffles between calls (whole
    // pages came back twice), so page by price, which holds still.
    const url =
      `${cfg.site}/on/demandware.store/Sites-${cfg.siteId}-Site/en/Search-UpdateGrid?cgid=${cfg.cgid}` +
      `&start=${(n - 1) * cfg.pageSize}&sz=${cfg.pageSize}&startPageNumber=${n}&sort_by=Price&sort_order=descending`;
    const html = await getText(url, { country });
    if (n === 1) {
      const total = gridTotal(html);
      if (total) pages = Math.ceil(total / cfg.pageSize);
    }
    const tiles = parseTfgGrid(html);
    if (!tiles.length) break;
    for (const t of tiles) {
      const r = mapTfgTile(slug, t, country);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
    // Pages come back a few tiles short (content slots), so only the header total
    // decides the end — past it the grid starts over rather than running dry.
  }
  return [...byId.values()].slice(0, cap);
}
