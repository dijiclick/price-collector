/**
 * bonprix outside Germany — the women's and men's SALE categories of each
 * country shop (2026-10-21). bonprix runs three shop generations at once, and
 * each country sits on one of them:
 *
 *  - "bff" (AT): the server render carries the whole page model as
 *    `window.modelContainer = {…}` → `preactModel.articleContent
 *    .articleListPageItems[].gridItem` (108 a page, `?page=N`, `hits` = total).
 *    Each grid item has styles × colours; the active colour
 *    (`firstViewColorIDs[0]`) has `price.currentPrice` / `price.oldPrice` /
 *    `currencyCode` and per-size `available` flags.
 *  - "legacy" (CH, IT, SE, NO): classic server-rendered cards
 *    (`class="product-list-item"`, ~99 a page, `?page=N`, `<link rel="next">`)
 *    with `price-tag` (now) and `price former` (bonprix's own former price).
 *    No stock on the card.
 *  - "nuxt" (FR, NL, BE — bonprix's Central-European platform): the Nuxt
 *    payload (`__NUXT_DATA__`) holds the API answer the page was built from,
 *    `category-init/<slug>/<id>?maxResults=65&offset=N` → `productsAndFilter`
 *    (70 a page whatever maxResults says, `?offset=N` in the page URL). Each
 *    product has `minPrice` / `oldPrice` / `priceFrom`. No stock. The API
 *    itself refuses cookieless calls (`refreshPage`), the page does not.
 *    Sale trees are stable ids across the three hosts: women c-6, men c-3240.
 *
 *  - "fi" (FI — the older Central-European shop): server-rendered bricks
 *    (`data-style-id`, ~59 a page, `?page=N`) whose `data-wishlist-params`
 *    JSON carries `catalogNumber`, `product_catalog_price` and
 *    `product_catalog_old_price`. Bricks priced "alkaen" (from) are skipped —
 *    about half of them. No stock.
 *
 * Every route answers a GitHub runner 200 (see the report of 2026-10-21).
 * Only rows whose struck price is above the selling price are kept; "from"
 * prices are skipped. The price block is the shop's own former price (EU
 * Omnibus / Swiss and Nordic sale prices as displayed).
 */
import type { ProductRecord, SizeVariant } from "../types";
import { getText } from "../http";
import { unflatten } from "./tchibo";
import type { CountryCode } from "../../../../lib/countries";

type Gender = "kadin" | "erkek";
interface Tree { path: string; gender: Gender; pages: number }
interface Market {
  kind: "bff" | "legacy" | "nuxt" | "fi";
  site: string;
  currency: string;
  lang: string;
  trees: Tree[];
}

export const BONPRIX_MARKETS: Partial<Record<CountryCode, Market>> = {
  AT: { kind: "bff", site: "https://www.bonprix.at", currency: "EUR", lang: "de-AT,de;q=0.9", trees: [{ path: "/kategorie/damen-sale/", gender: "kadin", pages: 14 }, { path: "/kategorie/herren-sale/", gender: "erkek", pages: 3 }] },
  CH: { kind: "legacy", site: "https://www.bonprix.ch", currency: "CHF", lang: "de-CH,de;q=0.9", trees: [{ path: "/kategorie/damen-sale/", gender: "kadin", pages: 15 }, { path: "/kategorie/herren-sale/", gender: "erkek", pages: 3 }] },
  IT: { kind: "legacy", site: "https://www.bonprix.it", currency: "EUR", lang: "it-IT,it;q=0.9", trees: [{ path: "/categoria/donna-sconti/", gender: "kadin", pages: 15 }, { path: "/categoria/uomo-sconti/", gender: "erkek", pages: 3 }] },
  SE: { kind: "legacy", site: "https://www.bonprix.se", currency: "SEK", lang: "sv-SE,sv;q=0.9", trees: [{ path: "/kategori/rea-dammode/", gender: "kadin", pages: 15 }, { path: "/kategori/rea-herrmode/", gender: "erkek", pages: 3 }] },
  NO: { kind: "legacy", site: "https://www.bonprix.no", currency: "NOK", lang: "nb-NO,no;q=0.9", trees: [{ path: "/kategori/dame-salg/", gender: "kadin", pages: 15 }, { path: "/kategori/herre-salg/", gender: "erkek", pages: 3 }] },
  FR: { kind: "nuxt", site: "https://www.bonprix.fr", currency: "EUR", lang: "fr-FR,fr;q=0.9", trees: [{ path: "/les-bons-plans-femme/c-6/", gender: "kadin", pages: 22 }, { path: "/les-bons-plans-homme/c-3240/", gender: "erkek", pages: 6 }] },
  NL: { kind: "nuxt", site: "https://www.bonprix.nl", currency: "EUR", lang: "nl-NL,nl;q=0.9", trees: [{ path: "/dames-sale/c-6/", gender: "kadin", pages: 22 }, { path: "/heren-sale/c-3240/", gender: "erkek", pages: 6 }] },
  FI: { kind: "fi", site: "https://www.bonprix.fi", currency: "EUR", lang: "fi-FI,fi;q=0.9", trees: [{ path: "/kategoria/101667/ale/", gender: "kadin", pages: 30 }, { path: "/kategoria/102210/ale/", gender: "erkek", pages: 8 }] },
  BE: { kind: "nuxt", site: "https://fl.bonprix.be", currency: "EUR", lang: "nl-BE,nl;q=0.9", trees: [{ path: "/dames-sale/c-6/", gender: "kadin", pages: 22 }, { path: "/heren-sale/c-3240/", gender: "erkek", pages: 6 }] },
};

