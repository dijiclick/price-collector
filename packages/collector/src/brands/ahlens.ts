/**
 * Åhléns (SE) — the "Rea" pages for women, men, beauty and kids through the
 * Voyado Elevate storefront API the site's Next.js client calls (cluster
 * `w3439ecd3`, market SE, locale sv-SE — public constants in the `_app`
 * bundle, 2026-10-21).
 *
 * No key, no cookie, no proxy: the cluster answers a plain POST with random
 * customer/session keys. The home-goods sale (/rea/inredning) is left out.
 * `sort=DISCOUNT` puts reduced rows first; a rea page also carries some
 * full-price colours of a reduced style, which the mapper drops. Every reduced
 * row measured was tagged `custom.sale_price_type = clearance` with
 * `historical_price` equal to the struck list price — the shop's own markdown.
 * A section with no sale left (beauty, 2026-10-23) is skipped, not fatal.
 * One page (100 groups) carries each colour's sizes with per-size stock and
 * price, so no detail calls.
 *
 * Between sales the rea pages thin out (/rea/dam 2 hits, 2026-10-28) and the
 * count fell run after run, so the stale-row sweep never judged a run complete
 * and last sale's delisted rows stayed live as 404s. Markdowns come first; the
 * rest of the cap is topped up with in-stock full-price rows (listPrice null)
 * from the department pages, as Gullfunn and COS do.
 */
import { randomUUID } from "node:crypto";
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const API = "https://w3439ecd3.api.esales.apptus.cloud/api/storefront/v3/queries/landing-page";
const SITE = "https://www.ahlens.se";
const PAGE = 100;
const CAP = 1500;
const MAX_REQUESTS = 40;
const PAUSE_MS = Number(process.env.AHLENS_PAUSE_MS ?? 700);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const AHLENS_SECTIONS: { ref: string; gender: ProductRecord["gender"] }[] = [
  { ref: "/rea/dam", gender: "kadin" },
  { ref: "/rea/herr", gender: "erkek" },
  { ref: "/rea/skonhet", gender: null },
  { ref: "/rea/barn", gender: "cocuk" },
];

/** Department pages for the full-price top-up (/dam 30k hits, /herr 6.9k, 2026-10-28). */
export const AHLENS_FULL: { ref: string; gender: ProductRecord["gender"] }[] = [
  { ref: "/dam", gender: "kadin" },
  { ref: "/herr", gender: "erkek" },
  { ref: "/skonhet", gender: null },
  { ref: "/barn", gender: "cocuk" },
];

export function ahlensUrl(
  ref: string,
  skip: number,
  keys: { customer: string; session: string },
  sort: string | null = "DISCOUNT",
): string {
  const q = new URLSearchParams({
    market: "SE",
    locale: "sv-SE",
    customerKey: keys.customer,
    sessionKey: keys.session,
    touchpoint: "desktop",
    pageReference: ref,
    ...(sort ? { sort } : {}),
    limit: String(PAGE),
    skip: String(skip),
  });
  return `${API}?${q}`;
}

const n = (x: unknown): number => (typeof x === "number" ? x : parseFloat(String(x ?? "")));

function sizesOf(variants: any[]): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const v of variants) {
    const label = String(v?.label ?? v?.size ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const stock = n(v?.stockNumber);
    out.push({
      label,
      availability: !v?.inStock ? "out_of_stock" : Number.isFinite(stock) && stock > 0 && stock <= 2 ? "low_on_stock" : "in_stock",
    });
  }
  return out;
}

