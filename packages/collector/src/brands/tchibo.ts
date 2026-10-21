/**
 * Tchibo Germany — fashion SALE only (Damen, Herren), never coffee or
 * household (owner rule, 2026-10-21).
 *
 * tchibo.de's category pages are a Nuxt app whose server render embeds the
 * whole search result as Nuxt's own JSON payload
 * (`<script type="application/json" data-nuxt-data="category-ui">`), and the
 * app has no listing API of its own (the Android app is a Flutter shell over
 * the same pages). So the feed is that payload, not the HTML around it.
 *
 * `?page=N` is "load more": page N returns the first N×24 items in ONE
 * response, so a whole sale tree is a single request (`page=100` → ≤2,400
 * items, ~3.6 MB gzip / ~43 MB raw for Damen). Both trees answer a GitHub
 * runner 200 (probe runs 39613147946, 2026-10-21).
 *
 * Each item is one colour: `price.current`, `price.old` (Tchibo's original
 * price) and `price.bestPriceAmount` — the EU Omnibus lowest price of the
 * last 30 days, which is what Tchibo's own "-NN%" is computed against. Only
 * rows whose 30-day low is ABOVE today's price are kept, with that low as the
 * list price: ~60% of the sale tree was already this cheap (or cheaper) within
 * 30 days and is not a fresh markdown. Sizes carry AVAILABLE / UNAVAILABLE.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import type { CountryCode } from "../../../../lib/countries";

const SITE = "https://www.tchibo.de";
const PER_PAGE = 24;
/** Load-more depth per tree; 100 × 24 = 2,400 items (Damen sale: ~2,230). */
const PAGES = Number(process.env.TCHIBO_PAGES ?? 100);
const CAP = 1500;
export const TCHIBO_TREES: { path: string; gender: "kadin" | "erkek" }[] = [
  { path: "/categories/sale/damen", gender: "kadin" },
  { path: "/categories/sale/herren", gender: "erkek" },
];

/**
 * Tchibo Austria and Switzerland (2026-10-21): the same storefront, same sale
 * paths and payload on tchibo.at / tchibo.ch. Prices are in cents of the
 * shop's currency (`currencyCode` "EUR_AT" / "CHF"); both carry the 30-day
 * `bestPriceAmount` too.
 */
export const TCHIBO_MARKETS: Partial<Record<CountryCode, { site: string; currency: string; lang: string }>> = {
  DE: { site: SITE, currency: "EUR", lang: "de-DE,de;q=0.9" },
  AT: { site: "https://www.tchibo.at", currency: "EUR", lang: "de-AT,de;q=0.9" },
  CH: { site: "https://www.tchibo.ch", currency: "CHF", lang: "de-CH,de;q=0.9" },
};

const WRAPPERS = new Set(["ShallowReactive", "Reactive", "Ref", "ShallowRef"]);

/** Nuxt's payload is devalue-flattened: every value is an index into one array. */
export function unflatten(arr: any[]): any {
  const memo = new Map<number, any>();
  const hy = (i: any): any => {
    if (typeof i !== "number") return i;
    if (i < 0) return undefined;
    if (memo.has(i)) return memo.get(i);
    const v = arr[i];
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) {
      if (typeof v[0] === "string" && WRAPPERS.has(v[0])) return hy(v[1]);
      const out: any[] = [];
      memo.set(i, out);
      for (const x of v) out.push(hy(x));
      return out;
    }
    const out: Record<string, any> = {};
    memo.set(i, out);
    for (const [k, x] of Object.entries(v)) out[k] = hy(x);
    return out;
  };
  return hy(0);
}

