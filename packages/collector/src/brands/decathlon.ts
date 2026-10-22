/**
 * Decathlon (FR, ES, IT, NL, BE, TR, DE, PT, AT, GB, CH) — the mobile app's own API.
 *
 * Every Decathlon storefront (decathlon.fr, .es, .com.tr, …) answers curl, the
 * Mac and GitHub runners alike with a Cloudflare challenge (`cf-mitigated:
 * challenge`, 2026-10-21) — even robots.txt on most of them. The Android app
 * (com.decathlon.app 10.19.1, pulled with apkeep and read with jadx) talks to
 * one shopping BFF that is not behind that wall:
 *
 *   https://api.shoppingapp.decathlon.com/v1/
 *   headers: x-api-key (the app's public key, base64-split in class qr3),
 *            accept-language = the market's locale (fr-FR, tr-TR, …) — this
 *            alone picks the country's catalogue, prices and currency,
 *            x-mobileapp-os/-version, x-device-id (any uuid; some markets 400
 *            without it).
 *
 * Calls used (all GET, all 200 from a GitHub runner, probe run 39612508691):
 *   - `catalog/home` → the Women/Men category trees (ids differ per market).
 *   - `shop/catalog/categories/{id}/products` → the category's listing path,
 *     its sorts (we take "discountRateDescending") and facets (we take the
 *     "Decathlon" seller facet — the marketplace sellers are left out).
 *   - `<listing path>?Ns=discountRateDescending&size=40&from=N` → 40 cards a
 *     page (40 is the server's cap), deepest discount first; we stop at the
 *     first card without a crossed price.
 *   - `shop/catalog/product-page/{smartId}/variants?storeId=0` → every colour
 *     of the item group with per-size online stock and the product URL — one
 *     call per item group, not per colour, capped at MAX_GROUPS (taken round-
 *     robin over gender × category). Past the cap, FR/ES/IT/TR rows keep a built R-p URL without
 *     sizes; NL/BE/DE/PT/AT rows are dropped (their URLs carry a slug).
 *   About 40 listing pages (~300 KB each) + 300 variant calls (~5 KB) per
 *   market, ~60 s on the Mac.
 *
 * Austria runs an older backend behind the same API: no discount sort, numeric
 * category ids, but each gender has a "SALE" category (apparel only), paged
 * with `page=`. Ireland answers too but gives no product URL (its PrestaShop
 * URLs carry an id the API never returns), so it is not collected. Sweden has
 * no Decathlon web shop; Singapore is not in the app's environments ("No
 * environment found with en-SG").
 *
 * Only real reductions are kept: crossed > current, one price for every size
 * (`isUniform`), and — where the API states the EU 30-day lowest price
 * (`lowestTransparencyValue`, every EU market and TR) — current below it.
 * Only clothing, shoes, swimwear, bags and accessories from the Women and Men
 * trees are walked; bottles, towels and umbrellas are dropped by name.
 */