const CAP = 1500;
const PAUSE_MS = Number(process.env.BONPRIX_PAUSE_MS ?? 500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").trim();

/** "9,99 €", "CHF 12.95", "1 299 kr", "1.299,00 €" → ×100. Null when not a price. */
export function priceCents(s: string): number | null {
  const t = decode(s).replace(/\s| | /g, "").replace(/^(CHF|€|kr|SEK|NOK)/i, "").replace(/(CHF|€|kr|:-|SEK|NOK)$/i, "");
  const m = t.match(/^(\d{1,3}(?:[.,']?\d{3})*|\d+)(?:[.,](\d{1,2}))?$/);
  if (!m) return null;
  const whole = Number(m[1].replace(/[.,']/g, ""));
  return whole * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

const toCents = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null);

function baseRecord(country: CountryCode, m: Market, id: string, name: string, url: string, image: string | null, price: number, was: number, gender: Gender): ProductRecord {
  return {
    brand: "bonprix",
    country,
    externalId: id,
    name,
    url,
    imageUrl: image,
    price,
    listPrice: was,
    currency: m.currency,
    inStock: true,
    category: null,
    gender,
    variants: null,
  };
}

// ---- bff (AT) -------------------------------------------------------------

/** The page model out of a "bff" page; null when it is missing. */
export function bffModel(html: string): any | null {
  const at = html.indexOf("window.modelContainer = ");
  if (at < 0) return null;
  const s = html.slice(at + "window.modelContainer = ".length);
  // The object literal is JSON followed by `;` and more script: cut at the
  // balanced closing brace (strings may contain braces, so track them).
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(s.slice(0, i + 1))?.preactModel ?? null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Map one bff grid item (its active colour). Pure. */
export function mapBff(g: any, country: CountryCode, m: Market, gender: Gender): ProductRecord | null {
  const styles: any[] = Array.isArray(g?.styles) ? g.styles : [];
  const colors = styles.flatMap((st: any) => (Array.isArray(st?.colors) ? st.colors : []));
  const first = Array.isArray(g?.firstViewColorIDs) ? g.firstViewColorIDs[0] : null;
  const c = colors.find((x: any) => x?.id === first) ?? colors[0];
  const title = String(g?.title ?? "").trim();
  if (!c || !title || typeof c.url !== "string" || !c.url.startsWith("/")) return null;
  const p = c.price ?? {};
  if (p.fromPrice || p.unknownPrice) return null;
  if (p.currencyCode && p.currencyCode !== m.currency) return null;
  const price = toCents(p.currentPrice);
  const was = toCents(p.oldPrice);
  if (price == null || was == null || !(was > price)) return null;
  const host = m.site.replace("https://www.", "https://image01.");
  const img = Array.isArray(c.images) && typeof c.images[0]?.src === "string" ? `${host}/assets/477x668/${c.images[0].src.replace(/\.webp$/, ".jpg")}` : null;
  const sizes: SizeVariant[] = (Array.isArray(c.sizes) ? c.sizes : [])
    .filter((s: any) => typeof s?.name === "string" && s.name.trim())
    .map((s: any) => ({ label: s.name.trim(), availability: s.available ? "in_stock" : "out_of_stock" }));
  const rec = baseRecord(country, m, String(c.itemNumber ?? c.id), title, `${m.site}${c.url}`, img, price, was, gender);
  if (sizes.length) {
    rec.inStock = sizes.some((s) => s.availability === "in_stock");
    rec.variants = { colors: c.name ? [String(c.name)] : [], sizes };
  }
  if (c.name) rec.colorName = String(c.name);
  return rec;
}

// ---- legacy (CH, IT, SE, NO) ---------------------------------------------

/** Every reduced card on a legacy listing page. Pure. */
export function parseLegacy(html: string, country: CountryCode, m: Market, gender: Gender): ProductRecord[] {
  const starts = [...html.matchAll(/class="product-list-item\s*"/g)].map((x) => x.index!);
  const out: ProductRecord[] = [];
  for (let i = 0; i < starts.length; i++) {
    const card = html.slice(starts[i], starts[i + 1] ?? html.length);
    const link = card.match(/href="(https:\/\/[^"]+?\/[^"/]+-(\d{5,})\/)(?:#image)?"\s+class="product-link"/);
    const name = card.match(/data-product-name="([^"]+)"/)?.[1];
    if (!link || !name) continue;
    const text = card.slice(card.indexOf('<div class="product-text'));
    const bottom = text.match(/<div class="product-price[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? "";
    if (/price-from|starting/i.test(bottom)) continue;
    const now = bottom.match(/class=.price-tag.>([^<]+)</)?.[1];
    const old = bottom.match(/class="price former">([^<]+)</)?.[1];
    const price = now ? priceCents(now) : null;
    const was = old ? priceCents(old) : null;
    if (price == null || was == null || !(was > price) || price <= 0) continue;
    const src = card.match(/<img data-src="(\/\/image01\.bonprix\.[a-z]+\/assets\/477x668\/[^"]+)"/)?.[1];
    const img = src ? `https:${src.replace(/\.webp$/, ".jpg")}` : null;
    const url = link[1].replace(":443/", "/");
    out.push(baseRecord(country, m, link[2], decode(name), url, img, price, was, gender));
  }
  return out;
}

// ---- nuxt (FR, NL, BE) ----------------------------------------------------

/** `productsAndFilter` out of a nuxt page; null when missing. */
export function nuxtProducts(html: string): { total: number; products: any[] } | null {
  const mm = html.match(/<script type="application\/json"[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!mm) return null;
  let data: any;
  try {
    data = unflatten(JSON.parse(mm[1]))?.data;
  } catch {
    return null;
  }
  const key = data && Object.keys(data).find((k) => k.includes("/catalog/category-init/"));
  const pf = key ? data[key]?.productsAndFilter : null;
  if (!pf || !Array.isArray(pf.products)) return null;
  return { total: Number(pf.pagination?.totalItems ?? 0), products: pf.products };
}

/** Map one nuxt product (its selected colour). Pure. */
export function mapNuxt(p: any, country: CountryCode, m: Market, gender: Gender): ProductRecord | null {
  const cat = String(p?.catalogNumber ?? "").trim();
  const style = p?.styleId;
  const slug = String(p?.friendlyName ?? "").trim();
  const name = String(p?.name ?? "").trim();
  if (!cat || !style || !slug || !name) return null;
  if (p.priceFrom != null && p.priceFrom !== false) return null;
  const price = toCents(p.minPrice);
  const was = toCents(p.oldPrice);
  if (price == null || was == null || !(was > price)) return null;
  const imgs: string[] = Array.isArray(p.photos?.urls) ? p.photos.urls.filter((u: any) => typeof u === "string" && u.startsWith("https://")) : [];
  const color = (Array.isArray(p.colors) ? p.colors : []).find((c: any) => c?.catalogNumber === cat)?.colorName;
  const rec = baseRecord(country, m, cat, name, `${m.site}/${slug}/p-${style}/${cat}/`, imgs[0] ?? null, price, was, gender);
  if (imgs.length > 1) rec.images = imgs.slice(0, 6);
  if (color) rec.colorName = String(color);
  return rec;
}

// ---- fi (FI) ------------------------------------------------------------

/** Every reduced brick on a bonprix.fi listing page. Pure. */
export function parseFi(html: string, country: CountryCode, m: Market, gender: Gender): ProductRecord[] {
  const starts = [...html.matchAll(/<div data-style-id="\d+"/g)].map((x) => x.index!);
  const out: ProductRecord[] = [];
  for (let i = 0; i < starts.length; i++) {
    const card = html.slice(starts[i], starts[i + 1] ?? html.length);
    let w: any;
    try {
      w = JSON.parse(decode(card.match(/data-wishlist-params='([^']+)'/)?.[1] ?? ""));
    } catch {
      continue;
    }
    const cat = String(w?.catalogNumber ?? "").trim();
    const href = card.match(/<a href="(\/tyyli\/[^"?]+\/)\?/)?.[1];
    const title = card.match(/class="product-brick-title[^"]*">([^<]+)</)?.[1];
    if (!/^\d{5,}$/.test(cat) || !href || !title) continue;
    const block = card.match(/<span class="product-brick-price[^"]*">([\s\S]*?)<\/span>\s*<\/div>/)?.[1] ?? "";
    if (/alkaen/i.test(block)) continue;
    const price = toCents(w.product_catalog_price);
    const was = toCents(w.product_catalog_old_price);
    if (price == null || was == null || !(was > price)) continue;
    const src = card.match(/<noscript>\s*<img[^>]*?src="(\/\/pix\.bonprix\.fi\/[^"]+)"/)?.[1];
    const rec = baseRecord(country, m, cat, decode(title), `${m.site}${href}?catalogueNumber=${cat}`, src ? `https:${src}` : null, price, was, gender);
    if (typeof w.product_colors === "string" && w.product_colors.trim()) rec.colorName = w.product_colors.trim();
    out.push(rec);
  }
  return out;
}

// ---- crawl ----------------------------------------------------------------

export async function listBonprixIntl(country: CountryCode, fetchHtml?: (u: string) => Promise<string>): Promise<ProductRecord[]> {
  const m = BONPRIX_MARKETS[country];
  if (!m) return [];
  // bonprix.fi answers 403 when a full Chrome UA arrives with Node's TLS
  // fingerprint (the collector's default); a Safari or Firefox UA gets 200.
  const ua: Record<string, string> = m.kind === "fi" ? { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15" } : {};
  const get = fetchHtml ?? ((u: string) => getText(u, { country, timeoutMs: 60_000, headers: { "Accept-Language": m.lang, ...ua } }));
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const tree of m.trees) {
    let seen = 0;
    for (let page = 1; page <= tree.pages; page++) {
      const offset = m.kind === "nuxt" ? seen : 0;
      const url = m.kind === "nuxt" ? `${m.site}${tree.path}${offset ? `?offset=${offset}` : ""}` : `${m.site}${tree.path}${page > 1 ? `?page=${page}` : ""}`;
      if (calls++) await sleep(PAUSE_MS);
      const html = await get(url); // a failed page throws: no silent partial list
      let rows: ProductRecord[] = [];
      let total = 0;
      let count = 0;
      let lastPage = Infinity;
      if (m.kind === "bff") {
        const pm = bffModel(html);
        if (!pm) throw new Error(`bonprix/${country}: no page model on ${url} (markup changed?)`);
        const items = (pm.articleContent?.articleListPageItems ?? []).map((x: any) => x?.gridItem).filter((g: any) => Array.isArray(g?.styles));
        count = items.length;
        // Grid slots go to teasers too, so `hits` cannot be divided by the page
        // size: the pager's highest page number is the end.
        const pages = (pm.navigationContent?.pagination?.paginationItems ?? []).map((x: any) => Number(x?.label)).filter((n: number) => n > 0);
        lastPage = pages.length ? Math.max(...pages) : page;
        rows = items.map((g: any) => mapBff(g, country, m, tree.gender)).filter(Boolean) as ProductRecord[];
      } else if (m.kind === "legacy") {
        rows = parseLegacy(html, country, m, tree.gender);
        count = (html.match(/class="product-list-item\s*"/g) ?? []).length;
        if (page === 1 && count === 0) throw new Error(`bonprix/${country}: no product cards on ${url} (markup changed?)`);
      } else if (m.kind === "fi") {
        rows = parseFi(html, country, m, tree.gender);
        count = (html.match(/<div data-style-id="\d+"/g) ?? []).length;
        if (page === 1 && count === 0) throw new Error(`bonprix/${country}: no product bricks on ${url} (markup changed?)`);
      } else {
        const res = nuxtProducts(html);
        if (!res) throw new Error(`bonprix/${country}: no product payload on ${url} (markup changed?)`);
        total = res.total;
        count = res.products.length;
        rows = res.products.map((p) => mapNuxt(p, country, m, tree.gender)).filter(Boolean) as ProductRecord[];
      }
      seen += count;
      let fresh = 0;
      for (const r of rows) {
        if (byId.has(r.externalId)) continue;
        byId.set(r.externalId, r);
        fresh++;
      }
      const done =
        count === 0 ||
        (m.kind === "legacy"
          ? !/<link rel="next"/.test(html)
          : m.kind === "fi"
            ? !html.includes(`page=${page + 1}"`)
            : m.kind === "bff"
              ? page >= lastPage
              : total > 0 && seen >= total) ||
        (rows.length > 0 && fresh === 0);
      if (done) break;
      if (page === tree.pages) throw new Error(`bonprix/${country}: ${tree.path} still has pages after ${page} (cap reached)`);
    }
  }
  const all = [...byId.values()];
  const out = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
  console.log(`bonprix/${country}: ${calls} pages, ${all.length} reduced, kept ${out.length}`);
  return out;
}