/** The category result out of a page's HTML; null when the payload is missing. */
export function categoryResults(html: string): { numFound: number; items: any[] } | null {
  const m = html.match(/<script type="application\/json" data-nuxt-data="category-ui"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  const res = unflatten(JSON.parse(m[1]))?.data?.CategoryResults;
  if (!res || !Array.isArray(res.items)) return null;
  return { numFound: Number(res.metadata?.numFound ?? 0), items: res.items };
}

const SIZE_STATE: Record<string, SizeVariant["availability"]> = { AVAILABLE: "in_stock", UNAVAILABLE: "out_of_stock", BACK_IN_STOCK_REGISTRATION_POSSIBLE: "out_of_stock" };

/** Map one item (one colour). Pure. Null unless it is cheaper than its 30-day low. */
export function mapTchibo(it: any, gender: ProductRecord["gender"], country: CountryCode = "DE"): ProductRecord | null {
  const mk = TCHIBO_MARKETS[country] ?? TCHIBO_MARKETS.DE!;
  const site = mk.site;
  const id = it?.id;
  const view = typeof it?.productViewUrl === "string" ? it.productViewUrl : "";
  const title = String(it?.title ?? "").trim();
  const price = Number(it?.price?.current);
  if (!id || !view.startsWith("/") || !title || !(price > 0)) return null;
  const cc = String(it.price?.currencyCode ?? "");
  if (country !== "DE" && cc && !cc.startsWith(mk.currency)) return null;
  const best = Number(it.price?.bestPriceAmount);
  const old = Number(it.price?.old);
  // The Omnibus reference when Tchibo gives one, else its original price.
  const was = Number.isFinite(best) && best > 0 ? best : old;
  if (!(was > price)) return null;
  const dims: any[] = Array.isArray(it.dimensions) ? it.dimensions : [];
  // Colours of one product share `id`; the order number is the colour.
  const colour = String(dims[0]?.tdOrderNumber ?? it.tcmArticleNumber ?? "").trim();
  const sizes: SizeVariant[] = dims
    .filter((d) => typeof d?.name === "string" && d.name.trim())
    .map((d) => ({ label: d.name.trim(), availability: SIZE_STATE[String(d.availability)] ?? "out_of_stock" }));
  const img = (u: unknown) => (typeof u === "string" && u.startsWith("/") ? `${site}${u}` : null);
  const lead = img(it.imageUrlMediumSize) ?? img(it.imageUrlSmallSize);
  const mood = img(it.moodImageUrl);
  const siblings = Array.isArray(it.webshopProduct?.siblingProducts) ? it.webshopProduct.siblingProducts.length : 0;
  const colorName = String(it.webshopProduct?.dimensionValue ?? "").trim() || (title.includes(", ") ? title.split(", ").pop()!.trim() : null);
  return {
    brand: "tchibo",
    country,
    externalId: colour ? `${id}-${colour}` : String(id),
    name: title,
    url: `${site}${view}`,
    imageUrl: lead,
    images: cleanGallery([lead, mood], lead),
    price,
    listPrice: was,
    currency: mk.currency,
    inStock: it.availability === "AVAILABLE" && (sizes.length === 0 || sizes.some((s) => s.availability === "in_stock")),
    category: null,
    gender,
    variants: sizes.length ? { colors: colorName ? [colorName] : [], sizes } : null,
    // `siblingProducts` lists the OTHER colours (self excluded).
    groupKey: siblings > 0 ? `tchibo:${id}` : null,
    colorName,
  };
}

export async function listTchibo(country: CountryCode, fetchHtml: (u: string) => Promise<string> = (u) => getText(u, { country, timeoutMs: 120_000, headers: { "Accept-Language": TCHIBO_MARKETS[country]?.lang ?? "de-DE,de;q=0.9" } })): Promise<ProductRecord[]> {
  const mk = TCHIBO_MARKETS[country];
  if (!mk) return [];
  const byId = new Map<string, ProductRecord>();
  let seen = 0;
  for (const tree of TCHIBO_TREES) {
    const res = categoryResults(await fetchHtml(`${mk.site}${tree.path}?page=${PAGES}&sort=relevance`));
    // A page without the payload means the storefront changed shape: fail the
    // brand (stored rows stay) rather than sweep every row out as delisted.
    if (!res) throw new Error(`tchibo: no category payload on ${tree.path}`);
    seen += res.items.length;
    for (const it of res.items) {
      const r = mapTchibo(it, tree.gender, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  const out = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
  console.log(`tchibo/${country}: ${seen} sale items (≤${PAGES * PER_PAGE} per tree), ${all.length} below their 30-day low, kept ${out.length}`);
  return out;
}
