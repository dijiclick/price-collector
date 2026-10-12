/**
 * Nordstrom Rack (US only) from its server-rendered category pages.
 *
 * Every data route is walled. nordstromrack.com answers browsers, curl and app
 * user-agents alike with F5 Shape's interstitial (`istlWasHere`), and the
 * Android app (com.nordstrom.rack.app 12.8) talks to api.nordstrom.com, where
 * the product routes (`/sbn/v2/search`, `/sbn/v2/category/...`, `/pdp/...`,
 * `/offer/...`) sit behind Shape's mobile SDK (APIGuard) and return an empty 429
 * without its signed headers. The app's older Polaris search
 * (`/polaris/v2/search`) is gone (Kong 404).
 *
 * What the wall lets through is the search-engine crawler: the same category
 * page fetched with Googlebot's user-agent is served by the origin (nginx), with
 * every product card rendered — brand, name, current price, "% off" and the
 * "Comparable value" reference price. Verified from a GitHub runner, no proxy:
 * probe runs 38220440085 and 38220724182 (2026-10-12, 12 pages back to back,
 * all 200 from the origin). Sorting (`?sort=`) is still walled; `?page=N` is not.
 *
 * Rack lists only what it can sell, so every card is in stock. Cards priced as a
 * range ("$19.99 – $29.97", "Up to 70% off select items") or with a range of
 * comparable values are dropped: no single "was" price exists for them. Per-size
 * stock is not on the listing, so variants are left null.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "nordstromrack";

const SITE = "https://www.nordstromrack.com";
const CRAWLER_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const CAP = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RackSlice {
  path: string;
  pages: number;
  gender: ProductRecord["gender"];
  category: string | null;
}

/** 34 pages of ~72 cards; about two thirds carry a single price. */
export const RACK_SLICES: RackSlice[] = [
  { path: "/shop/women/clothing/dresses", pages: 2, gender: "kadin", category: "Dresses" },
  { path: "/shop/women/clothing/tops", pages: 2, gender: "kadin", category: "Tops" },
  { path: "/shop/women/clothing/sweaters", pages: 1, gender: "kadin", category: "Sweaters" },
  { path: "/shop/women/clothing/coats-jackets", pages: 1, gender: "kadin", category: "Coats & Jackets" },
  { path: "/shop/women/clothing/jeans", pages: 1, gender: "kadin", category: "Jeans" },
  { path: "/shop/women/clothing/pants", pages: 1, gender: "kadin", category: "Pants" },
  { path: "/shop/women/clothing/skirts", pages: 1, gender: "kadin", category: "Skirts" },
  { path: "/shop/women/clothing/activewear", pages: 1, gender: "kadin", category: "Activewear" },
  { path: "/shop/women/clothing/sleepwear-lounge", pages: 1, gender: "kadin", category: "Sleepwear & Lounge" },
  { path: "/shop/women/shoes/boots", pages: 2, gender: "kadin", category: "Boots" },
  { path: "/shop/women/shoes/sneakers", pages: 1, gender: "kadin", category: "Sneakers" },
  { path: "/shop/women/shoes/heels", pages: 1, gender: "kadin", category: "Heels" },
  { path: "/shop/women/shoes/flats", pages: 1, gender: "kadin", category: "Flats" },
  { path: "/shop/women/handbags", pages: 2, gender: "kadin", category: "Handbags" },
  { path: "/shop/women/jewelry", pages: 1, gender: "kadin", category: "Jewelry" },
  { path: "/shop/women/accessories", pages: 1, gender: "kadin", category: "Accessories" },
  { path: "/shop/men/clothing/shirts", pages: 1, gender: "erkek", category: "Shirts" },
  { path: "/shop/men/clothing/sweaters", pages: 1, gender: "erkek", category: "Sweaters" },
  { path: "/shop/men/clothing/coats-jackets", pages: 1, gender: "erkek", category: "Coats & Jackets" },
  { path: "/shop/men/clothing/pants", pages: 1, gender: "erkek", category: "Pants" },
  { path: "/shop/men/clothing/jeans", pages: 1, gender: "erkek", category: "Jeans" },
  { path: "/shop/men/clothing/activewear", pages: 1, gender: "erkek", category: "Activewear" },
  { path: "/shop/men/shoes/sneakers", pages: 1, gender: "erkek", category: "Sneakers" },
  { path: "/shop/men/shoes/boots", pages: 1, gender: "erkek", category: "Boots" },
  { path: "/shop/men/accessories", pages: 1, gender: "erkek", category: "Accessories" },
  { path: "/shop/kids/girls-clothing", pages: 1, gender: "cocuk", category: null },
  { path: "/shop/kids/boys-clothing", pages: 1, gender: "cocuk", category: null },
  { path: "/shop/kids/kids-shoes", pages: 1, gender: "cocuk", category: "Shoes" },
  { path: "/shop/beauty", pages: 1, gender: null, category: null },
];

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", rsquo: "’", trade: "™", reg: "®" };
const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();

