/**
 * H&M in the Gulf (ae.hm.com, sa.hm.com; qa.hm.com, kw.hm.com since 2026-10-21) — franchised to Alshaya, so it is a
 * different shop from www2.hm.com (hm.ts): own prices in AED/SAR, own catalogue.
 * Measured 2026-10-11:
 *
 * - The storefront hosts are behind a Cloudflare block page ("Sorry, you have
 *   been blocked") for GitHub runners and Turkish home lines alike. The data
 *   is not: like the other Alshaya shops (_alshaya.ts) the product lists come
 *   from Algolia, and the AEM Edge Delivery origin
 *   `main--hm-prod-global--alshaya-axp.aem.live/configs.json` publishes the app
 *   id, the search-only key and the index names (`hm_prod_<cc>_product_list`).
 *   The collector only ever talks to `*-dsn.algolia.net`.
 * - The same app also holds the older Drupal indices (`01live_hm<cc>_…`); the
 *   `hm_prod_*` ones are the ones the live PLP config points at and they are
 *   re-indexed through the day.
 * - Only buyable rows are indexed (`stock` 2). `attr_size` lists the sizes on
 *   sale now, so every listed size is in stock. `discount` is the markdown %,
 *   prices are major units in the market's currency. Basket offers ("B2G1")
 *   are not in final_price and are ignored.
 * - The Gulf shop also resells &Brands (Adidas, Hoka, Puma, Crocs…) and
 *   H&M Home. Only H&M and & Other Stories are kept, and Home is dropped.
 * - Women's (incl. Divided) rows are taken first, since the cap is far below a
 *   sale's size (AE: ~7,000 marked-down rows).
 * - Some `media` assets no longer exist on the CDN: media.alshaya.com answers
 *   404 `{"detail":"Item doesn't exist"}`. Measured 2026-10-21: 378 of 6,388
 *   stored Gulf rows (6%) led with a dead photo; on a QA page 42 of 1,000 hits
 *   had a dead first asset (38 of them with a live later one) and 11 more dead
 *   assets sat further down. Nothing in the hit marks them, so each kept row's
 *   photos are probed (HEAD) in order until one is live; that one leads, the
 *   dead ones before it are dropped, and a row with none gets imageUrl null,
 *   which the feed hides. Only the lead is probed — the whole gallery took
 *   ~150 s a market against the 5-minute per-brand ceiling.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson, isLiveImage } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const HM_GULF = {
  appId: "HGR051I5XN",
  apiKey: "a2fdc9d456e5e714d8b654dfe1d8aed8",
  sites: {
    AE: "https://ae.hm.com",
    SA: "https://sa.hm.com",
    QA: "https://qa.hm.com",
    KW: "https://kw.hm.com",
  } as Partial<Record<CountryCode, string>>,
};

const BRANDS = new Set(["H&M", "& Other Stories"]);
const PER_PAGE = 1000;
const MAX_PAGES = 12;
const CAP = Number(process.env.HM_GULF_MAX_PRODUCTS ?? 1500);
const FIELDS = [
  "sku", "title", "url", "final_price", "original_price", "discount", "attr_size", "attr_color",
  "attr_style_code", "attr_presentation_product_type", "attr_product_brand", "field_category", "media", "stock",
].join(",");

const en = (v: any): any => (v && typeof v === "object" && !Array.isArray(v) && "en" in v ? v.en : v);
const VOLUME = /^\s*(\d+\s*(ml|g|oz)|one size|onesize|\d+\s*x\s*\d+)\s*$/i;

/** Every category path the row sits in, e.g. "Sale > Women". */
function catsOf(h: any): string[] {
  return (en(h?.field_category) ?? []).flatMap((c: any) => Object.values(c ?? {}).map(String));
}

export function hmGulfGender(cats: string[]): ProductRecord["gender"] {
  const s = cats.join(" | ");
  if (/\b(kids|baby|girls|boys)\b/i.test(s)) return "cocuk";
  if (/\b(women|divided|ladies)\b/i.test(s)) return "kadin";
  if (/\bmen\b/i.test(s)) return "erkek";
  return null;
}

/** Bigger photos: the index stores the 450px PLP crop; the CDN resizes on request. */
const big = (u: string) => u.replace(/width=450&height=675/, "width=900&height=1350");

