import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

/**
 * Nike Turkey through the public product-feed API nike.com's own web app reads
 * (no key, no cookie). One `threads/v2` page carries price, every size with
 * its live availability, photos and copy, so the whole sale is a handful of
 * requests — no per-product detail call.
 *
 * Filters, measured 2026-10-10: `merchPrice.discounted(true)` alone matches
 * ~17k threads, most of them retired (`merchProduct.status` INACTIVE) colourways
 * the site no longer sells. Adding `status(ACTIVE)` brings it to ~226, which
 * lines up with the ~182 cards on nike.com/tr/w/seri-sonu (the web wall groups
 * a few colourways per card). Sold-out actives are kept on purpose: they are
 * exactly the rows a size restock will light up.
 */
const API = "https://api.nike.com/product_feed/threads/v2/";
const CHANNEL = "d9a5bc42-4b9c-4976-858a-f159cf99c647"; // Nike.com consumer channel
const PAGE = 50;
const MAX_PAGES = Number(process.env.NIKE_MAX_PAGES ?? 40); // 2,000 products

/**
 * Markets, 2026-10-11. The feed answers any marketplace without a key; the
 * language decides how much it returns — `en` gives GB/CA/AU nothing, `en-GB`
 * gives the most (measured: US 10,834 sale threads, NO 2,427, GB 2,626, CH
 * 2,378, AU 91, CA 10). AE/SA answer too, but nike.ae/nike.sa are separate
 * franchise shops, so a nike.com url there would not be the shop's price.
 */
export const NIKE_MARKETS: Partial<Record<CountryCode, { language: string; site: string }>> = {
  TR: { language: "tr", site: "https://www.nike.com/tr" },
  US: { language: "en", site: "https://www.nike.com" },
  GB: { language: "en-GB", site: "https://www.nike.com/gb" },
  CA: { language: "en-GB", site: "https://www.nike.com/ca" },
  AU: { language: "en-GB", site: "https://www.nike.com/au" },
  CH: { language: "en-GB", site: "https://www.nike.com/ch" },
  NO: { language: "en-GB", site: "https://www.nike.com/no" },
};

export function threadsUrl(extra: string[], anchor = 0, count = PAGE, country: CountryCode = "TR"): string {
  const m = NIKE_MARKETS[country] ?? NIKE_MARKETS.TR!;
  const base = [`marketplace(${country})`, `language(${m.language})`, `channelId(${CHANNEL})`, "exclusiveAccess(true,false)"];
  const f = [...base, ...extra].map((x) => `filter=${encodeURIComponent(x)}`).join("&");
  return `${API}?${f}&anchor=${anchor}&count=${count}`;
}

function genderOf(genders: unknown): ProductRecord["gender"] {
  const g = Array.isArray(genders) ? genders.map(String) : [];
  if (g.length === 0) return null;
  if (g.every((x) => x === "BOYS" || x === "GIRLS")) return "cocuk";
  const men = g.includes("MEN");
  const women = g.includes("WOMEN");
  if (women && !men) return "kadin";
  if (men && !women) return "erkek";
  return null; // unisex
}

/** Sizes in the order Nike lists them, each with its live availability. */
export function sizesOf(info: any, country: CountryCode = "TR"): SizeVariant[] {
  const avail = new Map<string, any>();
  for (const a of info?.availableSkus ?? []) if (a?.skuId) avail.set(String(a.skuId), a);
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const s of info?.skus ?? []) {
    const spec = (s?.countrySpecifications ?? []).find((c: any) => c?.country === country) ?? s?.countrySpecifications?.[0];
    const label = String(spec?.localizedSize ?? s?.nikeSize ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const a = avail.get(String(s.id));
    const availability: SizeVariant["availability"] = !a?.available
      ? "out_of_stock"
      : a.level === "LOW"
        ? "low_on_stock"
        : "in_stock";
    out.push({ label, availability });
  }
  return out;
}

/** Product photos of this colourway, in thread order, videos dropped. */
function photosOf(thread: any): string[] {
  const nodes: any[] = thread?.publishedContent?.nodes?.[0]?.nodes ?? [];
  return nodes
    .filter((n) => n?.subType === "image")
    .map((n) => n?.properties?.squarishURL ?? n?.properties?.portraitURL)
    .filter((u): u is string => typeof u === "string");
}