import { cleanGallery, type Availability, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "decathlon";

const API = "https://api.shoppingapp.decathlon.com/v1/";
/** The app's public BFF key (classes qr3.a + qr3.b), split the same way the app splits it. */
const KEY = Buffer.from("QWk3T0ZKNVdZV2F2U20wdUd4S2o=", "base64").toString() + Buffer.from("NWFDZHNaRjk1OEF3MUh4VzZ4YUE=", "base64").toString();
const APP_VERSION = "10.19.1";

interface Market {
  locale: string;
  currency: string;
  host: string;
  /** Austria: no discount sort, walk the SALE trees instead. */
  saleTree?: boolean;
  /**
   * The site answers `/p/_/R-p-{itemGroupId}?mc={modelId}` (the API's own
   * websiteUrl is that), so a card the variant pass did not reach still gets a
   * working link. NL/BE/DE/PT/AT use slugged URLs only the API knows.
   */
  rpUrl?: boolean;
}
export const MARKETS: Partial<Record<CountryCode, Market>> = {
  FR: { locale: "fr-FR", currency: "EUR", host: "https://www.decathlon.fr", rpUrl: true },
  ES: { locale: "es-ES", currency: "EUR", host: "https://www.decathlon.es", rpUrl: true },
  IT: { locale: "it-IT", currency: "EUR", host: "https://www.decathlon.it", rpUrl: true },
  NL: { locale: "nl-NL", currency: "EUR", host: "https://www.decathlon.nl" },
  // French and Dutch Belgium are one catalogue (same ids and prices); French
  // names classify better (lib/i18n/labels.fr.ts).
  BE: { locale: "fr-BE", currency: "EUR", host: "https://www.decathlon.be" },
  TR: { locale: "tr-TR", currency: "TRY", host: "https://www.decathlon.com.tr", rpUrl: true },
  DE: { locale: "de-DE", currency: "EUR", host: "https://www.decathlon.de" },
  PT: { locale: "pt-PT", currency: "EUR", host: "https://www.decathlon.pt" },
  AT: { locale: "de-AT", currency: "EUR", host: "https://www.decathlon.at", saleTree: true },
  // 2026-10-21: the same BFF answers en-GB and de-CH (runner probe 39653951827,
  // catalog/home 200 for both). GB product URLs are slugged (variants pass
  // only); Switzerland's websiteUrl is the R-p form. German names for CH (the
  // larger language region; fr-CH/it-CH are the same catalogue).
  GB: { locale: "en-GB", currency: "GBP", host: "https://www.decathlon.co.uk" },
  CH: { locale: "de-CH", currency: "CHF", host: "https://www.decathlon.ch", rpUrl: true },
};

const PAGE = 40; // the server's maximum
const MAX_PAGES_PER_CATEGORY = 8;
const MAX_CARDS = 2400; // discounted cards collected before the variant pass
// 150 (was 300): ~190 requests per market per run instead of ~375 — the
// collector runs every ~90 min across 9 markets; be a light client (2026-10-21).
const MAX_GROUPS = 150; // variant calls (one per item group) per market, ~5 KB each
const CONCURRENCY = 4;
const CAP = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A stable pseudo device id per process — the API wants one, never checks it. */
const DEVICE_ID = crypto.randomUUID();

export function appHeaders(locale: string, deviceId = DEVICE_ID): Record<string, string> {
  return {
    "x-api-key": KEY,
    // Same spelling as getJson's default, so this replaces it instead of joining it.
    "Accept-Language": locale,
    "x-mobileapp-os": "android",
    "x-mobileapp-version": APP_VERSION,
    "x-device-id": deviceId,
    "x-mobileapp-deviceid": deviceId,
    "User-Agent": "okhttp/4.12.0",
    Accept: "application/json",
  };
}

/** Lower case, accents off — category titles come in nine languages. */
const fold = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").toLowerCase();

const WOMEN = /\b(femme|mujer|donna|dames|damen|kadin|women|mulher)\b/;
const MEN = /\b(homme|hombre|uomo|heren|herren|erkek|men|homem)\b/;

/** Which gender a home section is, or null (kids, sports, banners). */
export function sectionGender(title: string): "kadin" | "erkek" | null {
  const t = fold(title);
  if (WOMEN.test(t)) return "kadin";
  if (MEN.test(t)) return "erkek";
  return null;
}

const KEEP = /vetement|ropa|abbigliamento|kleding|kledij|bekleidung|giyim|roupa|cloth|chaussure|calzado|scarpe|schoen|schuhe|ayakkab|calcado|shoe|accessoir|accesori|accessori|aksesuar|acessorio|\bsacs?\b|borse|rugzak|maillots? de bain|trajes de bano|costumi|zwemkleding|bademode|swimwear|sportswear|activewear/;
const DROP = /second|segunda|tweedehands|gebrauchte|seconde|outdoor|\bsale\b|descuento|collection|coleccion|collezion|collecti|kollektion|selecti|seleccion|\btop\b|basico|embajador|novedad|new arrival|startpreis/;

/** A Women/Men top category worth walking: apparel, shoes, swim, bags, accessories. */
export const keepCategory = (title: string): boolean => {
  const t = fold(title);
  return KEEP.test(t) && !DROP.test(t);
};
/** Austria's sale category per gender. */
export const saleCategory = (title: string): boolean => /\bsale\b/.test(fold(title));

/** Not fashion even inside an accessories tree. */
const NOT_FASHION = /gourde|borracc|botell|cantimplor|trinkflasch|drinkfles|\bfles(sen)?\b|matara|garraf|bottle|serviette|toalla|\btelo\b|handdoek|handtuch|havlu|towel|toalha|parapluie|paraplu|ombrell|paraguas|regenschirm|semsiye|guarda-chuva|umbrella/;

export interface Card {
  smartId: string;
  modelId: string;
  itemGroupId: string;
  name: string;
  brand: string | null;
  image: string | null;
  price: number; // minor units
  listPrice: number; // minor units
  gender: "kadin" | "erkek";
  category: string;
}

/** One listing card → a discounted card, or null when the reduction is not real. Pure. */
export function mapCard(p: any, m: Market, gender: "kadin" | "erkek", category: string): Card | null {
  if (p?.type && p.type !== "PRODUCT") return null;
  const smartId = String(p?.smartId ?? "");
  const modelId = String(p?.modelId ?? "");
  const itemGroupId = String(p?.itemGroupId ?? "");
  const name = String(p?.name ?? "").replace(/\s+/g, " ").trim();
  if (!smartId || !modelId || !itemGroupId || !name) return null;
  if (NOT_FASHION.test(fold(name))) return null;
  const pr = p?.price ?? {};
  if (pr.currency && pr.currency !== m.currency) return null;
  const now = Number(pr.value);
  const was = Number(pr.crossedValue);
  if (!(now > 0) || !Number.isFinite(was) || !(was > now)) return null;
  // A "from" price across sizes is not a price anyone pays for every size.
  if (pr.isUniform === false) return null;
  // EU price-indication rule: the reduction must be against the 30-day low.
  if (pr.lowestTransparencyValue != null && !(Number(pr.lowestTransparencyValue) > now)) return null;
  const seller = p?.seller?.name;
  if (seller && !/^decathlon$/i.test(String(seller).trim())) return null;
  const img = p?.image?.originalUrl ?? p?.image?.mediumUrl ?? null;
  return {
    smartId, modelId, itemGroupId, name,
    brand: typeof p?.brand?.name === "string" ? p.brand.name : null,
    image: typeof img === "string" && img.startsWith("https://") ? img : null,
    price: toMinor(now),
    listPrice: toMinor(was),
    gender,
    category,
  };
}

const availability = (s: unknown): Availability => {
  const v = String(s ?? "").toUpperCase();
  if (v === "IN_STOCK") return "in_stock";
  if (/LOW|LIMITED|LAST|FEW/.test(v)) return "low_on_stock";
  return "out_of_stock";
};

export interface ModelInfo { url: string | null; sizes: SizeVariant[]; colour: string | null; images: string[]; available: boolean }

/** A variants answer → per model id: URL, per-size online stock, colour, photos. Pure. */
export function modelsOf(v: any): Map<string, ModelInfo> {
  const out = new Map<string, ModelInfo>();
  for (const m of v?.models ?? []) {
    const id = String(m?.modelId ?? "");
    if (!id) continue;
    const sizes = new Map<string, SizeVariant>();
    for (const s of m?.skus ?? []) {
      if (s?.condition && s.condition !== "NEW") continue;
      const label = String(s?.variantPickerInformation?.name ?? "").replace(/\s+/g, " ").trim();
      if (!label) continue;
      const a = availability(s?.onlineAvailabilityStatus);
      const prev = sizes.get(label);
      if (!prev || (prev.availability === "out_of_stock" && a !== "out_of_stock")) sizes.set(label, { label, availability: a });
    }
    const colour = String(m?.variantPickerInformation?.name ?? "").replace(/\s*\/\s*-\s*$/, "").trim() || null;
    const images = (m?.media?.images ?? []).map((i: any) => i?.originalUrl).filter((u: unknown): u is string => typeof u === "string");
    const url = typeof m?.websiteUrl === "string" && /^https:\/\/www\.decathlon\./.test(m.websiteUrl) ? m.websiteUrl : null;
    const list = [...sizes.values()];
    out.set(id, { url, sizes: list, colour, images, available: list.length ? list.some((s) => s.availability !== "out_of_stock") : m?.isAvailable !== false });
  }
  return out;
}

/**
 * Card + its model's variant data → the stored record. Pure.
 *
 * Without variant data (past the variant cap, or a failed call) a row is kept
 * only where its URL can be built (`rpUrl` markets) — in stock as listed, no
 * sizes; elsewhere it is dropped rather than linked to a guess.
 */
export function toRecord(c: Card, info: ModelInfo | undefined, country: CountryCode, m: Market): ProductRecord | null {
  if (!info?.url) {
    if (!m.rpUrl) return null;
    info = { url: `${m.host}/p/_/R-p-${c.itemGroupId}?mc=${c.modelId}`, sizes: [], colour: null, images: [], available: true };
  }
  const imageUrl = c.image ?? info.images[0] ?? null;
  return {
    brand,
    country,
    externalId: c.modelId,
    name: c.name,
    url: info.url,
    imageUrl,
    images: cleanGallery(info.images, imageUrl),
    price: c.price,
    listPrice: c.listPrice,
    currency: m.currency,
    inStock: info.available,
    category: c.category,
    maker: c.brand,
    gender: c.gender,
    variants: info.colour || info.sizes.length ? { colors: info.colour ? [info.colour] : [], sizes: info.sizes } : null,
    groupKey: `decathlon:${c.itemGroupId}`,
    colorName: info.colour,
  };
}

/** Next page of a listing path with the discount sort. */
export function pageUrl(path: string, sortQuery: string, page: number): string {
  const base = path.split("?")[0];
  return `${API}${base.replace(/^\//, "")}?${sortQuery}&size=${PAGE}&from=${page * PAGE}`;
}

/** The "Decathlon" seller facet (marketplace partners left out), or null where there is no marketplace. */
export function sellerPath(listing: any): string | null {
  for (const f of listing?.filters ?? []) {
    for (const v of f?.values ?? []) {
      const u = String(v?.url ?? "");
      if (/\/f-partner_decathlon(?=[/?]|$)/.test(u) && fold(v?.label) === "decathlon") return u.split("?")[0];
    }
  }
  return null;
}

export const discountSort = (listing: any): string | null => {
  const s = (listing?.sorts ?? []).find((x: any) => /discount/i.test(String(x?.url ?? "")));
  return s ? String(s.url).split("?")[1] ?? null : null;
};

/** One item from each list in turn, so no cap trims a whole list away. */
export function roundRobin<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const n = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < n; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}
/** Women and men taken in turn. */
export const interleave = <T>(a: T[], b: T[]): T[] => roundRobin([a, b]);

