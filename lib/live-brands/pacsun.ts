/**
 * PacSun (pacsun.com, US) by url: `/<brand>/<slug>-<pid>.html`. The shop's
 * `Product-Variation` JSON is behind Cloudflare (403 even with the app UA), but
 * `Tile-Show?pid=` — the grid's own tile renderer — answers the app UA with the
 * same tile the collector parses (packages/collector/src/brands/pacsun.ts):
 * `data-product_*` attributes, sale and list price, orderable sizes.
 */
import type { LiveProduct } from "../live-lookup";
import { countryFor, dispatcher, toMinor } from "../live-http";

const SITE = "https://www.pacsun.com";
const APP_UA = "okhttp/4.12.0";

export function pacsunPidFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname.toLowerCase().replace(/^www\./, "") !== "pacsun.com") return null;
  return u.pathname.match(/-(\d{9,})\.html$/)?.[1] ?? null;
}

const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'") : null;
};
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** Map a Tile-Show fragment. Pure. */
export function mapPacsunTileShow(html: string, url: string): LiveProduct | null {
  const head = html.match(/<div class="product-tile"[^>]*>/)?.[0] ?? "";
  const bag = html.match(/<button data-click_name="Add to Bag"[^>]*>/)?.[0] ?? "";
  const pid = attr(head, "data-product_id");
  const name = (attr(head, "data-product_name") ?? "").replace(/\s+/g, " ").trim();
  const block = html.slice(Math.max(0, html.indexOf('<div class="price">')));
  const sale = Number(block.match(/bfx-sale-price"\s+content="([\d.]+)"/)?.[1]);
  const list = Number(block.match(/bfx-list-price"\s+content="([\d.]+)"/)?.[1]);
  const price = Number.isFinite(sale) && sale > 0 ? sale : list;
  if (!pid || !name || !Number.isFinite(price) || price <= 0) return null;
  const img = html.match(/https:\/\/www\.pacsun\.com\/dw\/image\/v2\/[^"\s?,]+\.jpg/)?.[0];
  const division = attr(bag, "data-product_division") ?? "";
  const colour = attr(head, "data-product_color");
  return {
    brand: "pacsun",
    externalId: pid,
    name,
    url,
    imageUrl: img ? `${img}?sw=900` : null,
    price: toMinor(price),
    listPrice: Number.isFinite(list) && list > price ? toMinor(list) : null,
    // A sold-out style renders no orderable size buttons.
    inStock: /js-quick-shop-attribute[^"]*"[^>]*data-attr="size"/.test(html) || !/js-quick-shop-attribute-size/.test(html),
    category: attr(bag, "data-product_subdepartment"),
    type: null,
    gender: /^women/i.test(division) ? "kadin" : /^men/i.test(division) ? "erkek" : /kid/i.test(division) ? "cocuk" : null,
    colorName: colour ? titleCase(colour) : null,
    country: "US",
    currency: "USD",
  };
}

export async function pacsunUrl(url: string): Promise<LiveProduct | null> {
  const pid = pacsunPidFromUrl(url);
  if (!pid) return null;
  try {
    const r = await fetch(`${SITE}/on/demandware.store/Sites-pacsun-Site/default/Tile-Show?pid=${pid}`, {
      headers: { "User-Agent": APP_UA, "X-Requested-With": "XMLHttpRequest" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(countryFor("pacsun", "US")),
    });
    if (!r.ok) {
      console.warn(`live-lookup: www.pacsun.com refused with HTTP ${r.status}`);
      return null;
    }
    return mapPacsunTileShow(await r.text(), url.split("#")[0]);
  } catch (err) {
    console.warn(`live-lookup: www.pacsun.com unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