/** Map one Algolia hit. Pure. Null for rows to skip (no price, Home, resold brands). */
export function mapHmGulf(country: CountryCode, h: any): ProductRecord | null {
  const site = HM_GULF.sites[country];
  const title = String(en(h?.title) ?? "").replace(/\s+/g, " ").trim();
  const path = en(h?.url);
  const price = Number(en(h?.final_price));
  const orig = Number(en(h?.original_price));
  if (!site || !h?.sku || !title || typeof path !== "string" || !(price > 0)) return null;
  const brand = String(en(h?.attr_product_brand) ?? "H&M").trim() || "H&M";
  if (!BRANDS.has(brand)) return null;
  const cats = catsOf(h);
  if (cats.some((c) => /\bhome\b/i.test(c))) return null;
  const labels: string[] = (en(h?.attr_size) ?? []).map((s: unknown) => String(s).trim()).filter(Boolean);
  const sizes: SizeVariant[] = labels.every((l) => VOLUME.test(l))
    ? []
    : [...new Set(labels)].map((label) => ({ label, availability: "in_stock" as const }));
  const colors: string[] = (en(h?.attr_color) ?? []).map(String).filter(Boolean);
  const imgs: string[] = (h?.media ?? [])
    .filter((m: any) => typeof m?.url === "string" && !/video/i.test(String(m?.image_type ?? "")))
    .map((m: any) => big(m.url as string));
  const style = String(en(h?.attr_style_code) ?? "").trim();
  const type = String(en(h?.attr_presentation_product_type) ?? "").trim();
  return {
    brand: "hm",
    country,
    externalId: String(h.sku),
    name: brand === "H&M" ? title : `${brand} ${title}`,
    url: `${site}${path}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: orig > price ? toMinor(orig) : null,
    currency: COUNTRIES[country].currency,
    inStock: Number(h?.stock ?? 2) !== 0,
    category: type || null,
    gender: hmGulfGender(cats),
    variants: sizes.length || colors.length ? { colors, sizes } : null,
    groupKey: style && style !== String(h.sku) ? `hm:${country}:${style}` : null,
    colorName: colors[0] ?? null,
  };
}

export function hmGulfQuery(country: CountryCode, page: number) {
  const index = `hm_prod_${country.toLowerCase()}_product_list`;
  const params = new URLSearchParams({
    hitsPerPage: String(PER_PAGE),
    page: String(page),
    numericFilters: "discount.en>0",
    attributesToRetrieve: FIELDS,
    attributesToHighlight: "",
  }).toString();
  return {
    url: `https://${HM_GULF.appId.toLowerCase()}-dsn.algolia.net/1/indexes/${index}/query`,
    body: JSON.stringify({ params }),
  };
}

const RANK: Record<string, number> = { kadin: 0, erkek: 2, cocuk: 3 };

export async function listHmGulf(country: CountryCode): Promise<ProductRecord[]> {
  if (!HM_GULF.sites[country]) return [];
  const byId = new Map<string, ProductRecord>();
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await new Promise((r) => setTimeout(r, 800));
    const q = hmGulfQuery(country, page);
    const data = await getJson<any>(q.url, {
      method: "POST",
      body: q.body,
      country,
      headers: {
        "Content-Type": "application/json",
        "X-Algolia-Application-Id": HM_GULF.appId,
        "X-Algolia-API-Key": HM_GULF.apiKey,
      },
    });
    const hits: any[] = data?.hits ?? [];
    for (const h of hits) {
      const r = mapHmGulf(country, h);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
    if (page + 1 >= Number(data?.nbPages ?? 0) || hits.length === 0) break;
  }
  const off = (r: ProductRecord) => (r.listPrice! - r.price) / r.listPrice!;
  const rank = (r: ProductRecord) => RANK[r.gender ?? ""] ?? 1;
  const all = [...byId.values()].sort(
    (a, z) => Number(z.inStock) - Number(a.inStock) || rank(a) - rank(z) || off(z) - off(a),
  );
  return dropDeadImages(all.slice(0, CAP));
}

/** Probe results by URL — the four Gulf shops share most assets, so one run asks once. */
const alive = new Map<string, Promise<boolean>>();
const PROBE_CONCURRENCY = 32;

/** Drop leading photos the CDN no longer has; the first live one becomes imageUrl. Mutates and returns `rows`. */
export async function dropDeadImages(
  rows: ProductRecord[],
  probe: (url: string) => Promise<boolean> = isLiveImage,
): Promise<ProductRecord[]> {
  const check = (u: string) => {
    if (!alive.has(u)) alive.set(u, probe(u));
    return alive.get(u)!;
  };
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const r = rows[next++];
      const urls = r.images ?? (r.imageUrl ? [r.imageUrl] : []);
      let lead = 0;
      while (lead < urls.length && !(await check(urls[lead]))) lead++;
      const rest = urls.slice(lead);
      r.images = rest.length ? rest : null;
      r.imageUrl = rest[0] ?? null;
    }
  };
  await Promise.all(Array.from({ length: PROBE_CONCURRENCY }, worker));
  return rows;
}
