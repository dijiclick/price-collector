/**
 * Nordstrom (nordstrom.com, US only) — the full-price department store, sale
 * section only. Sister of `nordstromrack.ts` and reached the same way.
 *
 * nordstrom.com answers scripted clients with F5 Shape's interstitial
 * (`istlWasHere`), but the same sale category page fetched with Googlebot's
 * user-agent is served by the origin with every product card rendered: the
 * designer in `<strong>`, the name, "Current Price $x" and "Previous Price $y"
 * (the price Nordstrom itself charged before the markdown — a full-price store,
 * not an outlet "comparable value"). `?page=N` paginates (~75 cards a page).
 *
 * Cards with a price range ("Current Price $59.40 to $99" — only some sizes or
 * colours reduced) are dropped: no single sale price exists for them. Every
 * listed card is sellable, so rows are in stock; per-size stock is not on the
 * listing. Nordstrom is multi-brand: `maker` is the designer on the card.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "nordstrom";

const SITE = "https://www.nordstrom.com";
const CRAWLER_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const CAP = 1500;
const PAUSE_MS = 800;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface NordSlice {
  path: string;
  pages: number;
  gender: ProductRecord["gender"];
  category: string | null;
}

/** 41 pages; roughly half the cards carry a single price. */
export const NORD_SLICES: NordSlice[] = [
  { path: "/browse/sale/women/clothing", pages: 13, gender: "kadin", category: null },
  { path: "/browse/sale/women/shoes", pages: 5, gender: "kadin", category: "Shoes" },
  { path: "/browse/sale/women/handbags", pages: 3, gender: "kadin", category: "Handbags" },
  { path: "/browse/sale/women/jewelry", pages: 1, gender: "kadin", category: "Jewelry" },
  { path: "/browse/sale/women/accessories", pages: 1, gender: "kadin", category: "Accessories" },
  { path: "/browse/sale/beauty", pages: 2, gender: null, category: null },
  { path: "/browse/sale/men/clothing", pages: 7, gender: "erkek", category: null },
  { path: "/browse/sale/men/shoes", pages: 3, gender: "erkek", category: "Shoes" },
  { path: "/browse/sale/men/accessories", pages: 1, gender: "erkek", category: "Accessories" },
  { path: "/browse/sale/kids/girls", pages: 1, gender: "cocuk", category: null },
  { path: "/browse/sale/kids/boys", pages: 1, gender: "cocuk", category: null },
  { path: "/browse/sale/kids/shoes", pages: 1, gender: "cocuk", category: "Shoes" },
];

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", rsquo: "’", trade: "™", reg: "®" };
const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();

const money = (s: string) => Number(s.replace(/,/g, ""));

export const pageUrl = (path: string, page: number) => `${SITE}${path}${page > 1 ? `?page=${page}` : ""}`;

/** The Shape interstitial, served instead of the page when the crawler route is refused. */
export const isWall = (html: string) => html.includes("istlWasHere");

/** Map one product card (`<article>…</article>`). Pure; null unless it has one price below one previous price. */
export function mapNordCard(card: string, slice: Pick<NordSlice, "gender" | "category">): ProductRecord | null {
  const href = card.match(/href="(\/s\/[^"/?#]+\/(\d+))[^"]*"/);
  if (!href) return null;
  const [, path, id] = href;

  const cur = card.match(/Current Price \$([\d,]+(?:\.\d+)?)(\s+to\s+\$[\d,.]+)?\s*</);
  const was = card.match(/Previous Price \$([\d,]+(?:\.\d+)?)(\s+to\s+\$[\d,.]+)?\s*</);
  if (!cur || !was || cur[2] || was[2]) return null;
  const price = money(cur[1]);
  const list = money(was[1]);
  if (!(price > 0) || !(list > price)) return null;

  const h3 = card.match(/<h3[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "";
  const maker = decode(h3.match(/<strong>([\s\S]*?)<\/strong>/)?.[1] ?? "") || null;
  const title = decode(h3.replace(/<strong>[\s\S]*?<\/strong>/, ""));
  if (!title) return null;
  const img = card.match(/<img[^>]+src="(https:\/\/n\.nordstrommedia\.com\/[^"?]+)/)?.[1] ?? null;
  const imageUrl = img ? `${img}?w=800` : null;

  return {
    brand,
    country: "US",
    externalId: id,
    name: maker && !title.toLowerCase().startsWith(maker.toLowerCase()) ? `${maker} ${title}` : title,
    url: SITE + path,
    imageUrl,
    images: cleanGallery([], imageUrl),
    price: toMinor(price),
    listPrice: toMinor(list),
    currency: "USD",
    inStock: true,
    category: slice.category,
    maker,
    gender: slice.gender,
    variants: null,
    groupKey: null,
    colorName: null,
  };
}

/** Every product card on one category page. */
export function parseNordPage(html: string, slice: Pick<NordSlice, "gender" | "category">): { rows: ProductRecord[]; cards: number } {
  const rows: ProductRecord[] = [];
  let cards = 0;
  for (const m of html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)) {
    cards++;
    const r = mapNordCard(m[0], slice);
    if (r) rows.push(r);
  }
  return { rows, cards };
}

export async function listNordstrom(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const perSlice: ProductRecord[][] = [];
  let requests = 0;
  for (const slice of NORD_SLICES) {
    const rows: ProductRecord[] = [];
    for (let page = 1; page <= slice.pages; page++) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      const html = await getText(pageUrl(slice.path, page), {
        country,
        timeoutMs: 30_000,
        headers: { "User-Agent": CRAWLER_UA, Accept: "text/html,application/xhtml+xml" },
      });
      if (isWall(html)) throw new Error(`nordstrom: ${slice.path} p${page}: Shape interstitial`);
      const { rows: got, cards } = parseNordPage(html, slice);
      // The first page of every slice must render cards; later pages may run out.
      if (cards === 0 && page === 1) throw new Error(`nordstrom: ${slice.path}: no product cards (layout changed?)`);
      rows.push(...got);
      if (cards === 0) break;
    }
    perSlice.push(rows);
  }

  // Round-robin across slices so the cap trims every category a little.
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

export const listProducts = listNordstrom;
