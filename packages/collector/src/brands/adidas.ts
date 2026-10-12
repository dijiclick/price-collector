/**
 * adidas (US, CA, GB, AU, CH, NO, and TR) through the adidas shopping APP's own API,
 * `api.3stripes.net` — not the website.
 *
 * Every adidas web host sits behind Akamai: adidas.com's /api/plp/content-engine
 * and the HTML answer 403 to a plain client, adidas.ca answers 403 even to a
 * Turkish home line (measured 2026-10-12). The app (com.adidas.app 6.16.0,
 * decompiled with jadx) talks to `api.3stripes.net`, and Akamai lets its
 * listing and stock routes through for the app's User-Agent and gateway key.
 * Akamai's mobile sensor header (`X-acf-sensor-data`) is only attached to
 * basket/checkout/order/token routes (class `cd2` in the app), never to search,
 * which is why a plain GET works. Verified from a GitHub runner, all six
 * markets 200 with real products (probe 38228509868), the stock route 200
 * (38230713934) — with a fresh device fingerprint per run (see appUa).
 *
 * - The MARKET is chosen by `Accept-Language` alone (en-US → USD catalogue,
 *   en-CA → CAD, no-NO → NOK …), exactly as the app does.
 * - LISTING: `/gw/prd/search/url/<collection>?start=N`, 48 products a page (the
 *   page size is fixed server-side). The US collection is `sale`; elsewhere
 *   `sale` is only a text search (collection_match false, mostly full price) and
 *   the markdown collection is `outlet`.
 * - The listing only carries in-stock products and lists every size of each,
 *   sold-out sizes included, so per-size stock comes from the app's stock route
 *   (`/gw/stc/inline/products/<id>/stock`, one product a call) for a rotating
 *   random subset each run. The upsert keeps variants an earlier run found, so
 *   coverage accumulates (same scheme as Puma TR / Koton).
 *
 * The gateway key below is the public client key shipped in every copy of the
 * app (assets/general.config.json.enc, XOR'd with a bundled JPEG). It is not a
 * user credential; the app's request-signing secret is deliberately NOT used.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { randomUUID } from "node:crypto";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "adidas";

const API = "https://api.3stripes.net";
const APP_KEY = process.env.ADIDAS_APP_KEY ?? "m79qyapn2kbucuv96ednvh22";
const APP_VERSION = "6.16.0";
/**
 * The app's own User-Agent shape (classes `m73`/`yj5`), sent as both
 * `User-Agent` and `x-device-info`. Akamai passes it where a browser UA gets
 * 403 — but it scores the per-install `fingerprint`: one fingerprint reused for
 * a few hundred requests from several IPs got blocked on runners within the
 * hour (probes 38231022574, 38231071209), while fresh ones passed in the same
 * minute (probe 38231148983). So each run is a fresh install, like a real app.
 */
const MODELS = ["Pixel 8", "Pixel 7a", "SM-S918B", "SM-A546B", "2311DRK48G"];
export function appUa(fingerprint: string = randomUUID(), model = MODELS[Math.floor(Math.random() * MODELS.length)]): string {
  return (
    `app/adidas;os/Android; os-version/34;app-version/${APP_VERSION};buildnumber/61605336;` +
    `type/${model};fingerprint/${fingerprint}`
  );
}

const PAGE_SIZE = 48; // fixed by the API
const MAX_PAGES = Number(process.env.ADIDAS_MAX_PAGES ?? 32); // 1,536 products
const STOCK_LIMIT = Number(process.env.ADIDAS_STOCK_LIMIT ?? 20);
const CAP = 1500;

export const ADIDAS_MARKETS: Partial<Record<CountryCode, { lang: string; collection: string; site: string }>> = {
  US: { lang: "en-US", collection: "sale", site: "https://www.adidas.com/us" },
  CA: { lang: "en-CA", collection: "outlet", site: "https://www.adidas.ca/en" },
  GB: { lang: "en-GB", collection: "outlet", site: "https://www.adidas.co.uk" },
  AU: { lang: "en-AU", collection: "outlet", site: "https://www.adidas.com.au" },
  CH: { lang: "en-CH", collection: "outlet", site: "https://www.adidas.ch/en" },
  // en-NO is refused (400); the Norwegian app runs in Norwegian.
  NO: { lang: "no-NO", collection: "outlet", site: "https://www.adidas.no" },
  // Turkey answers the same way (tr-TR → TRY, outlet ~3,000), direct, no proxy.
  TR: { lang: "tr-TR", collection: "outlet", site: "https://www.adidas.com.tr/tr" },
};

export function appHeaders(country: CountryCode, ua: string = appUa()): Record<string, string> {
  return {
    "User-Agent": ua,
    "x-device-info": ua,
    "X-Api-key": APP_KEY,
    "Accept-Language": ADIDAS_MARKETS[country]!.lang,
    "x-app-info": `platform/Android version/${APP_VERSION}`,
    Accept: "application/json",
  };
}

export function listingUrl(country: CountryCode, start: number): string {
  return `${API}/gw/prd/search/url/${ADIDAS_MARKETS[country]!.collection}?start=${start}`;
}

