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
  if (/\b(kids?|girls?|boys?|baby|toddler|cocuk|bebek|junior)\b/.test(t)) return "cocuk";
  if (/\b(wom[ae]n'?s?|ladies|female|kadin|feed-gender-female)\b/.test(t)) return "kadin";
  if (/\b(m[ae]n'?s?|male|erkek|feed-gender-male)\b/.test(t)) return "erkek";
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
  const priced = vs
    .map((v) => ({ v, price: parseFloat(v.price), cmp: parseFloat(v.compare_at_price) }))
    .filter((x) => Number.isFinite(x.price) && x.price > 0 && x.price < MAX_PRICE);
  if (!priced.length) return null;
  const pick = [...priced].sort((a, b) => Number(b.v.available) - Number(a.v.available) || a.price - b.price)[0];
  const sizeKey = optionKey(p, /beden|size|numara|\bfit\b/i);
  const colourKey = optionKey(p, /renk|colou?r|shade/i);
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
  return {
    brand: store.brand,
    country,
    externalId: String(p.id),
    name: String(p.title).trim(),
    url: `${site}/products/${p.handle}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(pick.price),
    listPrice: Number.isFinite(pick.cmp) && pick.cmp > pick.price ? toMinor(pick.cmp) : null,
    currency: COUNTRIES[country].currency,
    inStock: vs.some((v) => v.available === true),
    category: type || null,
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

async function page(site: string, n: number, country: CountryCode): Promise<any[] | null> {
  const url = `${site}/products.json?limit=250&page=${n}`;
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
  for (let n = 1; n <= MAX_PAGES; n++) {
    if (n > 1) await sleep(PAUSE_MS);
    const rows = await page(site, n, country);
    if (rows === null) {
      if (byId.size === 0 && n === 1) throw new Error(`${store.brand}/${country}: products.json refused`);
      break;
    }
    if (rows.length === 0) break;
    for (const p of rows) {
      const r = mapShopify(store, country, site, p);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
}
