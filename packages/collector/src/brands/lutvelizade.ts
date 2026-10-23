/**
 * Lutvelizade (lutvelizade.com.tr; lutvelizade.com redirects there) — women's
 * shoes, bags and accessories on the brand's own ASP.NET storefront
 * (2026-10-23). No JSON route: the category grids are server-rendered HTML,
 * 16 cards a page by default, but `?pn=1&ps=1000` returns a whole category in
 * one response (shoes: 442 cards, 2.3 MB, ~10 s). No proxy: plain requests
 * from a Turkish line answer, no bot wall in front (IIS, no CDN).
 *
 * WHICH PAGES. The sitemap names every category (`/kadin-…-modelleri`) and its
 * 527 product urls; the union of those category grids plus the
 * `sale-etiketli-urunler` tag held 526 of them (2026-10-23). The sitemap is
 * read each run, so a new category is picked up without a code change.
 *
 * EACH CARD is one colour: `data-ga4-id` (SKU-colour, the id), `data-ga4-name`,
 * `data-ga4-category`, `data-ga4-variant` (colour), the link (`/…-p`), three
 * photos (`src`, `data-alt1`, `data-alt2`), and either one price or
 * `<span class="discounted">` (charged) + `<span class="invalid">` (struck).
 *
 * STOCK. `data-available="0"` cards are sold out ("ÜRÜN TÜKENDİ" ribbon) and
 * their link 301s to the home page (349 of 526 on 2026-10-23). They are still
 * returned, as `inStock: false` and last: a tracked product is spared the
 * sweep's "missing means sold out" rule because a resolver exists, and the
 * resolver cannot price a page that redirects home, so the sweep is the only
 * place a sell-out is seen. Per-size stock is on the product page (`class="disable" title="Stokta Yok"`
 * on a sold-out size), read for a bounded, rotating subset per run.
 *
 * FULL CATALOGUE: every card, reduced or not (full price =
 * `listPrice: null`), like the other Turkish shops since 2026-10-19. A grid
 * that fails fails the run: a partial walk would let the delist sweep mark
 * its cards sold out.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { decodeEntities } from "./_sfcchtml";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "lutvelizade";
export const SITE = "https://www.lutvelizade.com.tr";
const PAGE_SIZE = 1000;
/** Product-page size reads per run (deals first). */
const DETAIL_LIMIT = Number(process.env.LUTVELIZADE_DETAIL_LIMIT ?? 30);
const FULL_DETAIL_LIMIT = Number(process.env.LUTVELIZADE_FULL_DETAIL_LIMIT ?? 15);
const PAUSE_MS = Number(process.env.LUTVELIZADE_PAUSE_MS ?? 300);
const TIMEOUT_MS = 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Grid paths to walk: every `/kadin-…-modelleri` category in the sitemap, plus the sale tag. */
export function gridPaths(sitemap: string): string[] {
  const cats = [...sitemap.matchAll(/<loc>\s*https?:\/\/[^/<]+(\/kadin-[a-z0-9-]+-modelleri)\s*<\/loc>/g)].map((m) => m[1]);
  return [...new Set(["/sale-etiketli-urunler", ...cats])];
}

export const gridUrl = (path: string, page = 1) => `${SITE}${path}?pn=${page}&ps=${PAGE_SIZE}`;

