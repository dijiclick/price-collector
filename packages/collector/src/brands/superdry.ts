/**
 * Superdry — superdry.com (GBP) and superdry.ie (EUR). Added 2026-11-10.
 *
 * Salesforce Commerce Cloud. The sale listing's infinite-scroll fragment
 * (`Search-UpdateGrid?cgid=<sale category>&start=N&sz=96`) is server-rendered
 * HTML that answers a GitHub runner (probe run 42803687149). Each
 * `.product-tile` carries its GA4 payload in `data-gtm`: `price` (charged),
 * `item_orig_price` (struck), `item_class` (Dresses), `item_colour`, and the
 * market's `currency` — a tile in another currency is refused rather than
 * stored. The link and the photos come from the tile's own markup.
 *
 * The sale category mixes the season's markdowns with the Outlet (past
 * seasons); both are prices the site charged before. No sizes on the tile.
 * A page is ~1.3 MB of HTML, so the walk is capped at 12 pages a market.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { attrOf, decodeEntities, jsonOf } from "./_sfcchtml";

interface SdMarket { site: string; grid: string }

export const SUPERDRY_MARKETS: Partial<Record<CountryCode, SdMarket>> = {
  GB: { site: "https://www.superdry.com", grid: "https://www.superdry.com/on/demandware.store/Sites-sd-uk-Site/en_GB/Search-UpdateGrid" },
  IE: { site: "https://www.superdry.ie", grid: "https://www.superdry.ie/on/demandware.store/Sites-sd-europe-Site/en_IE/Search-UpdateGrid" },
};

/** Sale category ids (the same on both sites): women's and men's "view all". */
const SECTIONS: [cgid: string, gender: ProductRecord["gender"], cap: number][] = [
  ["32043", "kadin", 760],
  ["32042", "erkek", 280],
];
const PAGE = 96;
const MAX_CALLS = Number(process.env.SUPERDRY_MAX_CALLS ?? 12);
const PAUSE_MS = Number(process.env.SUPERDRY_PAUSE_MS ?? 900);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

/** Each product tile's HTML (from its `data-gtm` div to the next one). Pure. */
export function superdryTiles(html: string): string[] {
  const parts = html.split(/(?=<div class="product-tile[^"]*" data-gtm=)/);
  return parts.filter((p) => p.startsWith('<div class="product-tile'));
}

/** One tile → record, or null. Pure. */
export function mapSuperdryTile(tile: string, country: CountryCode, gender: ProductRecord["gender"]): ProductRecord | null {
  const m = SUPERDRY_MARKETS[country];
  const head = tile.slice(0, tile.indexOf(">") + 1);
  const gtm = jsonOf<any>(attrOf(head, "data-gtm") ?? "");
  const item = gtm?.ecommerce?.items?.[0];
  const currency = COUNTRIES[country].currency;
  if (!m || !item?.item_id || !item?.item_name) return null;
  if (gtm.ecommerce.currency && gtm.ecommerce.currency !== currency) return null;
  const price = Number(item.price);
  const was = Number(item.item_orig_price);
  const href = /<a class="tile-link" href="([^"]+)"/.exec(tile)?.[1];
  if (!href || !Number.isFinite(price) || price <= 0) return null;
  const imgs = [...tile.matchAll(/<img class="tile-image[^"]*"[\s\S]*?\ssrc="([^"]+)"/g)].map((x) => decodeEntities(x[1]).replace(/width=\d+/, "width=900"));
  const colour = typeof item.item_colour === "string" && item.item_colour ? titleCase(item.item_colour) : null;
  const url = decodeEntities(href);
  return {
    brand: "superdry",
    country,
    externalId: String(item.item_id),
    name: String(item.item_name).replace(/\s+/g, " ").trim(),
    url: url.startsWith("http") ? url : `${m.site}${url}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: Number.isFinite(was) && was > price ? toMinor(was) : null,
    currency,
    inStock: true, // the grid lists orderable products only
    category: typeof item.item_class === "string" && item.item_class ? item.item_class : null,
    gender,
    variants: null,
    colorName: colour,
  };
}

export async function listSuperdry(country: CountryCode): Promise<ProductRecord[]> {
  const m = SUPERDRY_MARKETS[country];
  if (!m) return [];
  const out: ProductRecord[] = [];
  const ids = new Set<string>();
  let calls = 0;
  for (const [cgid, gender, cap] of SECTIONS) {
    let taken = 0;
    pages: for (let start = 0; calls < MAX_CALLS; start += PAGE) {
      if (calls++ > 0) await sleep(PAUSE_MS);
      const html = await getText(`${m.grid}?cgid=${cgid}&prefn1=sdLocaleOnlineFlag&prefv1=1&srule=best-match&start=${start}&sz=${PAGE}`, { country, timeoutMs: 45_000 });
      const tiles = superdryTiles(html);
      if (!tiles.length) {
        if (start === 0 && !out.length) throw new Error(`superdry/${country}: sale grid ${cgid} came back without tiles`);
        break;
      }
      for (const t of tiles) {
        const r = mapSuperdryTile(t, country, gender);
        if (!r || r.listPrice == null || ids.has(r.externalId)) continue;
        ids.add(r.externalId);
        out.push(r);
        if (++taken >= cap) break pages;
      }
      if (tiles.length < PAGE) break;
    }
  }
  return out;
}
