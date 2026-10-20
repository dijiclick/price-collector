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
import { sizedIds, sizesFirst } from "../sizes";
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
/**
 * Turkey's stock pass is bigger (2026-10-20): ~2,000 deals, one call each, and
 * since the size filter hides unsized clothes and shoes, every deal needs a
 * size list. Products with no stored sizes go first (sizes.ts), so ~300 a run
 * (~40 s at 4 in flight from the Hetzner box, every 3 hours) covers the
 * backlog in about a day and then keeps refreshing.
 */
const TR_STOCK_LIMIT = Number(process.env.ADIDAS_TR_STOCK_LIMIT ?? 300);
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

export function listingUrl(country: CountryCode, start: number, refinement?: string): string {
  const base = `${API}/gw/prd/search/url/${ADIDAS_MARKETS[country]!.collection}?start=${start}`;
  return refinement ? `${base}&refinements=${encodeURIComponent(refinement)}` : base;
}

/**
 * One pass over the outlet narrowed by adidas's OWN filter, and what that
 * filter tells us about every product it returns (2026-10-18).
 *
 * The listing carries no product type and often no gender: the subtitle is
 * just "Originals" for most rows, and names like "MERCEDES - AMG PETRONAS
 * FORMULA ONE TEAM" say nothing — so caps were filed as shoes, and men's items
 * had no gender and slipped into the women's default feed. adidas's filters
 * (Cinsiyet, Ürün Kategorisi) know both, so the outlet is read per gender and
 * the small accessories list once more, and each row keeps what its list says.
 */
export interface Sweep {
  /** `refinement_id:value`, as the filter's own APPLY path names it. */
  refinement: string;
  gender?: ProductRecord["gender"];
  /** A category hint the type classifier reads first ("Aksesuar"). */
  category?: string;
  pages: number;
}

const GENDER_OF: Record<string, ProductRecord["gender"]> = { women: "kadin", men: "erkek", kids: "cocuk", unisex: null };
/** The page budget per gender, women first: the app's default audience. */
const GENDER_SHARE: Record<string, number> = { women: 0.45, men: 0.3, kids: 0.15, unisex: 0.1 };

/**
 * adidas files one cap under Kadın AND Erkek. On both (or on unisex) it is for
 * everyone → null, which the women's default feed still shows; on one list it
 * is that gender. Exported for its test.
 */
export function settleGender(seen: Set<string>): ProductRecord["gender"] {
  const adult = (["kadin", "erkek"] as const).filter((g) => seen.has(g));
  if (adult.length === 2 || seen.has("unisex")) return null;
  if (adult.length === 1) return adult[0];
  return seen.has("cocuk") ? "cocuk" : null;
}

