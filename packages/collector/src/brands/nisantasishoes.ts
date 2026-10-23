import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { mapShopify } from "./_shopify";
import { basketPercent, basketPrice } from "../../../../lib/live-brands/nisantasishoes";

/**
 * Nişantaşı Shoes — Shopify (`www.nisantasishoes.com`, Istanbul, currency TRY;
 * women's shoes plus a few bags). `/products.json?limit=250&page=N` is the
 * whole catalogue: 644 products on 2026-10-23, 622 in stock, one `Numara`
 * (size) option each. A GitHub runner gets the same TRY catalogue as a Turkish
 * line, 30 back-to-back pages without a refusal (probe run 40022002288); this
 * Mac's home IP was answered `local_rate_limited` for an hour, so pages are
 * paused and a 429 is backed off as for QUZU.
 *
 * PRICES. No product has a compare-at price; the shop's reductions are basket
 * discounts driven by tags (`indirimNN`, else 5 % for the `KIŞK` season — see
 * lib/live-brands/nisantasishoes.ts, measured on 37 product pages). The basket
 * price is the price, the shelf price the list price, like DeFacto / LCW /
 * Altınbaş. 2026-10-23: 336 `indirimNN` rows (138 at 50 %, 133 at 20 %) and
 * 300 winter rows at 5 %.
 *
 * FULL CATALOGUE: every in-stock product is returned, reduced or not
 * (full price = `listPrice: null`), plus sold-out reduced rows. Any refused
 * page fails the run — a partial walk would let the sweep mark live products
 * out of stock.
 */
export const SITE = "https://www.nisantasishoes.com";
const MAX_PAGES = Number(process.env.NISANTASI_MAX_PAGES ?? 12);
const PAUSE_MS = Number(process.env.NISANTASI_PAUSE_MS ?? 1500);

export const brand = "nisantasishoes";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Map one `/products.json` product. Pure. */
export function mapNisantasi(p: any): ProductRecord | null {
  const r = mapShopify({ brand, sites: { TR: SITE } }, "TR", SITE, p);
  if (!r) return null;
  const pct = basketPercent(p?.tags);
  const shelf = r.price;
  return {
    ...r,
    price: pct ? basketPrice(shelf, pct) : shelf,
    listPrice: pct ? r.listPrice ?? shelf : r.listPrice,
    // product_type is a slug ("topuklu_sandalet") or empty.
    category: r.category ? r.category.replace(/_/g, " ") : null,
    // Women's only: every title says "Kadın" — no need for the tag heuristic.
    gender: "kadin",
  };
}

async function page(n: number): Promise<any[] | null> {
  const url = `${SITE}/products.json?limit=250&page=${n}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const data = await getJson<any>(url, {
      retries: 0,
      country: "TR",
      headers: { cookie: "localization=TR; cart_currency=TRY" },
    }).catch(() => null);
    if (Array.isArray(data?.products)) return data.products;
    // Shopify answers 429 / `local_rate_limited` when paged too fast: back off.
    await sleep(4000 * (attempt + 1));
  }
  return null;
}

export async function listProducts(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  let ended = false;
  for (let n = 1; n <= MAX_PAGES; n++) {
    if (n > 1) await sleep(PAUSE_MS);
    const rows = await page(n);
    if (rows === null) throw new Error(`nisantasishoes: products.json page ${n} refused`);
    for (const p of rows) {
      const r = mapNisantasi(p);
      if (r && (r.inStock || r.listPrice != null)) byId.set(r.externalId, r);
    }
    if (rows.length < 250) { ended = true; break; }
  }
  // Running out of pages before the catalogue ends would sweep the unseen rest.
  if (!ended) throw new Error(`nisantasishoes: more than ${MAX_PAGES} pages, raise NISANTASI_MAX_PAGES`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)];
}
