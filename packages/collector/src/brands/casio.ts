import type { ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";

/**
 * Casio Turkey — the official shop of Casio's Turkish distributor, Ersa Saat
 * (`shopcasio.ersasaat.com.tr`, the "CASIO Yetkili Online Mağaza" that
 * casio.com/tr links to). Built 2026-10-18.
 *
 * casio.com/tr itself sells nothing and answers Akamai "Access Denied" to the
 * Mac, the Hetzner box and GitHub's runners alike. The Ersa shop (Ersa's own
 * ASP.NET platform behind Cloudflare) answers a GitHub runner with 200 — HTML
 * listings, product pages and the image CDN (probe run 39127496213).
 *
 * There is no JSON listing route; the server-rendered listing IS the feed: 40
 * cards a page, `?p=N`. Until 2026-10-19 the walk sorted by discount
 * (`list=4`, "Süper İndirimler") and stopped at the first page with nothing at
 * or above the floor.
 *
 * THE 5% FLOOR: on 2026-10-18 1,702 of the 2,123 reduced watches sat at exactly
 * −5% — a store-wide web price, not a markdown. Only discounts of at least
 * `CASIO_MIN_PCT` (default 10) count as discounts (~420 watches); below it the
 * watch is a full-price row at the card's price, `listPrice` null. The card's
 * "SEPETTE N ₺" basket price is never quoted (Boyner's rule).
 *
 * FULL CATALOGUE (2026-10-19): every tree is walked to its end — 2,212
 * watches, every card InStock in the listing's JSON-LD (the listing shows
 * in-stock watches only); women's 20 pages, men's 41, kids' 2, all 56: ~119
 * pages of ~0.5 MB HTML at ~2 s each, so pages go two at a time (~2 min).
 * `list=1` (date added) keeps the order stable while paging; the discount
 * order ties on ~1,700 watches at −5%. A page that fails after its retries
 * fails the run: a partial walk would let the delist sweep mark the rest sold
 * out.
 *
 * Cards carry no section; the walk reads the women's, men's and kids' trees
 * (in that order) and then the whole watch tree for the rest. A watch listed
 * under both women's and men's is unisex (gender null). Watches have no sizes.
 * Photos are on Ersa's CDN by model code (`cdn.demircloud.com/products/1000/<CODE>.jpg`,
 * the same url the product page's JSON-LD names).
 */
export const SITE = "https://shopcasio.ersasaat.com.tr";
export const IMAGE_BASE = "https://cdn.demircloud.com/products/1000/";

export const brand = "casio";

export interface CasioListing {
  path: string;
  gender: ProductRecord["gender"];
}

/** Women's first (the audience), then men's, kids', and the whole tree for the rest. */
export const LISTINGS: CasioListing[] = [
  { path: "/casio-kadin-saat", gender: "kadin" },
  { path: "/casio-erkek-saat", gender: "erkek" },
  { path: "/casio-cocuk-saatleri", gender: "cocuk" },
  { path: "/casio-saat", gender: null },
];

const MIN_PCT = Number(process.env.CASIO_MIN_PCT ?? 10);
/** ~119 pages over the four trees today; room to grow by half. */
const MAX_PAGES = Number(process.env.CASIO_MAX_PAGES ?? 180);
const MAX_PRODUCTS = Number(process.env.CASIO_MAX_PRODUCTS ?? 5000);
const PAUSE_MS = Number(process.env.CASIO_PAUSE_MS ?? 300);
/** Pages in flight at once. */
const CONCURRENCY = 2;
const PAGE_CARDS = 40;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `list=1`: date added, a stable order to page through (see header). */
export const pageUrl = (path: string, n: number) => `${SITE}${path}?list=1${n > 1 ? `&p=${n}` : ""}`;

/** "12.369,00 ₺" → 12369; null when it is not a Turkish-format amount. */
export function trAmount(s: string | null | undefined): number | null {
  const m = String(s ?? "").match(/(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?\s*(?:₺|TL)/);
  if (!m) return null;
  const n = Number(`${m[1].replace(/\./g, "")}.${m[2] ?? "0"}`);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

const CARD_START = /<div class="column col-lg-3 col-xs-6 product-link" data-id="([^"]+)"/g;

/** Product cards of a listing page, in page order, as `{code, html}` chunks. */
export function casioCards(page: string): { code: string; html: string }[] {
  const starts = [...page.matchAll(CARD_START)].map((m) => ({ at: m.index!, code: m[1] }));
  return starts.map((s, i) => ({
    code: s.code,
    html: page.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : Math.min(page.length, s.at + 8000)),
  }));
}

/** Product url → schema.org availability ("InStock", "OutOfStock") from the listing's JSON-LD. */
export function casioAvailability(page: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of page.matchAll(/"availability":\s*"(?:https?:\/\/schema\.org\/)?(\w+)",\s*"url":\s*"([^"]+)"/g)) {
    out.set(m[2].replace(/^https?:\/\/[^/]+/, ""), m[1]);
  }
  return out;
}

