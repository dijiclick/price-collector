/**
 * Patagonia (patagonia.com "Web Specials", patagonia.ca) — US and Canada.
 *
 * Measured 2026-10-18: every www.patagonia.com / patagonia.ca / eu.patagonia.com
 * url (even robots.txt) answers non-human traffic with a 14 KB Akamai
 * NetStorage "Hang Tight! Routing to checkout" failover page — from GitHub
 * runners, the Hetzner box, the Mac and headless Chrome alike. The SFCC grid is
 * searched by Bloomreach Discovery, whose public core API (`core.dxpapi.com`,
 * account 7718, the ids the page itself publishes in `br_data`) is not behind
 * that wall: 200 JSON from a GitHub runner (probe run 39135660443).
 *
 * One category request (`q=web-specials`) returns up to 200 styles, ~0.6 MB;
 * the whole Web Specials tree is ~1,030 styles = 6 requests. Each style carries:
 *   - `price`: the style's regular price (the top of `price_range`; Patagonia
 *     prices a style the same in every colour and size),
 *   - `variants`: one sku per colour with that colour's current price
 *     (`sku_sale_price`), so Web Specials discounts are per colour,
 *   - `colors` / `sizes`: parallel arrays of the orderable skus — a colour with
 *     four sizes left lists four. That is the per-size stock.
 * A row is one colour; it is kept only when its price is below the style's
 * regular price. Patagonia runs no coupon/member prices in this feed.
 *
 * Product pages: `<url>?dwvar_<pid>_color=<CODE>` (the site's own tile links),
 * where CODE is the colour code in the sku image name (`84213_SZRD.jpg`).
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "patagonia";

const API = "https://core.dxpapi.com/api/v1/core/";
const ACCOUNT = "7718";
const PER_PAGE = 200;
const MAX_PAGES = 8;

export const MARKETS: Partial<Record<CountryCode, { domainKey: string; site: string; currency: string }>> = {
  US: { domainKey: "patagonia", site: "https://www.patagonia.com", currency: "USD" },
  CA: { domainKey: "patagonia_en_ca", site: "https://www.patagonia.ca", currency: "CAD" },
};

export const FIELDS = [
  "pid", "title", "price", "price_range", "url", "thumb_image", "gender", "sizes", "colors",
  "sku_price", "sku_sale_price", "sku_color", "sku_size", "sku_thumb_images",
].join(",");

export function searchUrl(country: CountryCode, start: number, rows = PER_PAGE): string {
  const m = MARKETS[country]!;
  const q = new URLSearchParams({
    account_id: ACCOUNT, domain_key: m.domainKey, request_type: "search", search_type: "category",
    q: "web-specials", rows: String(rows), start: String(start), fl: FIELDS,
    _br_uid_2: "uid=1000000000000", url: `${m.site}/shop/web-specials`, ref_url: `${m.site}/`,
  });
  return `${API}?${q}`;
}

/** Bloomreach lookup of one style by pid (any category, sale or not). */
export function pidUrl(country: CountryCode, pid: string): string {
  const m = MARKETS[country]!;
  const q = new URLSearchParams({
    account_id: ACCOUNT, domain_key: m.domainKey, request_type: "search", search_type: "keyword",
    q: "*", efq: `pid:("${pid.replace(/"/g, "")}")`, rows: "1", start: "0", fl: FIELDS,
    _br_uid_2: "uid=1000000000000", url: `${m.site}/`, ref_url: `${m.site}/`,
  });
  return `${API}?${q}`;
}

const PREFIX: Record<string, string> = {
  "m's": "Men's", "w's": "Women's", "k's": "Kids'", "kids'": "Kids'", "b's": "Boys'", "g's": "Girls'", baby: "Baby",
};

