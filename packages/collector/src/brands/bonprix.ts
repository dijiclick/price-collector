/**
 * bonprix Germany — the Damen and Herren SALE categories (2026-10-21).
 *
 * Why the listing page: bonprix has no reachable data feed. Its search runs
 * on Algolia server-side only (the browser only posts tracking events to
 * `/api/ajax/algolia/tracking/*`, no key ships), the Dynamic Yield feed
 * (section 9882989) carries stale prices (a 14.99-for-25.99 jeans read 18.99 /
 * 19.99 there), and the Android app is not on public mirrors. The category
 * page itself is CloudFront-served, unwalled, and answers a GitHub runner 200
 * (probe run 39613147946). It is a Next.js server render: one `<article>`
 * card per style (~108 a page, `?page=N`), its active colour's link, title,
 * photo and price block, plus a schema.org ItemList with each URL's
 * availability. Damen sale ≈ 1,280 (12 pages), Herren ≈ 80 (1 page) — ~13
 * requests, ~170 KB gzip each.
 *
 * The price block is `<span>now</span><span class="… line-through …">was</span>
 * <span>-NN%</span>`: bonprix's own former price (EU Omnibus). Cards without
 * a struck price, or with an "ab" (from) price, are skipped. No sizes: the
 * card carries none.
 *
 * bonprix.at moved to the same Next.js shop on 2026-10-23 (its old
 * `window.modelContainer` render is gone), so AT runs through this path too.
 */
import type { ProductRecord } from "../types";
import { getText } from "../http";
import type { CountryCode } from "../../../../lib/countries";
import { listBonprixIntl } from "./bonprix-intl";

/** Markets on the Next.js shop; the rest are in bonprix-intl.ts. */
export const BONPRIX_NEXT: Partial<Record<CountryCode, { site: string; lang: string }>> = {
  DE: { site: "https://www.bonprix.de", lang: "de-DE,de;q=0.9" },
  AT: { site: "https://www.bonprix.at", lang: "de-AT,de;q=0.9" },
};
export const BONPRIX_TREES: { path: string; gender: "kadin" | "erkek"; pages: number }[] = [
  { path: "/kategorie/damen-sale/", gender: "kadin", pages: 14 },
  { path: "/kategorie/herren-sale/", gender: "erkek", pages: 3 },
];
const CAP = 1500;
const PAUSE_MS = Number(process.env.BONPRIX_PAUSE_MS ?? 500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "1.234,99 €" → 123499 cents. */
export function euroCents(s: string): number | null {
  const m = s.replace(/&nbsp;| /g, " ").trim().match(/^([\d.]+)(?:,(\d{1,2}))?\s*€$/);
  if (!m) return null;
  return Number(m[1].replace(/\./g, "")) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

/** URL → in stock, from the page's schema.org ItemList. */
export function availabilityByUrl(html: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const re = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  for (const m of html.matchAll(re)) {
    try {
      const j = JSON.parse(m[1]);
      if (j?.["@type"] !== "ItemList") continue;
      for (const el of j.itemListElement ?? []) {
        const url = String(el?.item?.url ?? "").replace(/\/?$/, "/");
        const av = String(el?.item?.offers?.availability ?? "");
        if (url) out.set(url, !/OutOfStock|SoldOut|Discontinued/i.test(av));
      }
    } catch {
      /* not JSON — ignore */
    }
  }
  return out;
}

export interface BonprixCard {
  itemNumber: string;
  url: string;
  title: string;
  image: string | null;
  price: number;
  was: number;
}

/** Every card on a listing page with a struck price. Pure. */
export function parseCards(html: string, site = BONPRIX_NEXT.DE!.site): BonprixCard[] {
  const starts = [...html.matchAll(/data-testid="article-card-\d+"/g)].map((m) => m.index!);
  const out: BonprixCard[] = [];
  for (let i = 0; i < starts.length; i++) {
    const card = html.slice(starts[i], starts[i + 1] ?? starts[i] + 20000);
    const href = card.match(/data-product-link="true" href="(\/produkt\/[^"]*?-(\d{5,})\/)"/);
    const title = card.match(/data-alpi-title="true">([^<]+)</)?.[1];
    if (!href || !title) continue;
    // The first price block is the active colour's.
    const block = card.match(/data-testid="alpi-price">([\s\S]*?)<\/section>/)?.[1] ?? "";
    const spans = [...block.matchAll(/<span([^>]*)>([^<]*)<\/span>/g)].map((m) => ({ struck: /line-through/.test(m[1]), text: m[2] }));
    const now = spans.find((s) => !s.struck && euroCents(s.text) != null);
    const old = spans.find((s) => s.struck);
    const price = now ? euroCents(now.text) : null;
    const was = old ? euroCents(old.text) : null;
    if (price == null || was == null || !(was > price) || price <= 0) continue;
    // The CDN serves the same asset as JPEG; WebP fails on older Android image loaders.
    const img = card.match(/<img[^>]*?\ssrc="(https:\/\/image01\.bonprix\.[a-z]+\/[^"]+)"/)?.[1]?.replace(/\.webp$/, ".jpg") ?? null;
    out.push({ itemNumber: href[2], url: `${site}${href[1]}`, title: decode(title), image: img, price, was });
  }
  return out;
}

export function toRecord(c: BonprixCard, gender: ProductRecord["gender"], inStock: boolean, country: CountryCode = "DE"): ProductRecord {
  return {
    brand: "bonprix",
    country,
    externalId: c.itemNumber,
    name: c.title,
    url: c.url,
    imageUrl: c.image,
    price: c.price,
    listPrice: c.was,
    currency: "EUR",
    inStock,
    category: null,
    gender,
    variants: null,
  };
}

export async function listBonprix(country: CountryCode, fetchHtml?: (u: string) => Promise<string>): Promise<ProductRecord[]> {
  const mk = BONPRIX_NEXT[country];
  if (!mk) return listBonprixIntl(country);
  const SITE = mk.site;
  const get = fetchHtml ?? ((u: string) => getText(u, { country, timeoutMs: 60_000, headers: { "Accept-Language": mk.lang } }));
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const tree of BONPRIX_TREES) {
    let firstOfTree: string | null = null;
    for (let page = 1; page <= tree.pages; page++) {
      if (calls++) await sleep(PAUSE_MS);
      let html: string;
      try {
        html = await get(`${SITE}${tree.path}${page > 1 ? `?page=${page}` : ""}`);
      } catch (err) {
        if (byId.size === 0 && page === 1) throw err;
        break;
      }
      const cards = parseCards(html, SITE);
      // Past the last page bonprix serves page 1 again: stop when the first card repeats.
      if (page > 1 && cards[0]?.itemNumber === firstOfTree) break;
      if (page === 1) firstOfTree = cards[0]?.itemNumber ?? null;
      if (page === 1 && cards.length === 0 && tree === BONPRIX_TREES[0]) throw new Error(`bonprix/${country}: no product cards on the sale page (markup changed?)`);
      const stock = availabilityByUrl(html);
      let fresh = 0;
      for (const c of cards) {
        if (byId.has(c.itemNumber)) continue;
        byId.set(c.itemNumber, toRecord(c, tree.gender, stock.get(c.url) ?? true, country));
        fresh++;
      }
      const total = Number(html.match(/\\"totalResults\\":(\d+)/)?.[1] ?? 0);
      if (!fresh || (total && page * 108 >= total)) break;
    }
  }
  const all = [...byId.values()];
  const out = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
  console.log(`bonprix/${country}: ${calls} pages, ${all.length} reduced, kept ${out.length}`);
  return out;
}
