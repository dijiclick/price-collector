/**
 * VEJA (veja-store.com) — French sneakers, US and Canada stores on Salesforce
 * Commerce Cloud (`Sites-VEJA-USA-Site` en_US, `Sites-VEJA-NORTH-AMERICA-Site`
 * en_CA). Reductions live in the stores' own "Outlet" category (cgid OUTLET:
 * ~330 US / ~490 CA products, 2026-10-21), read through the SFRA grid
 * endpoint `Search-UpdateGrid?cgid=OUTLET&start=N&sz=120`.
 *
 * Each tile carries a `GTMProductTile` JSON (id, name), the struck `old` and
 * the `current` price ("$160" / "C$176"), and the quick-add size buttons:
 * a `<button>` per size in stock, a `<span class="… out-of-stock">` per size
 * sold out — real per-size stock.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { decodeEntities } from "./_sfcchtml";

const ORIGIN = "https://www.veja-store.com";
const MARKETS: Partial<Record<CountryCode, { site: string; locale: string; currency: string }>> = {
  US: { site: "VEJA-USA", locale: "en_US", currency: "USD" },
  CA: { site: "VEJA-NORTH-AMERICA", locale: "en_CA", currency: "CAD" },
};
const PAGE = 120;
const MAX_PAGES = 8;
const PAUSE_MS = Number(process.env.VEJA_PAUSE_MS ?? 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NOT_SHOES = /\b(t-?shirt|sweatshirt|hoodie|socks?|bag|tote|cap|beanie|jacket|pants|shorts|laces)\b/i;

/** "$1,160.50" / "C$176" → 1160.5 / 176. Pure. */
export function vejaAmount(s: string | undefined): number {
  const m = String(s ?? "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : NaN;
}

export function vejaTiles(html: string): string[] {
  return html.split('<div class="product" data-pid="').slice(1);
}

/** One grid tile → a record, or null without a struck price. Pure. */
export function mapVeja(tile: string, country: CountryCode): ProductRecord | null {
  const m = MARKETS[country];
  if (!m) return null;
  const pid = tile.slice(0, tile.indexOf('"'));
  let gtm: any = {};
  try {
    gtm = JSON.parse(tile.match(/class="GTMProductTile" type="application\/json">\s*([\s\S]*?)\s*<\/script>/)?.[1] ?? "{}");
  } catch {
    gtm = {};
  }
  const name = decodeEntities(String(gtm.item_name ?? tile.match(/product-tile__name">\s*([^<]+?)\s*</)?.[1] ?? "")).replace(/\s+/g, " ").trim();
  const was = vejaAmount(tile.match(/<span class="old">\s*([^<]+?)\s*</)?.[1]);
  const price = vejaAmount(tile.match(/<span class="current">\s*([^<]+?)\s*</)?.[1]);
  const href = tile.match(/class="product-tile__link" href="([^"]+)"/)?.[1];
  if (!pid || !name || !href || !Number.isFinite(price) || price <= 0 || !Number.isFinite(was) || was <= price) return null;
  const url = decodeEntities(href).replace(/\?cgid=[^&]*$/, "");
  const photos = [...tile.matchAll(/<img src="(https:\/\/media\.veja-store\.com\/[^"]+)"/g)].map((x) => x[1]);
  const images = cleanGallery(photos);
  const sizes: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const s of tile.matchAll(/<(button|span) [^>]*class="product-tile__quickview-size([^"]*)"[^>]*>\s*([^<]+?)\s*<\/\1>/g)) {
    const label = s[3].trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: s[1] === "button" && !/out-of-stock/.test(s[2]) ? "in_stock" : "out_of_stock" });
  }
  const kids = /^small\b/i.test(name);
  return {
    brand: "veja",
    country,
    externalId: pid,
    name,
    url,
    imageUrl: images?.[0] ?? null,
    images,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: m.currency,
    inStock: sizes.length ? sizes.some((s) => s.availability === "in_stock") : true,
    category: NOT_SHOES.test(name) ? null : "Sneakers",
    gender: kids ? "cocuk" : null,
    variants: sizes.length ? { colors: [], sizes } : null,
    groupKey: null,
    colorName: null,
  };
}

/** Register as `listVeja(country)`. US + CA outlet. */
export async function listVeja(country: CountryCode): Promise<ProductRecord[]> {
  const m = MARKETS[country];
  if (!m) return [];
  const byId = new Map<string, ProductRecord>();
  const base = `${ORIGIN}/on/demandware.store/Sites-${m.site}-Site/${m.locale}/Search-UpdateGrid?cgid=OUTLET`;
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) throw new Error(`veja/${country}: outlet exceeds ${MAX_PAGES * PAGE} products`);
    if (page > 0) await sleep(PAUSE_MS);
    const html = await getText(`${base}&start=${page * PAGE}&sz=${PAGE}`, {
      country,
      timeoutMs: 60_000,
      headers: { "X-Requested-With": "XMLHttpRequest", "Accept-Language": "en-US,en;q=0.9" },
    });
    const tiles = vejaTiles(html);
    if (page === 0 && !tiles.length && !/product-grid|search-results|no-results/i.test(html)) {
      throw new Error(`veja/${country}: the outlet grid came back without its markup`);
    }
    for (const t of tiles) {
      const r = mapVeja(t, country);
      if (r) byId.set(r.externalId, r);
    }
    if (tiles.length < PAGE) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)];
}
