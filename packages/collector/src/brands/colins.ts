import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { decodeEntities, trMoney } from "../../../../lib/live-brands/_browser";

/**
 * Colin's (colins.com.tr) runs on Inveon, server-rendered HTML with no public
 * JSON API. Each listing card carries everything in two attributes:
 * `data-ga` (GA4 item: id, colour) and `data-variants` — a JSON array of the
 * card's colours, each with id, url, images, price, oldPrice and sizes.
 * `?pagesize=200&pagenumber=N` pages it (measured 2026-10-10: 200 per page
 * honoured; plain fetch, no bot manager).
 *
 * FULL CATALOGUE (2026-10-19): one tree, `/c/tum-urunler-1` ("Tüm Ürünler",
 * where `/c/kadin-1` redirects): 5,594 colour rows on 28 pages of 200. It holds
 * every row the six sale trees did (giyim + jean "indirimdekiler" and both
 * outlets, 4,652 discounted rows) with identical price, listPrice and gender —
 * checked row by row 2026-10-19 — plus the full-price lines (`listPrice:
 * null`). 28 pages is fewer than the ~50 the sale trees took, so the walk got
 * cheaper: 130s at 3 in flight from the Mac, ~half that at 6. Gender comes
 * from each row's taxonomy/name (no row lacked one).
 *
 * SIZES — a caveat. `data-variants[].sizes` lists only sizes IN STOCK; a sold
 * out size is simply absent (checked against the product page of 50694, whose
 * S and M are `data-stock="nostock"` and missing from its card). So listing
 * sizes are all marked in_stock, and a rotating subset of product pages (each
 * ~1 MB) is read to record the sold-out ones too.
 */
const SITE = "https://www.colins.com.tr";
const CATALOGUE = "/c/tum-urunler-1";
const PAGE_SIZE = 200;
// Headroom over the 28-page / 5.6k-row catalogue: a cap must never cut it,
// or the collector's sweep would mark the cut rows sold out.
const MAX_PAGES = Number(process.env.COLINS_MAX_PAGES ?? 80);
const MAX_PRODUCTS = Number(process.env.COLINS_MAX_PRODUCTS ?? 30000);
const DETAIL_LIMIT = Number(process.env.COLINS_DETAIL_LIMIT ?? 100);

/**
 * SPEED (2026-10-12). Colin's renders a 200-card page in 4–20s server-side
 * (2 MB each) and the sweep ran 135–245s against a 300s per-brand ceiling,
 * timing out 3 runs in 17. Three things made it slow and fragile:
 *   - no request timeout: a stalled socket waits on undici's own 300s, i.e.
 *     one stuck page or product page lost the whole brand;
 *   - pages went in lock-step batches of 3, so every batch waited for its
 *     slowest page (5s pages held behind a 21s one);
 *   - the women's and men's sections ran one after the other.
 * Now the walk keeps PAGE_WIDTH pages in flight (consumed strictly in page
 * order), 6 — what the two side-by-side sale sections used to hold in all
 * (measured: median page latency 6.6s at 3 and 6.7s at 6 concurrent, so the
 * site does not slow down for it) — every request has a timeout, and the
 * sold-out-size pass stops starting product pages at a deadline instead of
 * risking the run for an enrichment.
 */
const PAGE_WIDTH = Number(process.env.COLINS_PAGE_WIDTH ?? 6);
const PAGE_TIMEOUT_MS = 45_000;
const DETAIL_CONCURRENCY = 6;
const DETAIL_TIMEOUT_MS = 20_000;
/** No product page is STARTED after this (ms since the run began). */
const DETAIL_DEADLINE_MS = Number(process.env.COLINS_DETAIL_DEADLINE_MS ?? 150_000);

const genderOf = (s: string, fallback: ProductRecord["gender"]): ProductRecord["gender"] => {
  const t = s.toLocaleLowerCase("tr");
  if (/çocuk|kız|bebek/.test(t)) return "cocuk";
  if (/kad[ıi]n/.test(t)) return "kadin";
  if (/erkek/.test(t)) return "erkek";
  return fallback;
};

/** Read one attribute's raw value off an opening tag (single- or double-quoted). */
function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}=(?:'([^']*)'|"([^"]*)")`));
  return m ? decodeEntities(m[1] ?? m[2] ?? "") : null;
}

/**
 * id → taxonomy, from the page's Insider listing object
 * (`"id": "51007", … "taxonomy": ['Tüm Ürünler','Kadın Giyim','Kadın Kazak']`).
 */
export function parseTaxonomy(html: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of html.matchAll(/"id":\s*"(\d+)",\s*"name":\s*"(?:[^"\\]|\\.)*",\s*"taxonomy":\s*\[([^\]]*)\]/g)) {
    out.set(m[1], [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1].trim()).filter(Boolean));
  }
  return out;
}

export interface ColinsCard {
  ga: any;
  variants: any[];
}

/** Every product card on a listing page. */
export function parseCards(html: string): ColinsCard[] {
  const cards: ColinsCard[] = [];
  for (const m of html.matchAll(/<div id="product_cart_\d+"[^>]*>/g)) {
    const tag = m[0];
    const raw = attr(tag, "data-variants");
    if (!raw) continue;
    try {
      const variants = JSON.parse(raw);
      let ga: any = {};
      try { ga = JSON.parse(attr(tag, "data-ga") ?? "{}"); } catch { /* optional */ }
      if (Array.isArray(variants) && variants.length) cards.push({ ga, variants });
    } catch { /* a malformed card is skipped, not fatal */ }
  }
  return cards;
}

