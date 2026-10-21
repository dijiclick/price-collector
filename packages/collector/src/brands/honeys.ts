/**
 * Honeys (Japan, women's) from the store's own SALE event list,
 * `www.honeys-onlineshop.com/shop/e/eevSale/` (2026-10-21).
 *
 * ecbeing platform, server-rendered Shift_JIS HTML, no JSON feed. The sale list
 * is ~830 colour rows, 60 a page (`eevSale_p2/`, `_p3/` …); every card prints
 * the sale price (`pop_price_`) above the store's own regular price
 * (`default_price_`), so the strike price is the shop's, not derived.
 * Akamai fronts the site but lets a GitHub runner through (probe 39634410176:
 * 200) — no proxy.
 *
 * Honeys sells women's clothing only (GLACIER, CINEMA CLUB, C·O·L·Z·A …), so
 * gender is `kadin`. The cards carry no category, so the type comes from the
 * Japanese name through `jaCategory`. Lucky bags (福袋 / ハッピーバッグ) are
 * mystery sets, not a product, and are skipped.
 */
import type { ProductRecord } from "../types";
import { cleanGallery } from "../types";
import { jaCategory } from "./_ja-category";

export const brand = "honeys";
const BASE = "https://www.honeys-onlineshop.com";
const PER_PAGE = 60;
const MAX_PAGES = 25; // 1,500 rows
const CAP = 1500;
const PAUSE_MS = 700;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const pageUrl = (page: number): string => `${BASE}/shop/e/eevSale${page > 1 ? `_p${page}` : ""}/`;

/** "￥1,480（税込）" → 148000 (yen × 100). */
export function yen(s: string | undefined): number | null {
  const n = Number(String(s ?? "").replace(/[^\d]/g, ""));
  return n > 0 ? n * 100 : null;
}

/** "1〜60件 (全 833件)" → 833. Pure. */
export function parseTotal(html: string): number | null {
  const m = /全\s*([\d,]+)\s*件/.exec(html);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

/** Every card on one sale page. Pure; null-safe on markup drift (rows are skipped, not invented). */
export function parseCards(html: string): ProductRecord[] {
  const out: ProductRecord[] = [];
  for (const block of html.split('<div class="StyleP_Item_">').slice(1)) {
    const code = /href="\/shop\/g\/g(\d+)\/"/.exec(block)?.[1];
    const name = /class="goods_name_"[^>]*title="([^"]*)"/.exec(block)?.[1];
    const group = /variation_group="(\d+)"/.exec(block)?.[1] ?? null;
    const img = /data-original="([^"]+)"/.exec(block)?.[1];
    const price = yen(/class="pop_price_">([^<]*)</.exec(block)?.[1]);
    const was = yen(/class="default_price_"><span>([^<]*)</.exec(block)?.[1]);
    if (!code || !name || !price) continue;
    if (!was || was <= price) continue; // not reduced on the card → not a deal
    const title = decode(name);
    if (/福袋|ハッピーバッグ/.test(title)) continue;
    const imageUrl = img ? new URL(decode(img), BASE).toString() : null;
    out.push({
      brand,
      country: "JP",
      externalId: code,
      name: title,
      url: `${BASE}/shop/g/g${code}/`,
      imageUrl,
      images: cleanGallery([], imageUrl),
      price,
      listPrice: was,
      currency: "JPY",
      // The sale list only shows orderable goods (sold-out cards are not listed).
      inStock: true,
      category: jaCategory(title),
      gender: "kadin",
      variants: null,
      // One card per colour; colours of one style share `variation_group`.
      groupKey: group ? `honeys:${group}` : null,
      colorName: null,
    });
  }
  return out;
}

async function fetchSjis(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "ja-JP,ja;q=0.9" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return new TextDecoder("shift_jis").decode(await res.arrayBuffer());
}

export async function listProducts(): Promise<ProductRecord[]> {
  const first = await fetchSjis(pageUrl(1));
  const total = parseTotal(first);
  if (!total) throw new Error("honeys: sale list has no total — markup changed");
  const pages = Math.ceil(total / PER_PAGE);
  if (pages > MAX_PAGES) throw new Error(`honeys: ${pages} sale pages, over the cap of ${MAX_PAGES}`);
  const byId = new Map<string, ProductRecord>();
  let cards = 0;
  for (let p = 1; p <= pages; p++) {
    const html = p === 1 ? first : (await sleep(PAUSE_MS), await fetchSjis(pageUrl(p)));
    const n = (html.match(/<div class="StyleP_Item_">/g) ?? []).length;
    if (n === 0) throw new Error(`honeys: sale page ${p}/${pages} had no cards`);
    cards += n;
    for (const r of parseCards(html)) byId.set(r.externalId, r);
  }
  // The list is the store's own count; a walk well short of it is a broken run.
  if (cards < total * 0.95) throw new Error(`honeys: walked ${cards} of ${total} sale cards`);
  if (byId.size === 0) throw new Error("honeys: no reduced rows on the sale list");
  return [...byId.values()].slice(0, CAP);
}