/** "m's nano puff® jacket" -> "Men's Nano Puff® Jacket". */
export function prettyTitle(t: string): string {
  return t.replace(/\s+/g, " ").trim().split(" ").map((w, i) => {
    const lw = w.toLowerCase();
    if (i === 0 && PREFIX[lw]) return PREFIX[lw];
    if (/^(a|an|and|of|the|with|for|in|on|to|by)$/.test(lw) && i > 0) return lw;
    return w.replace(/(^|[-/(])([a-z])/g, (_, p, c) => p + c.toUpperCase());
  }).join(" ");
}

export function genderOf(title: string, gender: unknown): ProductRecord["gender"] {
  const first = title.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (/^(k's|kids'?|b's|g's|baby|toddler)$/.test(first) || /\b(baby|kids'?|toddler|infant)\b/i.test(title)) return "cocuk";
  if (gender === "womens") return "kadin";
  if (gender === "mens") return "erkek";
  return null;
}

const SIZE_ORDER = ["xxs", "xs", "s", "m", "l", "xl", "xxl", "3xl", "4xl"];
const sizeRank = (s: string) => {
  const i = SIZE_ORDER.indexOf(s.toLowerCase());
  if (i >= 0) return i;
  const n = parseFloat(s);
  return Number.isFinite(n) ? 100 + n : 1000;
};

export const colourCode = (img: string | undefined): string | null =>
  img?.match(/\/hi-res\/[A-Za-z0-9-]+_([A-Za-z0-9]+)\.(?:jpg|png|webp)/)?.[1] ?? null;

const cap = (s: string) => s.replace(/(^|[\s/:-])([a-z])/g, (_, p, c) => p + c.toUpperCase());

/**
 * Map one Bloomreach style to one row per colour. Pure. `onlyDiscounted`
 * keeps colours below the regular price (the collector); the resolver passes
 * false to get every colour.
 */
export function mapPatagonia(d: any, country: CountryCode, onlyDiscounted = true): ProductRecord[] {
  const m = MARKETS[country];
  const pid = String(d?.pid ?? "");
  const title = String(d?.title ?? "");
  const regular = Math.max(Number(d?.price) || 0, ...((d?.price_range ?? []) as unknown[]).map(Number).filter(Number.isFinite));
  if (!m || !pid || !title || !(regular > 0) || typeof d?.url !== "string") return [];
  const colors: string[] = Array.isArray(d.colors) ? d.colors : [];
  const sizes: string[] = Array.isArray(d.sizes) ? d.sizes : [];
  const sizesByColour = new Map<string, string[]>();
  colors.forEach((c, i) => {
    const s = sizes[i];
    if (!s) return;
    const arr = sizesByColour.get(c) ?? [];
    if (!arr.includes(s)) arr.push(s);
    sizesByColour.set(c, arr);
  });
  // One sku per colour; a colour can repeat — keep its highest price, so a row
  // never shows a size that costs more than its quoted price.
  const byColour = new Map<string, any>();
  for (const v of d.variants ?? []) {
    const c = String(v?.sku_color ?? "");
    const p = Number(v?.sku_sale_price ?? v?.sku_price);
    if (!c || !(p > 0)) continue;
    const prev = byColour.get(c);
    if (!prev || p > Number(prev.sku_sale_price ?? prev.sku_price)) byColour.set(c, v);
  }
  const name = prettyTitle(title);
  const gender = genderOf(title, d.gender);
  const base = d.url.replace(/^https?:\/\/[^/]+/, m.site).split("?")[0];
  const out: ProductRecord[] = [];
  for (const [colour, v] of byColour) {
    const price = Number(v.sku_sale_price ?? v.sku_price);
    const discounted = price < regular - 0.005;
    if (onlyDiscounted && !discounted) continue;
    const img: string | undefined = v.sku_thumb_images?.[0] ?? (byColour.size === 1 ? d.thumb_image : undefined);
    const code = colourCode(img);
    if (!code) continue;
    const left = (sizesByColour.get(colour) ?? []).sort((a, b) => sizeRank(a) - sizeRank(b));
    const sizeRows: SizeVariant[] = left.map((s) => ({ label: s === "all" ? "One Size" : s.toUpperCase(), availability: "in_stock" }));
    const colourName = cap(colour);
    out.push({
      brand,
      country,
      externalId: `${pid}-${code}`,
      name,
      url: `${base}?dwvar_${pid}_color=${code}`,
      imageUrl: img ?? null,
      images: cleanGallery(img ? [img] : [], img ?? null),
      price: toMinor(price),
      listPrice: discounted ? toMinor(regular) : null,
      currency: m.currency,
      inStock: left.length > 0,
      category: null,
      gender,
      variants: { colors: [colourName], sizes: sizeRows },
      groupKey: `patagonia:${pid}`,
      colorName: colourName,
    });
  }
  return out;
}

export async function listPatagonia(country: CountryCode): Promise<ProductRecord[]> {
  if (!MARKETS[country]) return [];
  const byId = new Map<string, ProductRecord>();
  let ok = 0;
  let lastErr: unknown = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await getJson<any>(searchUrl(country, page * PER_PAGE), { country, retries: 2 }).catch((e) => {
      lastErr = e;
      return null;
    });
    if (!data?.response) break;
    ok++;
    const docs: any[] = data.response.docs ?? [];
    for (const d of docs) for (const r of mapPatagonia(d, country)) if (!byId.has(r.externalId)) byId.set(r.externalId, r);
    const total = Number(data.response.numFound) || 0;
    if (docs.length < PER_PAGE || (page + 1) * PER_PAGE >= total) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!ok) throw new Error(`patagonia/${country}: Bloomreach search failed — ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  const all = [...byId.values()];
  if (!all.length) throw new Error(`patagonia/${country}: 0 discounted colours in Web Specials`);
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, 1500);
}

export const listProducts = listPatagonia;
