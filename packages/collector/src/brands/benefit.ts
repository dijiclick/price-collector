/**
 * Benefit Cosmetics United States (benefitcosmetics.com/en-us) — US only.
 *
 * Salesforce SFRA storefront (`Sites-benco-us-Site`) behind Cloudflare. The
 * site refuses Turkish and German addresses (403 on the Mac and the Hetzner
 * box) but answers a plain browser GET from a GitHub runner: the Sale page came
 * back 200 with the full grid (probe run 39134299441, 2026-10-18, 451 KB).
 *
 * One request: the Sale category page (`/en-us/sale`, `sz` raised so the whole
 * grid is on one page — 18 products on 2026-10-18). Each tile is one variant
 * (`div.product[data-pid]`) and carries:
 *   - `data-gtmga4data` (HTML-escaped JSON): item_id, item_name, item_category
 *     (Face/Eyes/Lips/Brows/…), item_category2 (Mascara, Concealer…),
 *     image_url and in_stock ("IN_STOCK" / "NOT_AVAILABLE");
 *   - the shelf price pair: `del .strike-through.list .value[content]` (the
 *     regular price) and `.sales .value[content]` (the sale price), USD.
 * Kept only when sale < list. Tiles with no strike price (gift sets "valued
 * at", full-price items) are dropped.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "benefit";

const SITE = "https://www.benefitcosmetics.com";
export const SALE_URL = `${SITE}/en-us/sale?start=0&sz=120`;
const CAP = 1500;

const ENT: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
export const unescapeHtml = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);

/** The tile blocks of a grid page, one per variant shown. Pure. */
export function tilesOf(html: string): string[] {
  return html.split(/(?=<div class="product" data-pid=")/).slice(1);
}

/** Map one product tile. Pure; null unless the shelf shows a strike price above the sale price. */
export function mapBenefitTile(tile: string): ProductRecord | null {
  const ga = /data-gtmga4data="([^"]+)"/.exec(tile)?.[1];
  let d: any = null;
  try { d = ga ? JSON.parse(unescapeHtml(ga)) : null; } catch { d = null; }
  const pid = /data-pid="([^"]+)"/.exec(tile)?.[1] ?? d?.item_id;
  const href = /class="link" href="([^"]+)"/.exec(tile)?.[1] ?? /href="(\/en-us\/product\/[^"]+)"/.exec(tile)?.[1];
  const title = unescapeHtml(String(/class="link" href="[^"]+">([^<]+)</.exec(tile)?.[1] ?? d?.item_name ?? "")).replace(/\s+/g, " ").trim();
  if (!pid || !href || !href.startsWith("/en-us/product/") || !title) return null;
  if (d?.currency && d.currency !== "USD") return null;

  const list = Number(/strike-through list">\s*<span class="value" content="([\d.]+)"/.exec(tile)?.[1]);
  const sale = Number(/<span class="sales">[\s\S]*?<span class="value" content="([\d.]+)"/.exec(tile)?.[1]);
  if (!(sale > 0) || !Number.isFinite(list) || !(list > sale)) return null;

  const tileImgs = [...tile.matchAll(/data-src="(https:\/\/www\.benefitcosmetics\.com\/dw\/image\/[^"]+)"/g)].map((m) => unescapeHtml(m[1]));
  const main = typeof d?.image_url === "string" && d.image_url.startsWith("https://") ? d.image_url : null;
  const first = tileImgs[0] ?? main;
  const category = [d?.item_category2, d?.item_category].find((c) => typeof c === "string" && c.trim()) ?? null;
  const shade = typeof d?.item_variant === "string" && d.item_variant.trim() && !/^(mini|full size|standard|kit|set|duo|trio|value set)$/i.test(d.item_variant.trim()) ? d.item_variant.trim() : null;

  return {
    brand,
    country: "US",
    externalId: String(pid),
    name: title,
    url: SITE + href,
    imageUrl: first,
    images: cleanGallery([...tileImgs, main], first),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency: "USD",
    inStock: d?.in_stock ? d.in_stock === "IN_STOCK" : !/NOT_AVAILABLE|out of stock/i.test(tile),
    category: category ? String(category).trim() : null,
    gender: null,
    variants: shade ? { colors: [shade], sizes: [] } : null,
    groupKey: typeof d?.product_id === "string" && d.product_id ? `benefit:${d.product_id}` : null,
    colorName: shade,
  };
}

export function parseBenefitGrid(html: string): ProductRecord[] {
  const byId = new Map<string, ProductRecord>();
  for (const t of tilesOf(html)) {
    const r = mapBenefitTile(t);
    if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
  }
  return [...byId.values()];
}

export async function listBenefit(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const html = await getText(SALE_URL, {
    country,
    timeoutMs: 45_000,
    headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" },
  });
  const tiles = tilesOf(html).length;
  if (!tiles) throw new Error(`benefit: the sale page had no product tiles (${html.length} bytes: ${html.slice(0, 80).replace(/\s+/g, " ")})`);
  const all = parseBenefitGrid(html);
  if (!all.length) throw new Error(`benefit: ${tiles} sale tiles but none with a strike price — the markup changed or the sale ended`);
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listBenefit;
