/**
 * Shared collector for RND Commerce storefronts (ASP.NET MVC, Medianova CDN
 * `st-<shop>.mncdn.com`) — Levi's Turkey (levis.com.tr), Vans Turkey and
 * Timberland Turkey (2026-10-18). The North Face Turkey runs RND's newer
 * stack and is NOT here: its AWS WAF answers every GitHub-runner request 405.
 *
 * There is no JSON listing route; the server-rendered listing IS the feed.
 * Each listing pages with `?p=N` (48 cards, a page past the end has none) and
 * every card carries its product id (`data-id` / `data-product-id`, the same
 * number that ends the product url: `/platform-old-skool-ayakkabi_124650`).
 * Vans and Timberland cards also carry the GA4 `data-event-data` item — name,
 * section (`item_category`), type, colour, `first_price`/`price`, total stock.
 * Levi's cards do not, so its walk splits the sale tree by `?g=<section>`.
 *
 * Prices are read from the card's own `old-price`/`new-price` (`oldprice`/
 * `newprice` on Vans) spans — what the shopper sees — and the GA4 pair only
 * when the spans are missing.
 *
 * Sizes are not on the card. One quick-view partial per product (~5–40 KB)
 * lists them, each with its own stock count (`data-stock`, Vans
 * `data-count-alert`); a rotating subset is fetched per run and the upsert
 * keeps earlier variants, so coverage accumulates.
 *
 * Every page answered a GitHub runner with no proxy (probe run 39124447024).
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";

export interface RndListing {
  /** Path with any query, e.g. `/indirim?g=kadin` or `/tum-outlet`. */
  path: string;
  /** The section this listing IS, for cards that carry none. */
  gender?: ProductRecord["gender"];
}

export interface RndShop {
  brand: string;
  /** Origin, e.g. `https://www.vans.com.tr`. */
  site: string;
  listings: RndListing[];
  /** Quick-view partial for one product id (sizes with stock). */
  detailPath: (id: string) => string;
}

export interface RndLimits {
  /** Most products returned. */
  maxProducts: number;
  /** Most listing pages fetched, over all listings. */
  maxPages: number;
  /** Most quick-view calls per run. */
  detailLimit: number;
  /** Wall-clock budget; the detail pass stops when it runs out. */
  budgetMs: number;
}

const PAUSE_MS = Number(process.env.RND_PAUSE_MS ?? 250);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fold = (s: string) =>
  s
    .replace(/[İI]/g, "i")
    .replace(/ı/g, "i")
    .replace(/[Çç]/g, "c")
    .replace(/[Şş]/g, "s")
    .replace(/[Ğğ]/g, "g")
    .replace(/[Öö]/g, "o")
    .replace(/[Üü]/g, "u")
    .toLowerCase();

/** "KADIN" / "Erkek Çocuk" / "Unisex" → our section, or null. Child first. */
export function rndGender(text: string | null | undefined): ProductRecord["gender"] {
  if (!text) return null;
  const t = fold(text);
  if (/cocuk|bebek|\bkids?\b/.test(t)) return "cocuk";
  if (/\bkadin\b/.test(t)) return "kadin";
  if (/\berkek\b/.test(t)) return "erkek";
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
export function decodeHtml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** "9.999,90" → 9999.9; null when it is not a Turkish-format amount. */
export function trAmount(s: string | null | undefined): number | null {
  const m = String(s ?? "").match(/(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})/);
  if (!m) return null;
  const n = Number(`${m[1].replace(/\./g, "")}.${m[2]}`);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** First amount in an element whose class list holds `cls` as a whole word. */
function spanAmount(html: string, cls: string): number | null {
  const re = new RegExp(`class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"[^>]*>\\s*([\\d.]+,\\d{2})\\s*TL`);
  return trAmount(html.match(re)?.[1]);
}

/** The shopper-facing pair from `old-price`/`new-price` spans (`oldprice`/`newprice`, `one-price`). */
export function htmlPrices(html: string): { now: number | null; was: number | null } {
  const was = spanAmount(html, "old-?price");
  const now = spanAmount(html, "new-?price") ?? spanAmount(html, "one-price");
  return { now, was };
}

/** The GA4 item a card or product page carries in `data-event-data`, or null. */
export function eventItem(html: string): any | null {
  const raw = html.match(/data-event-data="([^"]*)"/)?.[1];
  if (!raw) return null;
  try {
    const j = JSON.parse(decodeHtml(raw));
    return Array.isArray(j?.items) && j.items[0] ? j.items[0] : null;
  } catch {
    return null;
  }
}

const num = (x: unknown): number | null => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const CARD_START = /<div\b[^>]*\bclass="(?:item|p-item|pitem)\s[^"]*"[^>]*>/g;

/** Product cards of a listing page, in page order, as `{id, html}` chunks. */
export function rndCards(page: string): { id: string; html: string }[] {
  const starts: { at: number; id: string }[] = [];
  for (const m of page.matchAll(CARD_START)) {
    const tag = m[0];
    if (!/data-js="p-item"|class="pitem\s/.test(tag)) continue;
    const id = tag.match(/\bdata-(?:product-)?id="(\d+)"/)?.[1];
    if (id) starts.push({ at: m.index!, id });
  }
  return starts.map((s, i) => ({
    id: s.id,
    html: page.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : Math.min(page.length, s.at + 20_000)),
  }));
}

