/**
 * Shared collector for Shopify storefronts — generalised from derimod.ts
 * (2026-10-11). `/products.json?limit=250&page=N` is the whole catalogue with
 * per-variant `price`, `compare_at_price` and `available`, in the shop's own
 * currency. No proxy: every store in shopify-stores.ts answered a GitHub
 * runner directly (probe run 38118615770) and its `/meta.json` currency was
 * checked against the market it is listed for.
 *
 * Only reduced rows are kept, in-stock first, capped — the same contract as the
 * other adapters: the feed is for discounts, and a pasted link resolves any
 * product live.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

import type { ShopifySite } from "../../../../lib/live-brands/shopify-sites";
export type ShopifyStore = ShopifySite;

const MAX_PAGES = Number(process.env.SHOPIFY_MAX_PAGES ?? 40);
const PAUSE_MS = Number(process.env.SHOPIFY_PAUSE_MS ?? 1200);
/** Anything priced above this many major units is a gift card or a bundle, not a product. */
const MAX_PRICE = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fold = (s: string) =>
  s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").replace(/[Şş]/g, "s").toLowerCase();

export function genderOf(p: any, fallback: ProductRecord["gender"] = null): ProductRecord["gender"] {
  const tags: string[] = Array.isArray(p?.tags) ? p.tags.map(String) : typeof p?.tags === "string" ? p.tags.split(",") : [];
  const t = fold([...tags, p?.product_type ?? "", p?.title ?? ""].join(" | "));
  if (/\b(kids?|girls?|boys?|baby|toddler|cocuk|bebek|junior|kinder|enfants?)\b/.test(t)) return "cocuk";
  if (/\b(wom[ae]n'?s?|ladies|female|kadin|feed-gender-female|damen|femmes?)\b/.test(t)) return "kadin";
  if (/\b(m[ae]n'?s?|male|erkek|feed-gender-male|herren|hommes?)\b/.test(t)) return "erkek";
  return fallback;
}

function optionKey(p: any, re: RegExp): string | null {
  const opts: any[] = p?.options ?? [];
  const i = opts.findIndex((o) => re.test(String(typeof o === "string" ? o : o?.name ?? "")));
  return i >= 0 ? `option${i + 1}` : null;
}

/** Map one `/products.json` product. Pure. Prices there are major-unit strings. */
export function mapShopify(store: ShopifyStore, country: CountryCode, site: string, p: any): ProductRecord | null {
  const vs: any[] = p?.variants ?? [];
  if (!p?.id || !p?.title || !vs.length) return null;
  if (/gift ?card|hediye ?kart/i.test(`${p.title} ${p.product_type ?? ""}`)) return null;
  if (store.skipTitle?.test(`${p.title} | ${p.product_type ?? ""}`)) return null;
  // Wholesale items ride in products.json but have no storefront page: every
  // Reebok US product tagged `f45-b2b` (F45 gym kit) answered 404, 15 of 15,
  // while the same feed's retail rows opened (2026-10-25).
  const tags: string[] = Array.isArray(p.tags) ? p.tags.map(String) : typeof p.tags === "string" ? p.tags.split(",") : [];
  if (tags.some((t) => /(^|[-_\s])b2b($|[-_\s])/i.test(t.trim()))) return null;
  const priced = vs
    .map((v) => ({ v, price: parseFloat(v.price), cmp: parseFloat(v.compare_at_price) }))
    .filter((x) => Number.isFinite(x.price) && x.price > 0 && x.price < MAX_PRICE);
  if (!priced.length) return null;
  const pick = [...priced].sort((a, b) => Number(b.v.available) - Number(a.v.available) || a.price - b.price)[0];
  // Nordic stores name their options in Danish / Swedish / Norwegian / Finnish (2026-11-10).
  const sizeKey = optionKey(p, /beden|size|numara|\bfit\b|st[øo]rrelse|storlek|koko/i);
  const colourKey = optionKey(p, /renk|colou?r|shade|farve|f[äa]rg|farge|väri/i);
  const seen = new Set<string>();
  const sizes: SizeVariant[] = [];
  if (sizeKey) {
    for (const v of vs) {
      const label = String(v?.[sizeKey] ?? "").trim();
      if (!label || /default title/i.test(label) || seen.has(label)) continue;
      seen.add(label);
      sizes.push({ label, availability: v.available ? "in_stock" : "out_of_stock" });
    }
  }
  const colors = colourKey ? [...new Set(vs.map((v) => String(v?.[colourKey] ?? "").trim()).filter(Boolean))] : [];
  const imgs: string[] = (p.images ?? []).map((im: any) => im?.src).filter((u: unknown) => typeof u === "string");
  const type = typeof p.product_type === "string" ? p.product_type.split(">").pop()!.trim() : "";
  const vendor = typeof p.vendor === "string" ? p.vendor.trim() : "";
  const title = String(p.title).trim();
  return {
    brand: store.brand,
    country,
    externalId: String(p.id),
    name: store.vendorInName && vendor && !title.toLowerCase().includes(vendor.toLowerCase()) ? `${vendor} ${title}` : title,
    ...(store.vendorAsMaker && vendor ? { maker: vendor } : {}),
    url: `${site}/products/${p.handle}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(pick.price),
    listPrice: Number.isFinite(pick.cmp) && pick.cmp > pick.price ? toMinor(pick.cmp) : null,
    currency: COUNTRIES[country].currency,
    inStock: vs.some((v) => v.available === true),
    category: type || null,
    ...(store.vendorIsMaker && typeof p.vendor === "string" && p.vendor.trim() ? { maker: p.vendor.trim() } : {}),
    ...(store.makerFromVendor && typeof p.vendor === "string" && p.vendor.trim() ? { maker: p.vendor.trim() } : {}),
    gender: genderOf(p, store.defaultGender ?? null),
    variants: sizes.length ? { colors, sizes } : null,
    colorName: colors.length === 1 ? colors[0] : null,
  };
}

/**
 * Shopify Markets judges stock by the shopper's country, and GitHub's runners
 * are in the US: a store that ships only inside its own market answers
 * `available: false` for every variant (Universal Store AU, 1,501 of 1,501 sold
 * out on 2026-10-11). The `localization` cookie picks the market explicitly.
 */
export const marketHeaders = (country: CountryCode) => ({
  cookie: `localization=${country}; cart_currency=${COUNTRIES[country].currency}`,
});

/** The feed to walk: one collection when the store names one for this market, else the whole catalogue. */
export function feedUrl(store: ShopifyStore, site: string, country: CountryCode, n: number): string {
  const handle = store.collections?.[country];
  return `${site}${handle ? `/collections/${handle}` : ""}/products.json?limit=${store.pageSize ?? 250}&page=${n}`;
}

async function page(store: ShopifyStore, site: string, n: number, country: CountryCode): Promise<any[] | null> {
  const url = feedUrl(store, site, country, n);
  for (let attempt = 0; attempt < 3; attempt++) {
    const data = await getJson<any>(url, { retries: 0, country, headers: marketHeaders(country) }).catch(() => null);
    if (Array.isArray(data?.products)) return data.products;
    await sleep(4000 * (attempt + 1));
  }
  return null;
}

export async function listShopify(store: ShopifyStore, country: CountryCode): Promise<ProductRecord[]> {
  const site = store.sites[country];
  if (!site) return [];
  const cap = store.maxProducts ?? 1500;
  const byId = new Map<string, ProductRecord>();
  const full = new Map<string, ProductRecord>();
  const seen = new Set<string>();
  for (let n = 1; n <= MAX_PAGES; n++) {
    if (n > 1) await sleep(PAUSE_MS);
    const rows = await page(store, site, n, country);
    if (rows === null) {
      if (byId.size === 0 && n === 1) throw new Error(`${store.brand}/${country}: products.json refused`);
      break;
    }
    if (rows.length === 0) break;
    let fresh = 0;
    for (const p of rows) {
      if (p?.id != null && !seen.has(String(p.id))) { seen.add(String(p.id)); fresh++; }
      const r = mapShopify(store, country, site, p);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
      else if (r && store.fullPriceTopUp && r.inStock && full.size < cap) full.set(r.externalId, r);
    }
    // A short page is not always the last: Shopify drops products hidden from
    // the channel AFTER paging, so a full page can come back 249 of 250
    // (Tuckernuck 2026-11-11: page 1 had 249, the catalogue 3,499, the walk
    // stopped there with 0 deals). Only a page well under the limit, or one
    // that repeats what was already read, ends the walk.
    if (rows.length < (store.pageSize ?? 250) * 0.9 || fresh === 0) break;
    // A sale collection can be thousands deep: stop once the cap is full of in-stock rows.
    if (store.collections?.[country] && [...byId.values()].filter((r) => r.inStock).length >= cap) break;
  }
  const all = [...byId.values()];
  const deals = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
  if (!store.fullPriceTopUp || deals.length >= cap) return deals;
  // Between sales: deals first, then in-stock full-price rows up to the cap.
  return [...deals, ...[...full.values()].filter((r) => !byId.has(r.externalId)).slice(0, cap - deals.length)];
}