/** Exported for its test. Plans the sweeps from page 0's refinements; [] = fall back to one plain pass. */
export function planSweeps(refinements: any[], maxPages: number): Sweep[] {
  const out: Sweep[] = [];
  const valueOf = (v: any): string | null => {
    const path = String(v?.action?.path ?? "");
    const m = path.match(/refinements=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  };
  const gender = refinements.find((r) => /age_gender|gender/.test(String(r?.refinement_id ?? "")));
  for (const v of gender?.values ?? []) {
    const key = String(v?.non_localized_value ?? "");
    const ref = valueOf(v);
    if (!ref || !(key in GENDER_OF)) continue;
    const need = Math.ceil(Number(v?.count ?? 0) / PAGE_SIZE);
    out.push({ refinement: ref, gender: GENDER_OF[key], pages: Math.max(1, Math.min(need, Math.round(maxPages * GENDER_SHARE[key]))) });
  }
  const division = refinements.find((r) => /^division/.test(String(r?.refinement_id ?? "")));
  const acc = (division?.values ?? []).find((v: any) => v?.non_localized_value === "accessories");
  const accRef = acc ? valueOf(acc) : null;
  if (accRef) out.push({ refinement: accRef, category: "Aksesuar", pages: Math.min(4, Math.max(1, Math.ceil(Number(acc.count ?? 0) / PAGE_SIZE))) });
  return out;
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

/**
 * The shelf price of an unreduced product: its ORIGINAL line (a member/club
 * line is never read, as above). Only the Turkish full-catalogue walk uses it.
 */
function fullPriceOf(p: any): number | null {
  const info: any[] = Array.isArray(p?.pricing?.info) ? p.pricing.info : [];
  const was = Number(info.find((i) => i?.type === "ORIGINAL")?.value ?? p?.original_price);
  return Number.isFinite(was) && was > 0 ? was : null;
}

/**
 * Map one listing product. Pure. Null unless it is genuinely reduced — or, with
 * `full` (Turkey's full catalogue), an unreduced product at its ORIGINAL price
 * with `listPrice: null`. Reduced rows are mapped identically either way.
 */
export function mapAdidas(p: any, country: CountryCode, full = false): ProductRecord | null {
  const m = ADIDAS_MARKETS[country];
  if (!m || !p?.product_id || !p?.product_name) return null;
  const sale = pricesOf(p);
  const shelf = sale ? null : full ? fullPriceOf(p) : null;
  if (!sale && shelf == null) return null;
  const pr = sale ?? { price: shelf!, was: null };
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
    listPrice: pr.was != null ? toMinor(pr.was) : null,
    currency: typeof p.display_currency === "string" ? p.display_currency : COUNTRIES[country].currency,
    // The listing only shows products the shop can sell; the stock pass refines it.
    inStock: true,
    // The subtitle is "<gender> <line>" (Originals/Performance/TERREX) — not a
    // product type; the type classifier reads the name ("… Shoes", "… Pants").
    // listAdidas fills it with "Aksesuar" for ids on adidas's accessories list.
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
  if (country === "TR") return listAdidasTrCatalogue();
  const headers = appHeaders(country);
  const byId = new Map<string, ProductRecord>();
  /** Every gender list each id appeared on; settled after every pass (`settleGender`). */
  const gendersOf = new Map<string, Set<NonNullable<ProductRecord["gender"]> | "unisex">>();
  const categoryOf = new Map<string, string>();

  /** One listing pass; `sweep` narrows it to one of adidas's own filters. */
  const pass = async (sweep: Sweep | null, maxPages: number, first?: any) => {
    let total = Infinity;
    for (let page = 0; page < maxPages && page * PAGE_SIZE < total; page++) {
      const data = page === 0 && first ? first : await getJson<any>(listingUrl(country, page * PAGE_SIZE, sweep?.refinement), { headers, country });
      total = Number(data?.total ?? 0);
      const products: any[] = data?._embedded?.products ?? [];
      for (const p of products) {
        const r = mapAdidas(p, country);
        if (!r) continue;
        if (!byId.has(r.externalId)) byId.set(r.externalId, r);
        if (sweep && "gender" in sweep) {
          const seen = gendersOf.get(r.externalId) ?? new Set();
          seen.add(sweep.gender ?? "unisex");
          gendersOf.set(r.externalId, seen);
        }
        if (sweep?.category) categoryOf.set(r.externalId, sweep.category);
      }
      // A page can come back one short (AU page 2: 47) — only an empty page or a
      // missing `next` link ends the listing.
      if (products.length === 0 || !data?._links?.next) break;
      if (byId.size >= CAP) break;
    }
  };

  const first = await getJson<any>(listingUrl(country, 0), { headers, country });
  if (first?.collection_match === false) {
    throw new Error(`adidas/${country}: "${ADIDAS_MARKETS[country]!.collection}" is no longer a collection`);
  }
  const sweeps = planSweeps(Array.isArray(first?.refinements) ? first.refinements : [], MAX_PAGES);
  if (sweeps.length === 0) {
    // No filters on offer (an older or reshaped API): the plain pass, as before.
    await pass(null, MAX_PAGES, first);
  } else {
    for (const sw of sweeps) {
      if (byId.size >= CAP && !sw.category) continue;
      await pass(sw, sw.pages);
    }
  }
  for (const [id, r] of byId) {
    const seen = gendersOf.get(id);
    if (seen) r.gender = settleGender(seen);
    const cat = categoryOf.get(id);
    if (cat) r.category = cat;
  }
  if (byId.size === 0) throw new Error(`adidas/${country}: no discounted products`);

  // Stock pass: a random subset each run; the upsert keeps earlier runs' sizes.
  const ids = [...byId.keys()];
  for (let j = ids.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [ids[j], ids[k]] = [ids[k], ids[j]];
  }
  await pool(sizesFirst(ids, (id) => id, await sizedIds(brand, country), STOCK_LIMIT), 4, async (id) => {
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

/**
 * TURKEY: the FULL in-stock catalogue (2026-10-19), reduced rows exactly as the
 * outlet walk maps them, the rest at their ORIGINAL price with `listPrice: null`.
 *
 * `all` is not a collection (collection_match false) but the app's search for
 * it lists the whole Turkish shop: its total equals the sum of its own
 * Ürün Kategorisi counts (7,585 = 4,134 giyim + 2,816 ayakkabı + 635 aksesuar
 * on 10-19), and that equality is checked every run, so a reshaped search
 * cannot pass for the catalogue. One plain pass over it is the completeness
 * walk (~160 pages of 48); the gender lists (~200 pages) and the accessories
 * list (~14) only label what it found, as the outlet sweeps do. Any failed
 * page throws (getJson), and so does a walk more than 1% short of the total.
 * ~390 requests, at most two in flight: about 3 minutes from Turkey, on the
 * Hetzner box like every adidas market (Akamai refuses GitHub's runners).
 */
const TR_FULL = "all";
const TR_MAX_PAGES = Number(process.env.ADIDAS_TR_MAX_PAGES ?? 400);

export async function listAdidasTrCatalogue(): Promise<ProductRecord[]> {
  const country: CountryCode = "TR";
  const headers = appHeaders(country);
  const url = (start: number, refinement?: string) => {
    const base = `${API}/gw/prd/search/url/${TR_FULL}?start=${start}`;
    return refinement ? `${base}&refinements=${encodeURIComponent(refinement)}` : base;
  };
  const byId = new Map<string, ProductRecord>();
  const gendersOf = new Map<string, Set<NonNullable<ProductRecord["gender"]> | "unisex">>();
  const accessories = new Set<string>();

  /** Every page of one list; returns the ids it listed. Throws on any failed page. */
  const walk = async (refinement: string | undefined, first?: any): Promise<string[]> => {
    const ids: string[] = [];
    let total = Infinity;
    for (let page = 0; page * PAGE_SIZE < total; page++) {
      if (page >= TR_MAX_PAGES) throw new Error(`adidas/TR: ${refinement ?? TR_FULL} is over ${TR_MAX_PAGES} pages — partial catalogue refused`);
      const data = page === 0 && first ? first : await getJson<any>(url(page * PAGE_SIZE, refinement), { headers, country });
      total = Number(data?.total ?? 0);
      const products: any[] = data?._embedded?.products ?? [];
      for (const p of products) {
        if (p?.product_id) ids.push(String(p.product_id));
        if (refinement) continue; // the labelling passes add no products
        const r = mapAdidas(p, country, true);
        if (r) byId.set(r.externalId, r);
      }
      if (products.length === 0 || !data?._links?.next) break;
    }
    return ids;
  };

  const first = await getJson<any>(url(0), { headers, country });
  const total = Number(first?.total ?? 0);
  const refinements: any[] = Array.isArray(first?.refinements) ? first.refinements : [];
  const division = refinements.find((r) => /^division/.test(String(r?.refinement_id ?? "")));
  const divisionSum = (division?.values ?? []).reduce((n: number, v: any) => n + (Number(v?.count) || 0), 0);
  if (!(total > 0) || divisionSum !== total) {
    throw new Error(`adidas/TR: "${TR_FULL}" lists ${total}, its categories ${divisionSum} — no longer the whole catalogue`);
  }
  const seen = new Set(await walk(undefined, first));
  if (seen.size < total * 0.99) throw new Error(`adidas/TR: walk saw ${seen.size} of ${total} products — partial catalogue refused`);

  // Labels from adidas's own filters (see Sweep / settleGender).
  const gender = refinements.find((r) => /age_gender|gender/.test(String(r?.refinement_id ?? "")));
  const valueOf = (v: any): string | null => {
    const m = String(v?.action?.path ?? "").match(/refinements=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  };
  const labels: { ref: string; apply: (id: string) => void }[] = [];
  for (const v of gender?.values ?? []) {
    const key = String(v?.non_localized_value ?? "");
    const ref = valueOf(v);
    if (!ref || !(key in GENDER_OF)) continue;
    labels.push({
      ref,
      apply: (id) => {
        const set = gendersOf.get(id) ?? new Set();
        set.add(GENDER_OF[key] ?? "unisex");
        gendersOf.set(id, set);
      },
    });
  }
  const acc = (division?.values ?? []).find((v: any) => v?.non_localized_value === "accessories");
  const accRef = acc ? valueOf(acc) : null;
  if (accRef) labels.push({ ref: accRef, apply: (id) => accessories.add(id) });
  // Two lists at a time (each one serial): ~3 minutes in all instead of ~5.
  await pool(labels, 2, async (l) => {
    for (const id of await walk(l.ref)) l.apply(id);
  });
  for (const [id, r] of byId) {
    const g = gendersOf.get(id);
    if (g) r.gender = settleGender(g);
    if (accessories.has(id)) r.category = "Aksesuar";
  }

  // Stock pass: unsized products first, then a random subset, deals first; the upsert keeps earlier runs' sizes.
  const shuffle = <T>(a: T[]) => {
    for (let j = a.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [a[j], a[k]] = [a[k], a[j]];
    }
    return a;
  };
  const all = [...byId.values()];
  const queue = [...shuffle(all.filter((r) => r.listPrice != null)), ...shuffle(all.filter((r) => r.listPrice == null))];
  await pool(sizesFirst(queue, (r) => r.externalId, await sizedIds(brand, country), TR_STOCK_LIMIT), 4, async (r) => {
    const stock = await getJson<any>(`${API}/gw/stc/inline/products/${r.externalId}/stock`, { headers, country, retries: 1 }).catch(() => null);
    const sizes = sizesOf(stock);
    if (!sizes.length) return;
    r.variants = { colors: r.colorName ? [r.colorName] : [], sizes };
    r.inStock = sizes.some((s) => s.availability !== "out_of_stock");
  });
  return all;
}