/** One thread → one record per colourway it carries (in practice exactly one). */
export function mapThread(thread: any, country: CountryCode = "TR"): ProductRecord[] {
  const SITE = (NIKE_MARKETS[country] ?? NIKE_MARKETS.TR!).site;
  const out: ProductRecord[] = [];
  for (const info of thread?.productInfo ?? []) {
    const m = info?.merchProduct;
    const pr = info?.merchPrice;
    const c = info?.productContent ?? {};
    const style = m?.styleColor;
    const price = Number(pr?.currentPrice);
    if (!style || !Number.isFinite(price) || price <= 0) continue;
    const full = Number(pr?.fullPrice ?? pr?.msrp);
    const sizes = sizesOf(info, country);
    const photos = photosOf(thread);
    const card = thread?.publishedContent?.properties?.productCard?.properties;
    const first = card?.squarishURL ?? photos[0] ?? info?.imageUrls?.productImageUrl ?? null;
    const name = String(c.fullTitle ?? [c.title, c.subtitle].filter(Boolean).join(" ") ?? m.labelName ?? "").trim();
    out.push({
      brand: "nike",
      ...(country === "TR" ? {} : { country }),
      externalId: String(style),
      name,
      url: c.slug ? `${SITE}/t/${c.slug}/${style}` : `${SITE}/t/-/${style}`,
      imageUrl: first,
      images: cleanGallery(photos, first),
      price: toMinor(price),
      listPrice: Number.isFinite(full) && full > price ? toMinor(full) : null,
      currency: pr?.currency ?? COUNTRIES[country].currency,
      inStock: sizes.length > 0 ? sizes.some((s) => s.availability !== "out_of_stock") : info?.availability?.available === true,
      // The subtitle is Nike's own product-type line ("Kadın Koşu Ayakkabısı"),
      // which is what the type classifier reads best.
      category: c.subtitle ?? m.productType ?? null,
      gender: genderOf(m.genders),
      variants: sizes.length || c.colorDescription
        ? { colors: c.colorDescription ? [String(c.colorDescription)] : [], sizes }
        : null,
      barcodes: (() => {
        const g = (info?.skus ?? []).map((s: any) => String(s?.gtin ?? "").replace(/^0+(?=\d{13}$)/, "")).filter((x: string) => /^\d{12,14}$/.test(x));
        return g.length ? [...new Set<string>(g)] : null;
      })(),
      // Colourways of one style share the style code (IO3384-012 / -001 …).
      groupKey: m.styleCode ? `nike:${m.styleCode}` : null,
      colorName: c.colorDescription ?? null,
    });
  }
  return out;
}

export const brand = "nike";

/**
 * FULL CATALOGUE, Turkey only (2026-10-19). The thread feed cannot be walked
 * whole: `anchor` past ~1,000 is refused (VALUE_TOO_LARGE) and no filterable
 * field splits ~9.5k ACTIVE threads into pieces that small. The web wall the
 * site itself renders (`discover/product_wall`, path /tr/w) CAN be walked:
 * ~4,975 model groups = ~9,170 colourways, 100 groups a page (50 pages, no
 * anchor cap). Its rows carry price but no sizes, so the colour codes are then
 * fetched from the thread feed 100 at a time by `styleColor(...)` — the same
 * threads and the same mapper as before, so sizes/photos/barcodes are as good
 * as the sale walk's. The old deals filter (discounted + ACTIVE, ~175) is still
 * walked first and kept as-is, so every deal row is exactly what it was.
 *
 * Every gap THROWS (a page error, a wall short of its own total by >1%, a
 * thread batch missing >1% of its codes, a cap): the run's sweep would mark
 * anything unseen as sold out.
 */
const WALL = "https://api.nike.com/discover/product_wall/v1/marketplace/TR/language/tr/consumerChannelId/" + CHANNEL;
const WALL_CALLER = "com.nike.commerce.nikedotcom.web";
const WALL_PAGE = 100;
const WALL_MAX_PAGES = Number(process.env.NIKE_WALL_MAX_PAGES ?? 150); // 15,000 model groups
const THREAD_BATCH = 100;
const FULL_MAX_PRODUCTS = Number(process.env.NIKE_FULL_MAX_PRODUCTS ?? 30000);

