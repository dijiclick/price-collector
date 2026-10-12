/**
 * Columbia Sportswear (US + Canada) through the Unbxd index its own storefront
 * searches.
 *
 * columbia.com / columbiasportswear.ca are Salesforce PWA Kit behind Cloudflare
 * ("Attention Required!" 403 to runners and to the Mac alike), but the search
 * grid is served by Unbxd (`search.unbxd.io`) with the public api/site keys that
 * sit in the page config (`__PRELOADED_STATE__ … unbxd.apiKey/siteKey`, per
 * locale). Unbxd answers a plain GET from a GitHub runner — no proxy (probe run
 * 38227801391, 2026-10-12: US and CA both 200 with real sale rows).
 *
 * One Unbxd product is one style; its `variants` are its colours (one entry per
 * colour, `variants=true&variants.count=100`). `v_onSaleFlag:"true"` keeps the
 * styles with a reduced colour, and each colour carries its own
 * `v_regularPrice` (the strike-through) and `v_salePrice`, so the discount is
 * checked per colour. `v_onlinesize` is the size run and `v_size` the sizes in
 * stock (a colour with 39 units left lists only XL/XXL), which is real per-size
 * stock for restock alerts.
 *
 * The `categoryPath` "sale" tag is on ~every product (2,958 of 2,963 in the US),
 * so it is NOT the filter; the per-colour sale flag and price pair are.
 *
 * Canada's index is named `…-dev-…` but it is the one the live CA storefront
 * reads (the production config ships it); its product URLs point at
 * `dev.columbiasportswear.ca`, rewritten here to the www host.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "columbia";

export const COLUMBIA_MARKETS: Partial<Record<CountryCode, { apiKey: string; siteKey: string; host: string }>> = {
  US: {
    apiKey: "27fa0595fc0c03fe22895d52bc12e6b7",
    siteKey: "ss-unbxd-gus-prod-columbia-us35131753190941",
    host: "https://www.columbia.com",
  },
  CA: {
    apiKey: "c1a9fd2a90d9b78cdce3d65ed6328ba8",
    siteKey: "ss-unbxd-gus-dev-columbia-ca35131752251401",
    host: "https://www.columbiasportswear.ca",
  },
};

const ROWS = 100;
const MAX_PAGES = 30;
const CAP = Number(process.env.COLUMBIA_MAX_PRODUCTS ?? 1500);
const FIELDS = [
  "uniqueId", "title", "productUrl", "gender", "breadcrumbs", "primaryCategoryDisplayName",
  "v_colorCode", "v_color", "v_regularPrice", "v_salePrice", "v_inventory", "v_size", "v_onlinesize", "v_imageUrl",
].join(",");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function columbiaSearchUrl(country: CountryCode, start: number): string | null {
  const m = COLUMBIA_MARKETS[country];
  if (!m) return null;
  const p = new URLSearchParams({
    q: "*",
    rows: String(ROWS),
    start: String(start),
    filter: 'v_onSaleFlag:"true"',
    variants: "true",
    "variants.count": "100",
    fields: FIELDS,
  });
  return `https://search.unbxd.io/${m.apiKey}/${m.siteKey}/search?${p}`;
}

const first = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "")).trim();
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : NaN;
};

function genderOf(g: string): ProductRecord["gender"] {
  if (/^women/i.test(g)) return "kadin";
  if (/^men/i.test(g)) return "erkek";
  if (/kid|boy|girl|youth|toddler|infant|baby/i.test(g)) return "cocuk";
  return null;
}

/** The storefront host for this market, whatever host Unbxd's feed wrote. */
function siteUrl(country: CountryCode, raw: string): string | null {
  const m = COLUMBIA_MARKETS[country];
  if (!m || !raw) return null;
  try {
    const u = new URL(raw);
    return `${m.host}${u.pathname}`;
  } catch {
    return raw.startsWith("/") ? `${m.host}${raw}` : null;
  }
}

/** Amplience serves the multi-megabyte original without a width; jpg keeps old Android decoders happy. */
const photo = (u: string) => `${u.split("?")[0]}?w=900&fmt=jpg`;

