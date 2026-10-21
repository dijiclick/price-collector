/**
 * earth music&ecology (Japan) from STRIPE CLUB, Stripe International's own shop,
 * `stripe-club.com/brand/earth1999/search?sst1=3` = the brand's SALE list
 * (2026-10-21).
 *
 * Server-rendered HTML (UTF-8), no JSON feed. Each card carries machine data
 * attributes for the SKU it shows — `data-salesPrice` / `data-retailPrice`
 * (tax included), `data-categoryName`, `data-basicItemCode` — and prints the
 * retail price struck through above the sale price, so the "was" is the shop's
 * own. 120 cards a page, ~730 rows. Reachable from a GitHub runner, no proxy
 * (probe 39634410176: 200).
 *
 * The brand is women's wear → `kadin`. `data-categoryName` is Japanese
 * ("スウェット・パーカー"), so the type goes through `jaCategory` (name as the
 * fallback).
 */
import type { ProductRecord } from "../types";
import { cleanGallery } from "../types";
import { getText } from "../http";
import { jaCategory } from "./_ja-category";

export const brand = "earthmusic";
const BASE = "https://stripe-club.com";
const PER_PAGE = 120;
const MAX_PAGES = 13; // 1,560 rows
const CAP = 1500;
const PAUSE_MS = 800;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const pageUrl = (page: number): string =>
  `${BASE}/brand/earth1999/search?st=1&sst1=3&so=PROF&limit=${PER_PAGE}${page > 1 ? `&page=${page}` : ""}`;

/** The result count the page prints ("731 件"). Pure. */
export function parseTotal(html: string): number | null {
  const i = html.indexOf("結果件数");
  if (i < 0) return null;
  const m = /([\d,]+)\s*(?:<[^>]*>\s*)*件/.exec(html.slice(i, i + 400).replace(/^[^>]*>/, ""));
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

const attr = (block: string, name: string): string | null => {
  const m = new RegExp(`${name}="([^"]*)"`).exec(block);
  return m ? m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : null;
};

/** Every reduced card on one page. Pure. */
export function parseCards(html: string): ProductRecord[] {
  const out: ProductRecord[] = [];
  for (const block of html.split('<li class="w-full">').slice(1)) {
    const code = attr(block, "data-basicItemCode");
    const name = attr(block, "data-itemName");
    const sale = Number(attr(block, "data-salesPrice"));
    const retail = Number(attr(block, "data-retailPrice"));
    const href = /href="(https:\/\/stripe-club\.com\/brand\/earth1999\/item\/[^"]+)"/.exec(block)?.[1]?.replace(/&amp;/g, "&");
    if (!code || !name || !href || !(sale > 0)) continue;
    if (!(retail > sale)) continue;
    // A card shown at a campaign/member price is not a public markdown.
    if (attr(block, "data-campaignPrice")) continue;
    const clr = /[?&]clr_id=([^&]+)/.exec(href)?.[1] ?? null;
    const img = /data-src="(https:\/\/img\.stripe-club\.com\/[^"]+)"/.exec(block)?.[1] ?? null;
    const url = `${BASE}/brand/earth1999/item/${code}${clr ? `?clr_id=${clr}` : ""}`;
    out.push({
      brand,
      country: "JP",
      externalId: clr ? `${code}-${clr}` : code,
      name,
      url,
      imageUrl: img,
      images: cleanGallery([], img),
      price: sale * 100,
      listPrice: retail * 100,
      currency: "JPY",
      inStock: !/SOLD\s*OUT|在庫なし|売り切れ/.test(block),
      category: jaCategory(attr(block, "data-categoryName")) ?? jaCategory(name),
      gender: "kadin",
      variants: null,
      groupKey: `earthmusic:${code}`,
      colorName: null,
    });
  }
  return out;
}

export async function listProducts(): Promise<ProductRecord[]> {
  const first = await getText(pageUrl(1), { headers: { "Accept-Language": "ja-JP,ja;q=0.9" }, timeoutMs: 30_000 });
  const total = parseTotal(first);
  if (total == null) throw new Error("earthmusic: no result count — markup changed");
  const pages = Math.ceil(total / PER_PAGE);
  if (pages > MAX_PAGES) throw new Error(`earthmusic: ${pages} sale pages, over the cap of ${MAX_PAGES}`);
  const byId = new Map<string, ProductRecord>();
  let cards = 0;
  for (let p = 1; p <= pages; p++) {
    if (p > 1) await sleep(PAUSE_MS);
    const html = p === 1 ? first : await getText(pageUrl(p), { headers: { "Accept-Language": "ja-JP,ja;q=0.9" }, timeoutMs: 30_000 });
    const n = html.split('<li class="w-full">').length - 1;
    if (n === 0) throw new Error(`earthmusic: page ${p}/${pages} had no cards`);
    cards += n;
    for (const r of parseCards(html)) byId.set(r.externalId, r);
  }
  if (cards < total * 0.95) throw new Error(`earthmusic: walked ${cards} of ${total} cards`);
  if (total > 0 && byId.size === 0) throw new Error("earthmusic: no reduced rows on the sale list");
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
