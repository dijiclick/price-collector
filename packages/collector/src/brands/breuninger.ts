/**
 * Breuninger Germany — the Damen and Herren SALE trees (2026-10-21).
 *
 * Breuninger has no public listing feed: the app (`com.excelsisnet.android.
 * breuninger`, Flutter) opens the website's product lists in a web view, and
 * the site's own list script only swaps in server-rendered HTML fragments. The
 * list page is myracloud-fronted and unwalled — a GitHub runner gets it 200
 * (probe run 39613147946). Each tile is the product's main link
 * (`data-product-link`, `data-syan` = style, `data-color-id` = colour) holding
 * brand, name, photo and the price block, followed by one
 * `data-navi-product-article` per colour carrying `data-sizes` (the sizes the
 * shop can sell now). ~100 tiles a page, `?page=N` (the page's own
 * `data-next-page-url`); Damen sale is ~35k styles, so the newest-relevance
 * first pages are read and capped (~3 MB raw / ~280 KB gzip a page).
 *
 * The struck price is labelled by Breuninger itself: "Bestpreis" (the EU
 * Omnibus lowest price of the last 30 days) or "Ursprünglich" (the original
 * price). Rows struck against anything else (e.g. "UVP") are skipped.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import type { CountryCode } from "../../../../lib/countries";

const SITE = "https://www.breuninger.com";
export const BREUNINGER_TREES: { path: string; gender: "kadin" | "erkek"; pages: number }[] = [
  { path: "/de/damen/sale/", gender: "kadin", pages: 10 },
  { path: "/de/herren/sale/", gender: "erkek", pages: 6 },
];
/**
 * Austria and Switzerland (2026-10-21): the same shop under /at/ (EUR,
 * "Bestpreis" Omnibus labels like Germany) and /ch/ (CHF, "CHF 1'195.50"; no
 * Omnibus in Switzerland, so the struck price is labelled "Ursprünglich" in a
 * `data-test-navi-product-old-price` block instead).
 */
export const BREUNINGER_MARKETS: Partial<Record<CountryCode, { prefix: string; currency: string; lang: string }>> = {
  AT: { prefix: "/at", currency: "EUR", lang: "de-AT,de;q=0.9" },
  CH: { prefix: "/ch", currency: "CHF", lang: "de-CH,de;q=0.9" },
};
const CAP = 1500;
const PAUSE_MS = Number(process.env.BREUNINGER_PAUSE_MS ?? 600);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const REAL_REFERENCE = /^(Bestpreis|Ursprünglich)/;

