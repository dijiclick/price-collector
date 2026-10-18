/**
 * Kendra Scott (kendrascott.com, US) through Salesforce Commerce API — the
 * same Shopper Search the storefront (PWA Kit) browses with.
 *
 * The site is behind Cloudflare, but the PWA's own SLAS private-client proxy
 * (`/mobify/slas/private/.../oauth2/token`, `grant_type=client_credentials`)
 * hands any caller a guest token, and Salesforce's API host
 * (`fio8iwwu.api.commercecloud.salesforce.com`) is not walled. Both answer a
 * GitHub runner with no proxy (probe run 39135978348, 2026-10-18).
 *
 * The Bloomreach index the site also loads carries no strike price (price ==
 * sale_price on every row), so it is not used.
 *
 * Markdown: the "Sale" category (`cgid=sales`, ~1.2k styles) with
 * `perPricebook=true` returns `tieredPrices` per variant — the
 * `usd-ks-list-prices` book (the price struck through) and
 * `usd-ks-sale-prices` (charged). Only a list price strictly above the
 * charged price is a deal; ~60% of the Sale grid is "final sale" at its list
 * price and is dropped.
 *
 * One record per colour/metal variant (each has its own photos, url and
 * price). Initial necklaces (`letter`, 26 variants of one design) stay one
 * record — the represented variant — instead of 26 identical cards. A
 * master shows up as one hit per variation group, each listing every
 * variant, so rows are deduplicated by variant id (measured 2026-10-18: 1,236
 * hits → 177 marked-down variants, 151 orderable).
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const SITE = "https://www.kendrascott.com";
const API = "https://fio8iwwu.api.commercecloud.salesforce.com";
const ORG = "f_ecom_bbkx_prd";
const SITE_ID = "KendraScott";
const CGID = "sales";
const PAGE = 200;
const MAX_PAGES = 10;
const CAP = 1500;
const PAUSE_MS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const num = (x: unknown): number | null => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The struck-through price: the list pricebook's entry. */
export function listOf(tiered: unknown): number | null {
  if (!Array.isArray(tiered)) return null;
  const l = tiered.filter((p: any) => /list/i.test(String(p?.pricebook ?? ""))).map((p: any) => num(p?.price)).filter((n): n is number => n != null);
  return l.length ? Math.max(...l) : null;
}

/** Name → product type, for the jewellery words the catalogue uses. */
export function categoryOf(name: string): string | null {
  const n = name.toLowerCase();
  const table: [RegExp, string][] = [
    [/watch band/, "Watch Bands"],
    [/\bwatch\b/, "Watches"],
    [/earring|stud|huggie|hoop|ear (climber|cuff|crawler)/, "Earrings"],
    [/necklace|pendant|choker|lariat/, "Necklaces"],
    [/bracelet|bangle|cuff/, "Bracelets"],
    [/\brings?\b|band ring/, "Rings"],
    [/charm/, "Charms"],
    [/anklet/, "Anklets"],
    [/sunglass|eyewear|readers/, "Eyewear"],
    [/belt/, "Belts"],
  ];
  return table.find(([re]) => re.test(n))?.[1] ?? null;
}

/** Cloudinary rendition at a size worth showing (the search hands out w_500). */
const big = (u: string) => u.replace("/w_500,c_fit/", "/w_1000,c_fit/");

/** The `large` photos of one variant: the image groups whose variation values all match it. */
function photosOf(hit: any, values: Record<string, string> | null): string[] {
  const groups: any[] = (hit?.imageGroups ?? []).filter((g: any) => g?.viewType === "large");
  const match = (g: any) =>
    Array.isArray(g?.variationAttributes) &&
    g.variationAttributes.every((a: any) => (a?.values ?? []).some((v: any) => values && values[a.id] === v?.value));
  const own = values ? groups.find(match) : undefined;
  const pick = own ?? groups.find((g) => !g?.variationAttributes) ?? groups[0];
  const urls = (pick?.images ?? []).map((i: any) => i?.disBaseLink ?? i?.link).filter((u: unknown): u is string => typeof u === "string");
  return urls.map(big);
}