/** Map one Elevate product (a colour of a product group). Pure. */
export function mapAhlens(p: any, gender: ProductRecord["gender"], groupKey: string | null, country: CountryCode = "SE"): ProductRecord | null {
  const title = String(p?.title ?? "").trim();
  const link = typeof p?.link === "string" ? p.link : null;
  if (!p?.key || !title || !link) return null;
  const vs: any[] = Array.isArray(p.variants) ? p.variants : [];
  // The cheapest size still sold, with THAT size's own list price (never a range).
  const priced = vs
    .map((v) => ({ v, price: n(v?.sellingPrice), list: n(v?.listPrice) }))
    .filter((x) => Number.isFinite(x.price) && x.price > 0);
  const pick =
    [...priced].sort((a, b) => Number(!!b.v.inStock) - Number(!!a.v.inStock) || a.price - b.price)[0] ??
    (n(p?.sellingPrice?.min) === n(p?.sellingPrice?.max) && n(p?.listPrice?.min) === n(p?.listPrice?.max)
      ? { price: n(p?.sellingPrice?.min), list: n(p?.listPrice?.min) }
      : null);
  if (!pick || !Number.isFinite(pick.price) || pick.price <= 0) return null;
  const imgs: string[] = (p?.imageInfo?.images ?? [])
    .map((im: any) => {
      const s: any[] = im?.sources ?? [];
      return s[s.length - 1]?.url;
    })
    .filter((u: unknown): u is string => typeof u === "string")
    .map((u: string) => u.replace(/ /g, "%20"));
  const brand = typeof p.brand === "string" ? p.brand.trim() : "";
  // Titles often carry the brand already ("Slim fit-jeans DNM7 03").
  const name = brand && !title.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${title}` : title;
  const sizes = sizesOf(vs);
  const badges: any[] = p?.badges?.primary ?? [];
  const color = badges.find((b) => b?.attribute === "custom.color_description")?.label;
  return {
    brand: "ahlens",
    country,
    externalId: String(p.key),
    name,
    url: `${SITE}${link.split("?")[0]}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(pick.price),
    listPrice: Number.isFinite(pick.list) && pick.list > pick.price ? toMinor(pick.list) : null,
    currency: COUNTRIES[country].currency,
    inStock: p.inStock === true || vs.some((v) => v?.inStock === true),
    maker: brand || null,
    gender,
    variants: sizes.length ? { colors: typeof color === "string" ? [color] : [], sizes } : null,
    groupKey,
    colorName: typeof color === "string" ? color : null,
  };
}

export async function listAhlens(country: CountryCode, cap = CAP): Promise<ProductRecord[]> {
  if (country !== "SE") return [];
  const keys = { customer: randomUUID(), session: randomUUID() };
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  const page = async (ref: string, skip: number, sort: string | null) => {
    if (requests >= MAX_REQUESTS) throw new Error(`ahlens/${country}: request cap hit at ${byId.size} rows`);
    if (requests > 0) await sleep(PAUSE_MS);
    requests++;
    const d = await getJson<any>(ahlensUrl(ref, skip, keys, sort), {
      method: "POST",
      body: "{}",
      headers: { "Content-Type": "text/plain;charset=UTF-8", Origin: SITE, Referer: `${SITE}/` },
      country,
    });
    const list = d?.primaryList;
    if (!list) throw new Error(`ahlens/${country}: ${ref} returned no product list`);
    return { groups: (list.productGroups ?? []) as any[], total: Number(list.totalHits ?? 0) };
  };
  const rowsOf = function* (groups: any[], gender: ProductRecord["gender"]) {
    for (const g of groups) {
      const prods: any[] = g?.products ?? [];
      const gk = prods.length > 1 && g?.key ? `ahlens:${g.key}` : null;
      for (const p of prods) {
        const r = mapAhlens(p, gender, gk, country);
        if (r) yield r;
      }
    }
  };
  for (const sec of AHLENS_SECTIONS) {
    for (let skip = 0; byId.size < cap * 1.2; skip += PAGE) {
      const { groups, total } = await page(sec.ref, skip, "DISCOUNT");
      // A section whose sale has ended answers totalHits 0 (/rea/skonhet, 2026-10-23):
      // skip it; the full-price top-up below covers an all-empty sale.
      if (skip === 0 && !groups.length) break;
      let reduced = 0;
      for (const r of rowsOf(groups, sec.gender)) {
        if (r.listPrice == null) continue;
        reduced++;
        if (!byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      // Sorted by discount: a page with no reduction means this section's sale is exhausted.
      if (!groups.length || reduced === 0 || skip + PAGE >= total) break;
    }
  }
  const deals = [...byId.values()];
  const ordered = [...deals.filter((r) => r.inStock), ...deals.filter((r) => !r.inStock)].slice(0, cap);
  // Top up with in-stock full-price rows, an even share per department.
  const extra = new Map<string, ProductRecord>();
  for (let i = 0; i < AHLENS_FULL.length && ordered.length + extra.size < cap; i++) {
    const sec = AHLENS_FULL[i];
    const goal = Math.min(cap, ordered.length + extra.size + Math.ceil((cap - ordered.length - extra.size) / (AHLENS_FULL.length - i)));
    for (let skip = 0; ordered.length + extra.size < goal; skip += PAGE) {
      const { groups, total } = await page(sec.ref, skip, null);
      for (const r of rowsOf(groups, sec.gender)) {
        if (ordered.length + extra.size >= goal) break;
        if (r.inStock && !byId.has(r.externalId) && !extra.has(r.externalId)) extra.set(r.externalId, r);
      }
      if (!groups.length || skip + PAGE >= total) break;
    }
  }
  if (!ordered.length && !extra.size) throw new Error(`ahlens/${country}: every rea and department page returned no products`);
  return [...ordered, ...extra.values()];
}