export async function listDecathlon(country: CountryCode): Promise<ProductRecord[]> {
  const m = MARKETS[country];
  if (!m) return [];
  const headers = appHeaders(m.locale);
  const get = <T = any>(path: string, retries = 2) =>
    getJson<T>(path.startsWith("http") ? path : API + path.replace(/^\//, ""), { headers, country, retries, timeoutMs: 30_000 });

  const home = await get<any>("catalog/home");
  const roots: { id: string; title: string; gender: "kadin" | "erkek" }[] = [];
  for (const s of home?.sections ?? []) {
    const g = sectionGender(String(s?.title ?? ""));
    if (!g || !Array.isArray(s?.categories)) continue;
    for (const c of s.categories) {
      const title = String(c?.title ?? "");
      if (c?.id && (m.saleTree ? saleCategory(title) : keepCategory(title))) roots.push({ id: String(c.id), title, gender: g });
    }
  }
  if (!roots.length) throw new Error(`decathlon/${country}: no Women/Men categories in catalog/home`);
  roots.splice(0, roots.length, ...interleave(roots.filter((r) => r.gender === "kadin"), roots.filter((r) => r.gender === "erkek")));

  const cards = new Map<string, Card>();
  const problems: string[] = [];
  let pages = 0;
  for (const r of roots) {
    if (cards.size >= MAX_CARDS) break;
    const first = await get<any>(`shop/catalog/categories/${encodeURIComponent(r.id)}/products${m.saleTree ? `?size=${PAGE}` : ""}`).catch((e) => {
      problems.push(`${r.title}: ${String(e).slice(0, 80)}`);
      return null;
    });
    pages++;
    if (!first) continue;
    if (m.saleTree) {
      // Austria: the whole SALE tree is reduced apparel; walk its pages.
      let data = first;
      for (let p = 0; data && p < MAX_PAGES_PER_CATEGORY; p++) {
        for (const prod of data.products ?? []) {
          const c = mapCard(prod, m, r.gender, r.title);
          if (c && !cards.has(c.modelId)) cards.set(c.modelId, c);
        }
        const next = data.nextPageUrl;
        if (!next || !(data.products ?? []).length || cards.size >= MAX_CARDS) break;
        await sleep(200);
        data = await get<any>(String(next)).catch(() => null);
        pages++;
      }
      continue;
    }
    const sort = discountSort(first);
    if (!sort) {
      problems.push(`${r.title}: no discount sort`);
      continue;
    }
    const path = sellerPath(first) ?? String(first.currentPageUrl ?? "").split("?")[0];
    if (!path) continue;
    for (let p = 0; p < MAX_PAGES_PER_CATEGORY && cards.size < MAX_CARDS; p++) {
      await sleep(200);
      const data = await get<any>(pageUrl(path, sort, p)).catch((e) => {
        problems.push(`${r.title} p${p}: ${String(e).slice(0, 80)}`);
        return null;
      });
      pages++;
      const prods: any[] = data?.products ?? [];
      if (!prods.length) break;
      for (const prod of prods) {
        const c = mapCard(prod, m, r.gender, r.title);
        if (c && !cards.has(c.modelId)) cards.set(c.modelId, c);
      }
      // Sorted by discount: the first card with no crossed price ends the sale.
      if (prods.some((x) => !(Number(x?.price?.crossedValue) > 0))) break;
      if (prods.length < PAGE) break;
    }
  }
  if (!cards.size) throw new Error(`decathlon/${country}: no discounted cards (${pages} pages; ${problems.slice(0, 3).join("; ")})`);

  // One variants call per item group: URL, per-size stock, colour, photos.
  const groups = new Map<string, Card>();
  for (const c of cards.values()) if (!groups.has(c.itemGroupId)) groups.set(c.itemGroupId, c);
  // Round-robin over (gender, category) so the cap keeps shoes and swimwear,
  // not just the first category's deepest discounts.
  const buckets = new Map<string, Card[]>();
  for (const c of groups.values()) {
    const k = `${c.gender}|${c.category}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(c);
  }
  const todo = roundRobin([...buckets.values()]).slice(0, MAX_GROUPS);
  const info = new Map<string, ModelInfo>();
  let next = 0;
  let failed = 0;
  const worker = async () => {
    while (next < todo.length) {
      const c = todo[next++];
      const v = await get<any>(`shop/catalog/product-page/${encodeURIComponent(c.smartId)}/variants?storeId=0`, 1).catch(() => null);
      if (!v) failed++;
      for (const [id, mi] of modelsOf(v)) info.set(id, mi);
      await sleep(100);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (todo.length && failed === todo.length) throw new Error(`decathlon/${country}: every variants call failed`);

  const rows: ProductRecord[] = [];
  for (const c of cards.values()) {
    const r = toRecord(c, info.get(c.modelId), country, m);
    if (r) rows.push(r);
  }
  const rank = (r: ProductRecord) => (r.gender === "kadin" ? 0 : 1);
  return rows.sort((a, b) => Number(b.inStock) - Number(a.inStock) || rank(a) - rank(b)).slice(0, CAP);
}

export const listProducts = listDecathlon;