const decode = (s: string) =>
  s
    .replace(/&nbsp;| /g, " ")
    .replace(/&#x3D;/g, "=")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

/** "1.195,99 €" / "230 €" → cents; null for anything else ("ab 20 €"). */
export function euroCents(s: string): number | null {
  const m = decode(s).match(/^([\d.]+)(?:,(\d{1,2}))?\s*€$/);
  if (!m) return null;
  return Number(m[1].replace(/\./g, "")) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

/** "CHF 100" / "CHF 1'195.50" → cents; null for anything else. */
export function chfCents(s: string): number | null {
  const m = decode(s).match(/^CHF\s*([\d']+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1].replace(/'/g, "")) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

export interface BreuningerTile {
  syan: string;
  colorId: string;
  url: string;
  brand: string;
  name: string;
  image: string | null;
  price: number;
  was: number;
  sizes: string[] | null;
}

/** Every reduced tile on a list page. Pure. */
export function parseTiles(html: string, currency: string = "EUR"): BreuningerTile[] {
  const money = currency === "CHF" ? chfCents : euroCents;
  const starts = [...html.matchAll(/<a href="[^"]*" data-product-link /g)].map((m) => m.index!);
  const out: BreuningerTile[] = [];
  for (let i = 0; i < starts.length; i++) {
    const seg = html.slice(starts[i], starts[i + 1] ?? starts[i] + 30000);
    const head = seg.match(/^<a href="([^"]*)" data-product-link data-color-id="([^"]+)" data-syan="(\d+)"/);
    if (!head) continue;
    const [, href, colorId, syan] = head;
    const brand = seg.match(/data-test-navi-product-brand>([^<]*)</)?.[1];
    const name = seg.match(/data-test-navi-product-name-text>([^<]*)</)?.[1];
    // The first price block belongs to the main link (the active colour).
    const now = seg.match(/data-test-navi-product-current-price[^>]*>\s*<ins>([^<]*)<\/ins>/)?.[1];
    const ref = currency === "CHF"
      ? seg.match(/data-test-navi-product-(?:reference|old)-price\s*>([^<]*)<wbr><del>([^<]*)<\/del>/)
      : seg.match(/data-test-navi-product-reference-price\s*>([^<]*)<wbr><del>([^<]*)<\/del>/);
    if (!brand || !name || !now || !ref || !REAL_REFERENCE.test(decode(ref[1]))) continue;
    const price = money(now);
    const was = money(ref[2]);
    if (price == null || was == null || !(was > price) || price <= 0) continue;
    const img = seg.match(/<img src="(https:\/\/cms\.brnstc\.de\/[^"]+)"[^>]*data-test-navi-product-image/)?.[1] ?? null;
    // This colour's article carries the sellable sizes.
    const art = seg.match(new RegExp(`data-navi-product-article href="[^"]*" data-syan="${syan}" data-color-id="${colorId}"[^>]*?data-sizes="([^"]*)"`));
    let sizes: string[] | null = null;
    if (art) {
      try {
        const list = JSON.parse(decode(art[1]));
        if (Array.isArray(list)) sizes = list.map((x) => String(x).trim()).filter(Boolean);
      } catch {
        sizes = null;
      }
    }
    out.push({ syan, colorId, url: `${SITE}${decode(href)}`, brand: decode(brand), name: decode(name), image: img, price, was, sizes });
  }
  return out;
}

export function toRecord(t: BreuningerTile, gender: ProductRecord["gender"], country: CountryCode = "DE"): ProductRecord {
  const name = t.name.toLowerCase().startsWith(t.brand.toLowerCase()) ? t.name : `${t.brand} ${t.name}`;
  return {
    brand: "breuninger",
    country,
    externalId: `${t.syan}-${t.colorId}`,
    name,
    url: t.url,
    imageUrl: t.image,
    images: cleanGallery([t.image], t.image),
    price: t.price,
    listPrice: t.was,
    currency: BREUNINGER_MARKETS[country]?.currency ?? "EUR",
    // A tile without sellable sizes listed is still on the shelf (one-size goods).
    inStock: t.sizes == null || t.sizes.length > 0,
    maker: t.brand,
    category: null,
    gender,
    variants: t.sizes?.length ? { colors: [], sizes: t.sizes.map((label) => ({ label, availability: "in_stock" as const })) } : null,
    // `data-sizes` lists only what can be bought now: missing sizes are sold out.
    sizesInStockOnly: t.sizes?.length ? true : undefined,
    groupKey: `breuninger:${t.syan}`,
  };
}

export async function listBreuninger(country: CountryCode, fetchHtml: (u: string) => Promise<string> = (u) => getText(u, { country, timeoutMs: 60_000, headers: { "Accept-Language": BREUNINGER_MARKETS[country]?.lang ?? "de-DE,de;q=0.9" } })): Promise<ProductRecord[]> {
  const mk = BREUNINGER_MARKETS[country];
  if (country !== "DE" && !mk) return [];
  const trees = mk ? BREUNINGER_TREES.map((t) => ({ ...t, path: t.path.replace(/^\/de\//, `${mk.prefix}/`) })) : BREUNINGER_TREES;
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const tree of trees) {
    for (let page = 1; page <= tree.pages; page++) {
      if (calls++) await sleep(PAUSE_MS);
      let html: string;
      try {
        html = await fetchHtml(`${SITE}${tree.path}${page > 1 ? `?page=${page}` : ""}`);
      } catch (err) {
        if (byId.size === 0 && page === 1) throw err;
        break;
      }
      const tiles = parseTiles(html, mk?.currency);
      if (page === 1 && tiles.length === 0 && tree === trees[0]) throw new Error("breuninger: no reduced tiles on the sale page (markup changed?)");
      let fresh = 0;
      for (const t of tiles) {
        const r = toRecord(t, tree.gender, country);
        if (byId.has(r.externalId)) continue;
        byId.set(r.externalId, r);
        fresh++;
      }
      if (!fresh || !/data-next-page-url="[^"]+"/.test(html)) break;
    }
  }
  const all = [...byId.values()];
  const out = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
  console.log(`breuninger/${country}: ${calls} pages, ${all.length} reduced, kept ${out.length}`);
  return out;
}