export function mapVariant(
  v: any,
  card: ColinsCard,
  taxonomy: Map<string, string[]>,
  fallback: ProductRecord["gender"],
): ProductRecord | null {
  const id = v?.id;
  const price = trMoney(v?.price);
  if (!id || !v.url || !Number.isFinite(price) || price <= 0) return null;
  const old = trMoney(v.oldPrice);
  const tax = taxonomy.get(String(id)) ?? [];
  const shots: string[] = (v.imageUrls ?? []).filter((u: unknown) => typeof u === "string");
  const sizes: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const s of v.sizes ?? []) {
    const label = String(s?.name ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: "in_stock" });
  }
  const ids = card.variants.map((x) => Number(x?.id)).filter((n) => n > 0);
  const primary = Number(card.ga?.id) === Number(id);
  return {
    brand: "colins",
    country: "TR",
    externalId: String(id),
    name: String(v.name ?? "").trim(),
    url: `${SITE}${v.url}`,
    imageUrl: shots[0] ?? null,
    images: cleanGallery(shots),
    price: toMinor(price),
    listPrice: Number.isFinite(old) && old > price ? toMinor(old) : null,
    currency: "TRY",
    // A card lists only in-stock sizes; none listed means sold out.
    inStock: sizes.length > 0,
    category: tax.length ? tax[tax.length - 1] : (card.ga?.category ?? null),
    gender: genderOf([...tax, String(v.name ?? "")].join(" "), fallback),
    variants: sizes.length ? { colors: [], sizes } : null,
    // The card's own colour set — Inveon's grouping, not a name guess.
    groupKey: ids.length > 1 ? `colins:${Math.min(...ids)}` : null,
    colorName: primary && card.ga?.variant ? String(card.ga.variant) : null,
  };
}

/** Full size list, sold-out sizes included, from a product page. */
export function parsePdpSizes(html: string): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/data-stock="(\w+)"\s+data-name="([^"]*)"/g)) {
    const label = decodeEntities(m[2]).trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, availability: m[1] === "havestock" ? "in_stock" : "out_of_stock" });
  }
  return out;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

/** A listing page, or "" after one retry — never throws, never hangs. */
async function fetchPage(url: string): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await getText(url, { timeoutMs: PAGE_TIMEOUT_MS });
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return "";
}

/**
 * Walk one listing's pages with `width` requests in flight, handing each page
 * to `take` strictly in page order and stopping once `full()`. Order matters:
 * the section is capped, and which records make the cut must not depend on
 * which response happened to land first. Pages still in flight at the stop
 * are abandoned (`fetch` never rejects).
 */
export async function walkPages(
  pageUrl: (n: number) => string,
  fetch: (url: string) => Promise<string>,
  take: (html: string) => void,
  full: () => boolean,
  width = PAGE_WIDTH,
  maxPages = MAX_PAGES,
): Promise<number> {
  const first = await fetch(pageUrl(1));
  if (!first) return 0;
  take(first);
  let read = 1;
  const last = Number(first.match(/id="totalpagesNumber">\s*(\d+)/)?.[1] ?? 1);
  // A cap that cut pages would let the delist sweep mark their rows sold out: refuse instead.
  if (last > maxPages) throw new Error(`colins: ${last} listing pages, over the cap of ${maxPages}`);
  const inflight = new Map<number, Promise<string>>();
  let next = 2;
  for (let n = 2; n <= last && !full(); n++) {
    while (next <= last && inflight.size < width) inflight.set(next, fetch(pageUrl(next++)));
    const html = await inflight.get(n)!;
    inflight.delete(n);
    take(html);
    read++;
  }
  return read;
}

export const brand = "colins";

export async function listProducts(): Promise<ProductRecord[]> {
  const t0 = Date.now();
  const byId = new Map<string, ProductRecord>();
  const full = () => byId.size >= MAX_PRODUCTS;
  const take = (html: string) => {
    const tax = parseTaxonomy(html);
    for (const card of parseCards(html)) {
      for (const v of card.variants) {
        if (full()) return;
        const rec = mapVariant(v, card, tax, null);
        if (!rec || byId.has(rec.externalId)) continue;
        byId.set(rec.externalId, rec);
      }
    }
  };
  // A page lost after its retry would be ~250 rows the collector then marks
  // sold out (and "back in stock" next run): refuse a partial catalogue.
  let failed = 0;
  const pages = await walkPages(
    (n) => `${SITE}${CATALOGUE}?pagesize=${PAGE_SIZE}&pagenumber=${n}`,
    async (url) => (await fetchPage(url)) || (failed++, ""),
    take,
    full,
  );
  if (pages === 0 || failed > 0) throw new Error(`colins: ${failed || "first"} listing page(s) failed — partial catalogue refused`);
  if (full()) throw new Error(`colins: reached the cap of ${MAX_PRODUCTS} products — partial catalogue refused`);
  const records = [...byId.values()];
  const listedAt = Date.now();

  const pick = [...records];
  for (let j = pick.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [pick[j], pick[k]] = [pick[k], pick[j]];
  }
  let details = 0;
  await pool(pick.slice(0, DETAIL_LIMIT), DETAIL_CONCURRENCY, async (r) => {
    if (Date.now() - t0 > DETAIL_DEADLINE_MS) return;
    const html = await getText(r.url, { timeoutMs: DETAIL_TIMEOUT_MS }).catch(() => "");
    const sizes = html ? parsePdpSizes(html) : [];
    if (!sizes.length) return;
    details++;
    r.variants = { colors: [], sizes };
    r.inStock = sizes.some((s) => s.availability !== "out_of_stock");
  });
  console.log(
    `colins: ${pages} listing pages in ${((listedAt - t0) / 1000).toFixed(0)}s, ` +
      `${details}/${Math.min(DETAIL_LIMIT, records.length)} product pages in ${((Date.now() - listedAt) / 1000).toFixed(0)}s`,
  );
  return records;
}