/** First word of the subtitle ("Women Originals", "Damer TERREX", "Erkek Performance"). */
function genderOf(subtitle: unknown): ProductRecord["gender"] {
  const w = String(subtitle ?? "").trim().split(/\s+/)[0]?.toLocaleLowerCase("tr") ?? "";
  if (/^(women|damer?|kvinner|kadın|kadin)$/.test(w)) return "kadin";
  if (/^(men|menn|herre|erkek)$/.test(w)) return "erkek";
  if (/^(kids|barn|youth|infant|infants|toddler|baby|babies|junior|çocuk|cocuk|genç|bebek)$/.test(w)) return "cocuk";
  return null;
}

/**
 * The strike price, only when it is the real one: a SALE line under an
 * ORIGINAL line. Anything else (an adiClub/member line, a missing original) is
 * not a public markdown and the product is dropped.
 */
function pricesOf(p: any): { price: number; was: number } | null {
  const info: any[] = Array.isArray(p?.pricing?.info) ? p.pricing.info : [];
  if (info.some((i) => /member|club|vip|loyal/i.test(String(i?.type ?? "")))) return null;
  const sale = Number(info.find((i) => i?.type === "SALE")?.value ?? p?.discount_price);
  const was = Number(info.find((i) => i?.type === "ORIGINAL")?.value ?? p?.original_price);
  if (!Number.isFinite(sale) || !Number.isFinite(was) || sale <= 0 || !(sale < was)) return null;
  return { price: sale, was };
}

/** Map one listing product. Pure; null unless it is genuinely reduced. */
export function mapAdidas(p: any, country: CountryCode): ProductRecord | null {
  const m = ADIDAS_MARKETS[country];
  if (!m || !p?.product_id || !p?.product_name) return null;
  const pr = pricesOf(p);
  if (!pr) return null;
  const id = String(p.product_id);
  const img: string | null = p?._embedded?.thumbnail_image?.href ?? null;
  const color = typeof p.color === "string" && p.color.trim() ? p.color.trim() : null;
  return {
    brand,
    ...(country === "TR" ? {} : { country }), // absent = Turkey, as every TR adapter
    externalId: id,
    name: String(p.product_name).trim(),
    url: `${m.site}/-/${id}.html`,
    imageUrl: img,
    images: cleanGallery([img], img),
    price: toMinor(pr.price),
    listPrice: toMinor(pr.was),
    currency: typeof p.display_currency === "string" ? p.display_currency : COUNTRIES[country].currency,
    // The listing only shows products the shop can sell; the stock pass refines it.
    inStock: true,
    // The subtitle is "<gender> <line>" (Originals/Performance/TERREX) — not a
    // product type; the type classifier reads the name ("… Shoes", "… Pants").
    category: null,
    gender: genderOf(p.subtitle),
    variants: null,
    // Colourways of one article share the model number (ONI52 → KI9403, JI4329 …).
    groupKey: p.model_number ? `adidas:${p.model_number}` : null,
    colorName: color,
  };
}

/** Per-size stock from the app's stock route, in the shop's size order. */
export function sizesOf(stock: any): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const s of Array.isArray(stock?.stock) ? stock.stock : []) {
    const label = String(s?.variation ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const st = String(s?.status ?? "");
    out.push({
      label,
      availability: st === "IN_STOCK" ? "in_stock" : st === "LOW_ON_STOCK" ? "low_on_stock" : "out_of_stock",
    });
  }
  return out;
}

async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

export async function listAdidas(country: CountryCode): Promise<ProductRecord[]> {
  if (!ADIDAS_MARKETS[country]) return [];
  const headers = appHeaders(country);
  const byId = new Map<string, ProductRecord>();
  let total = Infinity;
  for (let page = 0; page < MAX_PAGES && page * PAGE_SIZE < total; page++) {
    const data = await getJson<any>(listingUrl(country, page * PAGE_SIZE), { headers, country });
    if (page === 0 && data?.collection_match === false) {
      throw new Error(`adidas/${country}: "${ADIDAS_MARKETS[country]!.collection}" is no longer a collection`);
    }
    total = Number(data?.total ?? 0);
    const products: any[] = data?._embedded?.products ?? [];
    for (const p of products) {
      const r = mapAdidas(p, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    // A page can come back one short (AU page 2: 47) — only an empty page or a
    // missing `next` link ends the listing.
    if (products.length === 0 || !data?._links?.next) break;
    if (byId.size >= CAP) break;
  }
  if (byId.size === 0) throw new Error(`adidas/${country}: no discounted products`);

  // Stock pass: a random subset each run; the upsert keeps earlier runs' sizes.
  const ids = [...byId.keys()];
  for (let j = ids.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [ids[j], ids[k]] = [ids[k], ids[j]];
  }
  await pool(ids.slice(0, STOCK_LIMIT), 4, async (id) => {
    const stock = await getJson<any>(`${API}/gw/stc/inline/products/${id}/stock`, { headers, country, retries: 1 }).catch(() => null);
    const sizes = sizesOf(stock);
    if (!sizes.length) return;
    const r = byId.get(id)!;
    r.variants = { colors: r.colorName ? [r.colorName] : [], sizes };
    r.inStock = sizes.some((s) => s.availability !== "out_of_stock");
  });

  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listAdidas;