function urlOf(hit: any, id: string): string {
  const links: any[] = [...(hit?.c_allPdpLinks ?? []), ...(hit?.c_pdpLinks ?? [])];
  const own = links.find((l) => String(l?.id) === id)?.url;
  const u = typeof own === "string" ? own : id === String(hit?.productId) && typeof hit?.c_url === "string" ? hit.c_url : `${SITE}/${id}.html`;
  return u.split("?")[0];
}

/** Map one Shopper Search hit to its marked-down variants. Pure. */
export function mapKendraHit(hit: any, country: CountryCode = "US"): ProductRecord[] {
  const masterName = String(hit?.productName ?? "").trim();
  if (!masterName || !hit?.productId) return [];
  const attrs: string[] = (hit.variationAttributes ?? []).map((a: any) => String(a?.id));
  const variants: any[] = Array.isArray(hit.variants) && hit.variants.length && !attrs.includes("letter")
    ? hit.variants
    : [{ productId: hit.productId, name: masterName, price: hit.price, tieredPrices: hit.tieredPrices, orderable: hit.orderable, variationValues: null, rep: true }];
  const groupKey = variants.length > 1 ? `kendrascott-${hit.productId}` : null;
  const out: ProductRecord[] = [];
  for (const v of variants) {
    const id = String(v?.productId ?? "");
    const price = num(v?.price);
    const list = listOf(v?.tieredPrices);
    if (!id || price == null || list == null || list <= price) continue;
    const name = String(v?.name ?? masterName).trim() || masterName;
    const values: Record<string, string> | null = v?.variationValues ?? (v?.rep ? hit?.representedProduct?.variationValues ?? null : null);
    const photos = photosOf(hit, v?.rep ? null : values);
    const image = photos[0] ?? hit?.image?.disBaseLink ?? null;
    const colour = values?.metal ? values.metal[0] + values.metal.slice(1).toLowerCase() : null;
    out.push({
      brand: "kendrascott",
      country,
      externalId: id,
      name,
      url: urlOf(hit, id),
      imageUrl: image ? big(image) : null,
      images: cleanGallery(photos, image ? big(image) : null),
      price: toMinor(price),
      listPrice: toMinor(list),
      currency: COUNTRIES[country].currency,
      inStock: v?.orderable !== false,
      category: categoryOf(name),
      gender: null,
      variants: null,
      groupKey,
      colorName: colour === "Rhodium" ? "Silver" : colour,
    });
  }
  return out;
}

async function guestToken(country: CountryCode): Promise<string> {
  const t = await getJson<any>(`${SITE}/mobify/slas/private/shopper/auth/v1/organizations/${ORG}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=client_credentials&channel_id=${SITE_ID}`,
    country,
  });
  if (!t?.access_token) throw new Error("kendrascott: no guest token");
  return t.access_token as string;
}

export function searchUrl(offset: number): string {
  const q = new URLSearchParams({
    siteId: SITE_ID,
    refine: `cgid=${CGID}`,
    limit: String(PAGE),
    offset: String(offset),
    currency: "USD",
    expand: "prices,variations,availability,images,represented_products",
    allImages: "true",
    perPricebook: "true",
    allVariationProperties: "true",
  });
  return `${API}/search/shopper-search/v1/organizations/${ORG}/product-search?${q}`;
}

export async function listKendraScott(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const token = await guestToken(country);
  const byId = new Map<string, ProductRecord>();
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page) await sleep(PAUSE_MS);
    const j = await getJson<any>(searchUrl(page * PAGE), { country, headers: { Authorization: `Bearer ${token}` } });
    const hits: any[] = j?.hits ?? [];
    for (const h of hits) for (const r of mapKendraHit(h, country)) if (!byId.has(r.externalId)) byId.set(r.externalId, r);
    if (!hits.length || (page + 1) * PAGE >= Number(j?.total ?? 0) || byId.size >= CAP * 1.5) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