/** Map one listing card. Pure; null for a card without a usable price. */
export function mapCasioCard(
  code: string,
  card: string,
  gender: ProductRecord["gender"] = null,
  availability?: string,
): ProductRecord | null {
  const href = card.match(/<a class="[^"]*\bproduct-link-ga"[^>]*href="(\/[^"?#]+)"/)?.[1];
  const title = card.match(/class="ProductCode"[^>]*>([^<]+)</)?.[1];
  const now = trAmount(card.match(/itemprop="NewPrice">([^<]+)</)?.[1]);
  const was = trAmount(card.match(/class="OldPrice"[^>]*>([^<]+)</)?.[1]);
  const name = decode(String(title ?? "")).replace(/\s+/g, " ").trim();
  if (!href || !name || now == null) return null;
  const imageUrl = `${IMAGE_BASE}${encodeURIComponent(code.toUpperCase())}.jpg`;
  return {
    brand,
    country: "TR",
    externalId: code.toUpperCase(),
    name,
    url: `${SITE}${href}`,
    imageUrl,
    images: [imageUrl],
    price: toMinor(now),
    listPrice: was != null && was - now > 0.005 ? toMinor(was) : null,
    currency: "TRY",
    inStock: availability == null || /InStock|LimitedAvailability/i.test(availability),
    category: /kol saati/i.test(name) ? "Kol Saati" : "Saat",
    gender,
    variants: null,
    groupKey: null,
    colorName: null,
  };
}

/** Rounded percent off, as the card's own `%N` tag shows it. */
const pctOff = (r: ProductRecord) => (r.listPrice ? Math.round((1 - r.price / r.listPrice) * 100) : 0);

/** A cut under the floor (the store-wide −5% web price) is no discount: a full-price row at the card's price. Pure. */
export function withFloor(r: ProductRecord, minPct = MIN_PCT): ProductRecord {
  return r.listPrice != null && pctOff(r) < minPct ? { ...r, listPrice: null } : r;
}

/** The last page number in a listing's pagination (1 when there is none). */
export function casioLastPage(page: string): number {
  const ns = [...page.matchAll(/href='\?p=(\d+)[^']*'/g)].map((m) => Number(m[1]));
  return ns.length ? Math.max(...ns) : 1;
}

async function fetchPage(url: string): Promise<string> {
  let err: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(2000 * attempt);
    try {
      return await getText(url, { timeoutMs: 30_000 });
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

export async function listProducts(): Promise<ProductRecord[]> {
  const started = Date.now();
  const byCode = new Map<string, ProductRecord>();
  const seenIn = new Map<string, Set<ProductRecord["gender"]>>();
  let pages = 0;
  for (const l of LISTINGS) {
    let last = Infinity;
    for (let n = 1; n <= last; n += CONCURRENCY) {
      if (pages > 0) await sleep(PAUSE_MS);
      const wave = Array.from({ length: CONCURRENCY }, (_, i) => n + i).filter((k) => k <= last);
      if (pages + wave.length > MAX_PAGES) throw new Error(`casio: more than ${MAX_PAGES} pages — raise CASIO_MAX_PAGES`);
      pages += wave.length;
      // Any refused page fails the brand, so stored rows are kept rather than delisted.
      const htmls = await Promise.all(wave.map((k) => fetchPage(pageUrl(l.path, k))));
      let end = false;
      for (const html of htmls) {
        last = last === Infinity ? casioLastPage(html) : Math.max(last, casioLastPage(html));
        const avail = casioAvailability(html);
        const cards = casioCards(html);
        for (const c of cards) {
          const href = c.html.match(/href="(\/[^"?#]+-d\d+)"/)?.[1];
          const mapped = mapCasioCard(c.code, c.html, l.gender, href ? avail.get(href) : undefined);
          if (!mapped) continue;
          const r = withFloor(mapped);
          const id = r.externalId;
          if (l.gender) (seenIn.get(id) ?? seenIn.set(id, new Set()).get(id)!).add(l.gender);
          if (!byCode.has(id)) byCode.set(id, r);
        }
        if (cards.length < PAGE_CARDS) end = true;
      }
      if (end) break;
    }
  }
  // A watch under both the women's and men's trees is unisex; kids' wins.
  for (const [id, gs] of seenIn) {
    const r = byCode.get(id)!;
    r.gender = gs.has("cocuk") ? "cocuk" : gs.has("kadin") && gs.has("erkek") ? null : r.gender;
  }
  const all = [...byCode.values()];
  if (process.env.CASIO_DEBUG) console.error(`casio: ${pages} pages, ${all.length} watches, ${Math.round((Date.now() - started) / 1000)} s`);
  // A cap that cut rows would let the delist sweep mark them sold out: refuse instead.
  if (all.length > MAX_PRODUCTS) throw new Error(`casio: ${all.length} watches, over the cap of ${MAX_PRODUCTS}`);
  const rank = (r: ProductRecord) => (r.listPrice != null ? 0 : 2) + (r.inStock ? 0 : 1);
  return all.sort((a, b) => rank(a) - rank(b));
}
