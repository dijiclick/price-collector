/**
 * Luxury multi-brand stores on Shopify Markets (lib/live-brands/lux-sites.ts):
 * THE OUTNET, Browns, END., Julian Fashion, Antonioli, TheDoubleF, Slam Jam,
 * The Webster. One shop serves every market — the tokenless Storefront GraphQL API on the shop's own
 * domain, `@inContext(country:)`, answers each country's own price list and
 * currency (2026-11-10; GitHub runner probe 42797853656: 200 with USD/GBP/EUR/
 * AED/KRW/JPY/CHF rows, no proxy, no token).
 *
 * Sale-first: only the shop's own sale collections are walked (women first,
 * then men), 250 products a page with every variant's price, compare-at price
 * and availability, `available: true` so sold-out styles never use the cap.
 * A row needs a variant priced in the MARKET's currency with a higher
 * compare-at price. `maker` is the designer (Shopify `vendor`), prefixed to
 * the name when the title lacks it. ≤ MAX_REQUESTS requests per market.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { LUX_SITES, luxProductUrl, luxSite, type LuxGender, type LuxSite, type LuxWalk } from "../../../../lib/live-brands/lux-sites";

export const API_VERSION = "2025-01";
const PAGE = 250;
const DEFAULT_CAP = 1300;
const MAX_REQUESTS = Number(process.env.LUX_MAX_REQUESTS ?? 14);
const PAUSE_MS = Number(process.env.LUX_PAUSE_MS ?? 700);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const LUX_QUERY = `query LuxSale($h: String!, $a: String, $cc: CountryCode!) @inContext(country: $cc) {
  collection(handle: $h) {
    products(first: ${PAGE}, after: $a, filters: [{ available: true }]) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id handle title vendor productType availableForSale onlineStoreUrl tags
        options { name }
        images(first: 6) { nodes { url } }
        variants(first: 40) {
          nodes {
            availableForSale
            selectedOptions { name value }
            price { amount currencyCode }
            compareAtPrice { amount }
          }
        }
      }
    }
  }
}`;

export const luxRequestBody = (walk: LuxWalk, after: string | null, country: CountryCode): string =>
  JSON.stringify({ query: LUX_QUERY, variables: { h: walk.handle, a: after, cc: country } });

/** Map one Storefront product node. Pure; null unless reduced, in the market's currency. */
export function mapLux(site: LuxSite, country: CountryCode, walkGender: LuxGender, p: any): ProductRecord | null {
  const vs: any[] = p?.variants?.nodes ?? [];
  const title = String(p?.title ?? "").trim();
  if (!p?.id || !p?.handle || !title || !vs.length) return null;
  const tags: string[] = Array.isArray(p.tags) ? p.tags.map(String) : [];
  const type = String(p.productType ?? "").trim();
  if (/gift ?card|e-?gift/i.test(`${title} ${type}`)) return null;

  const currency = COUNTRIES[country].currency;
  const priced = vs
    .map((v) => ({ v, price: parseFloat(v?.price?.amount), cmp: parseFloat(v?.compareAtPrice?.amount), cur: String(v?.price?.currencyCode ?? "") }))
    .filter((x) => x.cur === currency && Number.isFinite(x.price) && x.price > 0);
  if (!priced.length) return null;
  // The cheapest BUYABLE variant, and that variant's own compare-at: never a
  // strike price borrowed from a dearer size.
  const pick = [...priced].sort((a, b) => Number(!!b.v.availableForSale) - Number(!!a.v.availableForSale) || a.price - b.price)[0];
  if (!(Number.isFinite(pick.cmp) && pick.cmp > pick.price)) return null;

  const names: string[] = (p.options ?? []).map((o: any) => String(o?.name ?? ""));
  const sizeName = names.find((n) => /size|taglia/i.test(n)) ?? null;
  const colourName = names.find((n) => /colou?r/i.test(n)) ?? null;
  const valueOf = (v: any, name: string | null) =>
    name ? String((v?.selectedOptions ?? []).find((o: any) => o?.name === name)?.value ?? "").trim() : "";
  const byLabel = new Map<string, SizeVariant>();
  if (sizeName) {
    for (const v of vs) {
      const label = valueOf(v, sizeName);
      if (!label || /default title/i.test(label)) continue;
      const availability: SizeVariant["availability"] = v?.availableForSale ? "in_stock" : "out_of_stock";
      const prev = byLabel.get(label);
      if (!prev || (prev.availability === "out_of_stock" && availability !== "out_of_stock")) byLabel.set(label, { label, availability });
    }
  }
  const sizes = [...byLabel.values()];
  const colors = colourName ? [...new Set(vs.map((v) => valueOf(v, colourName)).filter(Boolean))] : [];
  const imgs: string[] = (p.images?.nodes ?? []).map((i: any) => i?.url).filter((u: unknown): u is string => typeof u === "string" && u.startsWith("https://"));
  const vendor = String(p.vendor ?? "").trim();
  const category = site.category ? site.category(type, tags) : type || null;

  return {
    brand: site.brand,
    country,
    externalId: String(p.id).split("/").pop()!,
    name: vendor && !title.toLowerCase().startsWith(vendor.toLowerCase()) ? `${vendor} ${title}` : title,
    url: luxProductUrl(site, p.onlineStoreUrl, String(p.handle)),
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(pick.price),
    listPrice: toMinor(pick.cmp),
    currency,
    inStock: vs.some((v) => v?.availableForSale === true),
    category: category ? category.trim() || null : null,
    maker: vendor || null,
    gender: site.tagGender ? site.tagGender(tags, walkGender) : walkGender,
    variants: sizes.length ? { colors, sizes } : null,
    groupKey: null,
    colorName: colors.length === 1 ? colors[0] : null,
  };
}