const IMG_RE = /https?:\/\/[^"'\s&]+?\/Content\/media\/ProductImg\/original\/[^"'\s&]+/g;

/** Photo urls of one card or page, card image first, one per file. */
export function rndImages(html: string): string[] {
  const urls = [...html.matchAll(IMG_RE)].map((m) => m[0]);
  // Levi's lists the rest of the gallery as bare file names.
  const base = urls[0]?.slice(0, urls[0].lastIndexOf("/") + 1);
  const list = html.match(/data-image-list="([^"]*)"/)?.[1];
  if (base && list) {
    try {
      for (const f of JSON.parse(decodeHtml(list))) if (typeof f === "string" && f) urls.push(base + f);
    } catch {
      /* not a list */
    }
  }
  // Card-sized renditions first (the GA4 item names the multi-MB original),
  // square thumbnails asked for at 1000 px — Medianova resizes any size.
  const sized = (u: string) =>
    u.replace(/\/mnresize\/(\d+)\/(\d+)\//, (m, w, h) => (w === h && Number(w) < 1000 ? "/mnresize/1000/1000/" : m));
  urls.sort((a, b) => Number(!a.includes("/mnresize/")) - Number(!b.includes("/mnresize/")));
  const seen = new Set<string>();
  return urls.map(sized).filter((u) => {
    if (/\.(mp4|mov|webm)$/i.test(u)) return false;
    const file = u.slice(u.lastIndexOf("/") + 1);
    if (seen.has(file)) return false;
    seen.add(file);
    return true;
  });
}

/** Map one listing card. Pure; null for a card without a usable price. */
export function mapRndCard(shop: RndShop, id: string, card: string, gender: ProductRecord["gender"] = null): ProductRecord | null {
  const ev = eventItem(card);
  const href = card.match(new RegExp(`href="(/[^"?#]*_${id})"`))?.[1];
  const title = card.match(new RegExp(`href="/[^"?#]*_${id}"[^>]*\\btitle="([^"]+)"`))?.[1];
  const name = decodeHtml(String(ev?.item_name ?? title ?? "")).replace(/\s+/g, " ").trim();
  const html = htmlPrices(card);
  const now = html.now ?? num(ev?.price);
  const was = html.now != null ? html.was : num(ev?.first_price);
  if (!name || !href || now == null) return null;
  const imgs = rndImages(card);
  const colour = typeof ev?.item_variant === "string" && ev.item_variant.trim() ? ev.item_variant.trim() : null;
  // The model code, shared by its colours: the card tag's own `data-code`
  // (Timberland), else the "more colours" link's `data-key` (Vans). Vans'
  // favourite button carries a `data-code` too, but that is the colour SKU.
  const tag = card.slice(0, card.indexOf(">") + 1);
  const code = tag.match(/\bdata-code="([A-Z0-9]{5,})"/)?.[1] ?? card.match(/\bdata-key="([A-Z0-9]{6,})"/)?.[1] ?? null;
  // The GA4 item names the product's primary category, which is sometimes a
  // campaign ("KAMPANYALAR" > "FRIENDS & FAMILY - AKBANK", "TÜM ÜRÜNLER" >
  // "İndirimsiz Ürünler") rather than section > type; only a section's type is kept.
  const section = typeof ev?.item_category === "string" ? ev.item_category : "";
  const realSection = rndGender(section) != null || /^uni/i.test(fold(section).trim());
  const type = realSection && typeof ev?.item_category2 === "string" && ev.item_category2.trim() ? ev.item_category2.trim() : null;
  return {
    brand: shop.brand,
    country: "TR",
    externalId: id,
    name,
    url: `${shop.site}${href}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(now),
    listPrice: was != null && was - now > 0.005 ? toMinor(was) : null,
    currency: "TRY",
    // The GA4 item's stock is the colour's total; Levi's cards carry none, and
    // its listings show buyable products only — the size pass corrects both.
    inStock: ev ? Number(ev.stock ?? 0) > 0 : true,
    category: type,
    gender: rndGender(ev?.item_category) ?? gender ?? rndGender(name),
    variants: null,
    groupKey: code ? `${shop.brand}:${code}` : null,
    colorName: colour,
  };
}

/**
 * Sizes from a quick-view partial or product page: every `<li>`/`<a>` that
 * carries both a label (`title` / `data-key`) and a stock count (`data-stock`
 * / `data-count-alert`). Levi's jeans list waist and length (`…-drop-option`)
 * separately with the same counts; only the waist list is kept.
 */
export function rndSizes(html: string): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<(?:li|a)\b[^>]*>/g)) {
    const tag = m[0];
    if (/data-js="[^"]*drop/.test(tag)) continue;
    const stock = tag.match(/\bdata-(?:stock|count-alert)="(-?\d+)"/)?.[1];
    const label = decodeHtml(tag.match(/\btitle="([^"]*)"/)?.[1] ?? tag.match(/\bdata-key="([^"]*)"/)?.[1] ?? "").trim();
    if (stock == null || !label || seen.has(label)) continue;
    seen.add(label);
    const q = Number(stock);
    out.push({ label, availability: q > 2 ? "in_stock" : q > 0 ? "low_on_stock" : "out_of_stock" });
  }
  // A lone "STD" is a bag or a cap, not a size anyone waits for.
  if (out.length === 1 && /^(std|standart|tek ebat|tek beden|o\/s|os)$/i.test(out[0].label)) return [];
  return out;
}

/** Facts the legacy dataLayer push on Levi's pages names: type, colour, section. */
export function rndLayerFacts(html: string): { category: string | null; colour: string | null; section: string | null } {
  const pick = (key: string) => {
    const v = html.match(new RegExp(`['"]${key}['"]\\s*:\\s*"([^"]*)"`))?.[1];
    return v && v.trim() ? decodeHtml(v.trim()) : null;
  };
  return { category: pick("category"), colour: pick("variant"), section: pick("product_departman") };
}

/** Apply one quick-view partial to its record (sizes, stock, and the facts the card lacked). */
export function applyRndDetail(r: ProductRecord, html: string): void {
  const sizes = rndSizes(html);
  const facts = rndLayerFacts(html);
  if (!r.colorName && facts.colour) r.colorName = facts.colour;
  if (!r.category && facts.category) r.category = facts.category;
  if (!r.gender) r.gender = rndGender(facts.section);
  if (sizes.length) {
    r.variants = { colors: r.colorName ? [r.colorName] : [], sizes };
    r.inStock = sizes.some((s) => s.availability !== "out_of_stock");
  }
}

const pageUrl = (shop: RndShop, path: string, n: number) =>
  `${shop.site}${path}${n > 1 ? `${path.includes("?") ? "&" : "?"}p=${n}` : ""}`;

/** Walk every listing, keep the reduced cards, then a bounded size pass. */
export async function listRnd(shop: RndShop, limits: RndLimits): Promise<ProductRecord[]> {
  const started = Date.now();
  const byId = new Map<string, ProductRecord>();
  let pages = 0;
  for (const l of shop.listings) {
    for (let n = 1; pages < limits.maxPages; n++) {
      if (pages > 0) await sleep(PAUSE_MS);
      pages++;
      let html: string;
      try {
        html = await getText(pageUrl(shop, l.path, n), { timeoutMs: 30_000 }).catch(async () => {
          // One slow page from a GitHub runner ended Vans' first sweep at
          // 48 of ~800 deals (2026-10-18): wait, then give it longer once.
          await sleep(PAUSE_MS * 3);
          return getText(pageUrl(shop, l.path, n), { timeoutMs: 60_000 });
        });
      } catch (err) {
        // A refused first page is an outage, not an empty sale: fail the brand
        // so the stored rows are kept rather than delisted.
        if (byId.size === 0 && pages === 1) throw err;
        console.warn(`${shop.brand}: page ${n} of ${l.path} failed twice, stopping at ${byId.size} rows`);
        break;
      }
      let fresh = 0;
      for (const c of rndCards(html)) {
        if (byId.has(c.id)) continue;
        const r = mapRndCard(shop, c.id, c.html, l.gender ?? null);
        if (r && r.listPrice != null) {
          byId.set(c.id, r);
          fresh++;
        }
      }
      if (fresh === 0) break;
    }
  }

  const all = [...byId.values()];
  const records = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, limits.maxProducts);

  const sample = [...records];
  for (let j = sample.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [sample[j], sample[k]] = [sample[k], sample[j]];
  }
  let failures = 0;
  for (const r of sample.slice(0, limits.detailLimit)) {
    if (Date.now() - started > limits.budgetMs || failures >= 5) break;
    await sleep(PAUSE_MS);
    const html = await getText(`${shop.site}${shop.detailPath(r.externalId)}`, { timeoutMs: 20_000 }).catch(() => null);
    if (!html) {
      failures++;
      continue;
    }
    applyRndDetail(r, html);
  }
  if (process.env.RND_DEBUG) console.error(`${shop.brand}: ${pages} pages, ${records.length} deals, ${Math.round((Date.now() - started) / 1000)} s`);
  return [...records.filter((r) => r.inStock), ...records.filter((r) => !r.inStock)];
}

/** Limits from env with a per-brand prefix (`VANS_TR_DETAIL_LIMIT`, …). */
export function rndLimitsFromEnv(prefix: string, d: RndLimits): RndLimits {
  const n = (k: string, v: number) => {
    const x = Number(process.env[`${prefix}_${k}`]);
    return Number.isFinite(x) && x > 0 ? x : v;
  };
  return {
    maxProducts: n("MAX_PRODUCTS", d.maxProducts),
    maxPages: n("MAX_PAGES", d.maxPages),
    detailLimit: n("DETAIL_LIMIT", d.detailLimit),
    budgetMs: n("BUDGET_MS", d.budgetMs),
  };
}