/** Colour codes (`IV6028-100`) on one wall page, in wall order. Pure. */
export function wallCodes(page: any): string[] {
  const out: string[] = [];
  for (const g of page?.productGroupings ?? []) for (const p of g?.products ?? []) if (typeof p?.productCode === "string" && p.productCode) out.push(p.productCode);
  return out;
}

async function listNikeTrFull(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  // 1. The deals walk, unchanged (sold-out ACTIVE deals included, as before).
  const dealFilters = ["productInfo.merchPrice.discounted(true)", "productInfo.merchProduct.status(ACTIVE)"];
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) throw new Error(`nike: deals walk over ${MAX_PAGES} pages`);
    const data = await getJson<any>(threadsUrl(dealFilters, page * PAGE, PAGE, "TR"), { proxy: true, retries: 2 });
    const objects: any[] = data?.objects ?? [];
    for (const t of objects) for (const r of mapThread(t, "TR")) byId.set(r.externalId, r);
    if (objects.length < PAGE || !data?.pages?.next) break;
  }
  // 2. Every colour code on the site's own wall.
  const codes = new Set<string>();
  let groups = 0;
  let total = 0;
  for (let page = 0; ; page++) {
    if (page >= WALL_MAX_PAGES) throw new Error(`nike: wall over ${WALL_MAX_PAGES} pages — raise NIKE_WALL_MAX_PAGES`);
    const j = await getJson<any>(`${WALL}?path=/tr/w&queryType=PRODUCTS&anchor=${page * WALL_PAGE}&count=${WALL_PAGE}`, {
      // A runner without it gets 400 NIKE_API_CALLER_ID_HEADER_NOT_PRESENT (probe 39313619256).
      headers: { "nike-api-caller-id": WALL_CALLER },
      proxy: true,
      retries: 2,
    });
    total = Number(j?.pages?.totalResources ?? 0);
    const g: any[] = j?.productGroupings ?? [];
    groups += g.length;
    for (const c of wallCodes(j)) codes.add(c);
    if (!g.length || !j?.pages?.next) break;
  }
  // The wall's own count runs a few groups above what it pages out (4,948 of 4,975 on 10-19).
  if (!total || groups < total * 0.99) throw new Error(`nike: wall paged ${groups} of ${total} groups`);
  if (codes.size > FULL_MAX_PRODUCTS) throw new Error(`nike: ${codes.size} colourways, over the cap of ${FULL_MAX_PRODUCTS}`);
  // 3. Thread detail for every code not already in hand, 100 per call.
  const todo = [...codes].filter((c) => !byId.has(c));
  let missing = 0;
  for (let i = 0; i < todo.length; i += THREAD_BATCH) {
    const chunk = todo.slice(i, i + THREAD_BATCH);
    const data = await getJson<any>(threadsUrl([`productInfo.merchProduct.styleColor(${chunk.join(",")})`], 0, THREAD_BATCH, "TR"), { proxy: true, retries: 2 });
    const got = new Set<string>();
    for (const t of data?.objects ?? []) for (const r of mapThread(t, "TR")) { byId.set(r.externalId, r); got.add(r.externalId); }
    missing += chunk.filter((c) => !got.has(c)).length;
  }
  if (missing > codes.size * 0.01) throw new Error(`nike: ${missing} of ${codes.size} wall colourways had no thread`);
  return [...byId.values()];
}

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (!NIKE_MARKETS[country]) return [];
  if (country === "TR") return listNikeTrFull();
  const byId = new Map<string, ProductRecord>();
  const filters = ["productInfo.merchPrice.discounted(true)", "productInfo.merchProduct.status(ACTIVE)"];
  for (let page = 0; page < MAX_PAGES; page++) {
    // The proxy is a FALLBACK for Turkey only (after a refused direct call);
    // other markets never touch it — owner rule 2026-10-11.
    const data = await getJson<any>(threadsUrl(filters, page * PAGE, PAGE, country), { proxy: country === "TR" }).catch(() => null);
    const objects: any[] = data?.objects ?? [];
    for (const t of objects) for (const r of mapThread(t, country)) byId.set(r.externalId, r);
    if (objects.length < PAGE || !data?.pages?.next) break;
  }
  return [...byId.values()];
}