export async function listLuxSite(site: LuxSite, country: CountryCode): Promise<ProductRecord[]> {
  if (!site.markets.includes(country)) return [];
  const cap = site.cap ?? DEFAULT_CAP;
  const byId = new Map<string, ProductRecord>();
  const problems: string[] = [];
  let requests = 0;
  let answered = 0;

  for (const walk of site.walks(country)) {
    let after: string | null = null;
    let taken = 0;
    while (taken < walk.max && byId.size < cap && requests < MAX_REQUESTS) {
      if (requests > 0) await sleep(PAUSE_MS);
      requests++;
      // Shopify answers the odd "Internal error" (seen on Antonioli): one retry.
      let d: any = null;
      for (let attempt = 0; attempt < 2 && !d?.data?.collection; attempt++) {
        if (attempt) await sleep(2500);
        d = await getJson<any>(`https://${site.host}/api/${API_VERSION}/graphql.json`, {
          method: "POST",
          country,
          headers: { "Content-Type": "application/json" },
          body: luxRequestBody(walk, after, country),
          retries: 1,
          timeoutMs: 45_000,
        }).catch((e) => ({ errors: [{ message: String(e) }] }));
      }
      const conn = d?.data?.collection?.products;
      if (!conn) {
        problems.push(`${walk.handle}: ${String(d?.errors?.[0]?.message ?? "no such collection").slice(0, 100)}`);
        break;
      }
      answered++;
      for (const p of conn.nodes ?? []) {
        if (taken >= walk.max) break;
        const r = mapLux(site, country, walk.gender, p);
        if (!r || byId.has(r.externalId)) continue;
        byId.set(r.externalId, r);
        taken++;
      }
      if (!conn.pageInfo?.hasNextPage || !conn.pageInfo?.endCursor) break;
      after = String(conn.pageInfo.endCursor);
    }
  }
  if (answered === 0) throw new Error(`${site.brand}/${country}: no sale collection answered (${problems.slice(0, 2).join("; ")})`);
  if (process.env.LUX_DEBUG) console.error(`${site.brand}/${country}: ${requests} requests${problems.length ? `, problems: ${problems.join("; ")}` : ""}`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
}

/** Registry entry point: `listLux("theoutnet", "GB")`. */
export async function listLux(brand: string, country: CountryCode): Promise<ProductRecord[]> {
  const site = luxSite(brand);
  return site ? listLuxSite(site, country) : [];
}

export const LUX_BRANDS = LUX_SITES.map((s) => s.brand);