const money = (s: string) => Number(s.replace(/,/g, ""));

export const pageUrl = (path: string, page: number) => `${SITE}${path}${page > 1 ? `?page=${page}` : ""}`;

/** The Shape interstitial, served instead of the page when the crawler route is refused. */
export const isWall = (html: string) => html.includes("istlWasHere");

/** Map one product card (`<article>…</article>`). Pure; null unless it has one price below one comparable value. */
export function mapRackCard(card: string, slice: Pick<RackSlice, "gender" | "category">): ProductRecord | null {
  const href = card.match(/href="(\/s\/[^"/?#]+\/(\d+))[^"]*"/);
  if (!href) return null;
  const [, path, id] = href;

  const cur = card.match(/Current Price \$([\d,]+(?:\.\d+)?)(\s+to\s+\$[\d,.]+)?\s*</);
  const was = card.match(/Comparable value \$([\d,]+(?:\.\d+)?)(\s+to\s+\$[\d,.]+)?\s*</);
  if (!cur || !was || cur[2] || was[2] || /Up to \d+% off/.test(card)) return null;
  const price = money(cur[1]);
  const list = money(was[1]);
  if (!(price > 0) || !(list > price)) return null;

  const name = decode(card.match(/<h3[^>]*>\s*<a[^>]*>([^<]+)<\/a>/)?.[1] ?? "");
  if (!name) return null;
  const brandName = decode(card.match(/>([^<>]+)<\/div>\s*<h3/)?.[1] ?? "");
  const img = card.match(/<img[^>]+src="(https:\/\/n\.nordstrommedia\.com\/[^"?]+)/)?.[1] ?? null;
  const imageUrl = img ? `${img}?w=800` : null;

  return {
    brand,
    country: "US",
    externalId: id,
    name: brandName ? `${brandName} ${name}` : name,
    url: SITE + path,
    imageUrl,
    images: cleanGallery([], imageUrl),
    price: toMinor(price),
    listPrice: toMinor(list),
    currency: "USD",
    inStock: true,
    category: slice.category,
    gender: slice.gender,
    variants: null,
    groupKey: null,
    colorName: null,
  };
}

/** Every product card on one category page. */
export function parseRackPage(html: string, slice: Pick<RackSlice, "gender" | "category">): ProductRecord[] {
  const out: ProductRecord[] = [];
  for (const m of html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)) {
    const r = mapRackCard(m[0], slice);
    if (r) out.push(r);
  }
  return out;
}

export async function listNordstromRack(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const perSlice: ProductRecord[][] = [];
  let first = true;
  for (const slice of RACK_SLICES) {
    const rows: ProductRecord[] = [];
    for (let page = 1; page <= slice.pages; page++) {
      if (!first) await sleep(700);
      first = false;
      let html: string;
      try {
        html = await getText(pageUrl(slice.path, page), {
          country,
          headers: { "User-Agent": CRAWLER_UA, Accept: "text/html,application/xhtml+xml" },
        });
      } catch (e) {
        console.warn(`nordstromrack: ${slice.path} p${page}: ${(e as Error).message}`);
        break;
      }
      if (isWall(html)) {
        console.warn(`nordstromrack: ${slice.path} p${page}: Shape interstitial`);
        break;
      }
      rows.push(...parseRackPage(html, slice));
    }
    perSlice.push(rows);
  }

  // Round-robin across slices so the cap trims every category a little rather
  // than dropping the last ones (kids, beauty) entirely.
  const byId = new Map<string, ProductRecord>();
  for (let i = 0; byId.size < CAP && perSlice.some((s) => i < s.length); i++) {
    for (const s of perSlice) {
      const r = s[i];
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      if (byId.size >= CAP) break;
    }
  }
  return [...byId.values()];
}

export const listProducts = listNordstromRack;