/** "1.299,90 TL" / "389,97 TL" → 129990 / 38997. */
export function parseTl(s: string | undefined | null): number | null {
  if (!s) return null;
  const n = Number(s.replace(/[^\d,.]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? toMinor(n) : null;
}

const attr = (html: string, name: string): string | null => {
  const m = html.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decodeEntities(m[1]).trim() : null;
};

/** Split a grid page into its cards (each starts at the column div carrying `data-ga4-id`). */
export function splitCards(html: string): string[] {
  // Cut at each card's start (not split(): it skips a zero-width match at index 0).
  const starts = [...html.matchAll(/<div[^>]*\sdata-ga4-id="/g)].map((m) => m.index!);
  return starts.map((s, i) => html.slice(s, starts[i + 1] ?? html.length));
}

/** Map one grid card. Pure. Null for a card without an id, link or price. */
export function mapCard(card: string): (ProductRecord & { available: boolean }) | null {
  const id = attr(card, "data-ga4-id");
  const href = card.match(/<a [^>]*href="(\/[^"]+-p)"/)?.[1];
  const name = attr(card, "data-ga4-name") ?? attr(card, "title");
  const priceBox = card.match(/<div class="price">([\s\S]*?)<\/div>/)?.[1] ?? "";
  const now = parseTl(priceBox.match(/class="discounted">([^<]+)</)?.[1] ?? priceBox.match(/<span>([^<]+)</)?.[1]);
  const was = parseTl(priceBox.match(/class="invalid">([^<]+)</)?.[1]);
  if (!id || !href || !name || now == null) return null;
  const img = card.match(/<img [^>]*class="product-img[^"]*"[^>]*>/)?.[0] ?? "";
  // The shop's sneaker category is plain "Spor", which alone names no product type.
  const cat = attr(card, "data-ga4-category");
  const first = attr(img, "data-original") ?? attr(img, "src");
  const gallery = [first, attr(img, "data-alt1"), attr(img, "data-alt2")];
  return {
    brand,
    country: "TR",
    externalId: id,
    name: name.replace(/\s+/g, " "),
    url: `${SITE}${href}`,
    imageUrl: first,
    images: cleanGallery(gallery, first),
    price: now,
    listPrice: was != null && was > now ? was : null,
    currency: "TRY",
    inStock: attr(card, "data-available") === "1",
    available: attr(card, "data-available") === "1",
    category: cat === "Spor" ? "Spor Ayakkabı" : cat,
    gender: "kadin", // a women's shop; every name says "Kadın"
    variants: null,
    colorName: attr(card, "data-ga4-variant"),
  };
}

/** Sizes from a product page's size list; a sold-out size is `class="disable"`. Pure. */
export function pageSizes(html: string): SizeVariant[] {
  const box = html.match(/class="variation size"[\s\S]*?<ul>([\s\S]*?)<\/ul>/)?.[1] ?? "";
  const out: SizeVariant[] = [];
  for (const m of box.matchAll(/<a ([^>]*)>([^<]*)<\/a>/g)) {
    const label = decodeEntities(m[2]).trim();
    if (!label || out.some((s) => s.label === label)) continue;
    out.push({ label, availability: /class="[^"]*\bdisable\b/.test(m[1]) ? "out_of_stock" : "in_stock" });
  }
  return out;
}

const shuffle = <T>(xs: T[]): T[] => {
  const a = [...xs];
  for (let j = a.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [a[j], a[k]] = [a[k], a[j]];
  }
  return a;
};

async function grid(path: string): Promise<string[]> {
  const cards: string[] = [];
  for (let page = 1; page <= 5; page++) {
    if (page > 1) await sleep(PAUSE_MS);
    const html = await getText(gridUrl(path, page), { timeoutMs: TIMEOUT_MS }).catch(async () => {
      await sleep(1000);
      return getText(gridUrl(path, page), { timeoutMs: TIMEOUT_MS });
    }).catch((e) => {
      throw new Error(`lutvelizade: grid ${path} page ${page} failed (${e?.message ?? e})`);
    });
    const got = splitCards(html);
    cards.push(...got);
    if (got.length < PAGE_SIZE) break;
  }
  return cards;
}

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (country !== "TR") return [];
  const sitemap = await getText(`${SITE}/sitemap.xml`, { timeoutMs: TIMEOUT_MS });
  const paths = gridPaths(sitemap);
  if (paths.length < 3) throw new Error(`lutvelizade: sitemap named only ${paths.length} grids`);

  const byId = new Map<string, ProductRecord>();
  let cards = 0;
  for (const path of paths) {
    await sleep(PAUSE_MS);
    for (const html of await grid(path)) {
      cards++;
      const r = mapCard(html);
      if (!r || byId.has(r.externalId)) continue;
      const { available: _, ...row } = r;
      byId.set(row.externalId, row);
    }
  }
  const rows = [...byId.values()];
  const live = rows.filter((r) => r.inStock);
  if (!live.length) throw new Error(`lutvelizade: ${cards} cards, none available`);
  const deals = live.filter((r) => r.listPrice != null);
  const full = live.filter((r) => r.listPrice == null);
  const soldOut = rows.filter((r) => !r.inStock);
  const want = [...shuffle(deals).slice(0, DETAIL_LIMIT), ...shuffle(full).slice(0, FULL_DETAIL_LIMIT)];
  for (const r of want) {
    await sleep(PAUSE_MS);
    const html = await getText(r.url, { timeoutMs: 20_000 }).catch(() => null);
    const sizes = html ? pageSizes(html) : [];
    if (!sizes.length) continue;
    r.variants = { colors: r.colorName ? [r.colorName] : [], sizes };
    r.inStock = sizes.some((s) => s.availability !== "out_of_stock");
  }
  if (process.env.LUTVELIZADE_DEBUG) console.error(`lutvelizade: ${paths.length} grids, ${cards} cards, ${rows.length} rows, ${deals.length} in-stock deals, ${soldOut.length} sold out`);
  return [...deals, ...full, ...soldOut];
}