/** Map one Unbxd product (one style) into one record per reduced colour. Pure. */
export function mapColumbiaProduct(p: any, country: CountryCode): ProductRecord[] {
  const out: ProductRecord[] = [];
  if (!COLUMBIA_MARKETS[country] || !p?.uniqueId) return out;
  const base = siteUrl(country, String(p.productUrl ?? ""));
  if (!base) return out;
  const gender = genderOf(first(p.gender));
  const category = String(p.primaryCategoryDisplayName ?? "").trim() || String(p.breadcrumbs ?? "").split(">").pop()?.trim() || null;
  const name = String(p.title ?? "").replace(/\s+/g, " ").trim();
  if (!name) return out;

  for (const v of p.variants ?? []) {
    const code = String(v?.v_colorCode ?? "").trim();
    const list = num(v?.v_regularPrice);
    const sale = num(v?.v_salePrice);
    if (!code || !(list > 0) || !(sale > 0) || !(sale < list)) continue;

    const run: string[] = (Array.isArray(v.v_onlinesize) && v.v_onlinesize.length ? v.v_onlinesize : v.v_size ?? []).map(String);
    const inStockSizes = new Set<string>((v.v_size ?? []).map(String));
    const units = num(v.v_inventory);
    const sizes: SizeVariant[] = [...new Set(run)].map((label) => ({
      label,
      availability: inStockSizes.has(label) ? "in_stock" : "out_of_stock",
    }));
    const inStock = sizes.length ? sizes.some((s) => s.availability === "in_stock") : units > 0;

    const photos = (Array.isArray(v.v_imageUrl) ? v.v_imageUrl : [])
      .map(String)
      .filter((u: string) => /^https?:\/\//.test(u) && !/ImagePlaceholder/i.test(u))
      .map(photo);
    const colour = first(v.v_color) || null;
    out.push({
      brand,
      country,
      externalId: `${p.uniqueId}-${code}`,
      name,
      url: `${base}?color=${encodeURIComponent(code)}`,
      imageUrl: photos[0] ?? null,
      images: cleanGallery(photos, photos[0] ?? null),
      price: toMinor(sale),
      listPrice: toMinor(list),
      currency: COUNTRIES[country].currency,
      inStock,
      category,
      gender,
      variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
      groupKey: `columbia-${p.uniqueId}`,
      colorName: colour,
    });
  }
  return out;
}

const GENDER_RANK: Record<string, number> = { kadin: 0, cocuk: 1, null: 2, erkek: 3 };

/**
 * Keep the cap useful: in stock first, then one colour of every style before a
 * second colour of any (a style can carry 20 reduced colours), women's first
 * within each round — the app's audience.
 */
export function rankColumbia(rows: { r: ProductRecord; colourIndex: number }[]): ProductRecord[] {
  return rows
    .map((x, i) => ({ ...x, i }))
    .sort(
      (a, b) =>
        Number(b.r.inStock) - Number(a.r.inStock) ||
        a.colourIndex - b.colourIndex ||
        GENDER_RANK[String(a.r.gender)] - GENDER_RANK[String(b.r.gender)] ||
        a.i - b.i,
    )
    .map((x) => x.r);
}

export async function listColumbia(country: CountryCode): Promise<ProductRecord[]> {
  if (!COLUMBIA_MARKETS[country]) return [];
  const rows: { r: ProductRecord; colourIndex: number }[] = [];
  const seen = new Set<string>();
  let total = Infinity;
  for (let page = 0; page < MAX_PAGES && page * ROWS < total; page++) {
    if (page > 0) await sleep(300);
    const data = await getJson<any>(columbiaSearchUrl(country, page * ROWS)!, { country });
    const res = data?.response;
    total = Number(res?.numberOfProducts ?? 0);
    const products: any[] = res?.products ?? [];
    if (!products.length) break;
    for (const p of products) {
      mapColumbiaProduct(p, country).forEach((r, colourIndex) => {
        if (seen.has(r.externalId)) return;
        seen.add(r.externalId);
        rows.push({ r, colourIndex });
      });
    }
  }
  if (!rows.length) throw new Error(`columbia/${country}: Unbxd returned no reduced colours (total ${total})`);
  return rankColumbia(rows).slice(0, CAP);
}

export const listProducts = listColumbia;
