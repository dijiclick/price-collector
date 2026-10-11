/**
 * Sweaty Betty UK — Salesforce Commerce Cloud on PWA Kit, read through the
 * Shopper APIs (SCAPI) exactly as the storefront does:
 *
 *  1. A guest token from the site's own SLAS private-client proxy
 *     (`/mobify/slas/private/.../oauth2/token`, `grant_type=client_credentials`).
 *     The proxy holds the client secret; we never see it.
 *  2. `shopper-search` on `cgid=sale` (≈350 colourways) — the site's search hook
 *     strips list prices from hits, so
 *  3. `shopper-products` in batches of 24 for the price books
 *     (`GBP-LIST-PRICES` vs `GBP-SALE-PRICES`, needs `perPricebook=true`) and
 *     each size's `orderable`.
 *
 * All measured 2026-10-11 from a plain request; ~18 calls per run.
 * Org and short code are public in the page's `mobify-data` JSON
 * (`commerceAPI.parameters`); if calls start failing, re-read them there.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const SITE = "https://www.sweatybetty.com";
const ORG = "f_ecom_bbth_prd";
const SHORT_CODE = "2dccv65r";
const SITE_ID = "SB";
const CGID = "sale";
const IMG_BASE = "https://cdn.media.amplience.net/i/SweatyBetty";
const API = `https://${SHORT_CODE}.api.commercecloud.salesforce.com`;
const PAUSE_MS = Number(process.env.SWEATYBETTY_PAUSE_MS ?? 500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const sbSlug = (name: string): string =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** `/shop/<name-slug>-<variation group id>.html`, the storefront's own PDP path. */
export const sbUrl = (name: string, id: string): string => `${SITE}/shop/${sbSlug(name)}-${id}.html`;

/** Photos of this colour from `c_imageGroups` (viewType "large"). */
function photosOf(p: any, colour: string | null): string[] {
  const groups: any[] = p?.c_imageGroups ?? p?.c_productInfo?.c_imageGroups ?? [];
  const g = groups.find(
    (x) => x?.viewType === "large" && (x.variationAttributes ?? []).some((a: any) => a?.id === "color" && a.values?.some((v: any) => v?.value === colour)),
  );
  return (g?.images ?? [])
    .map((i: any) => (typeof i?.link === "string" ? (i.link.startsWith("http") ? i.link : `${IMG_BASE}${i.link}`) : null))
    .filter((u: string | null): u is string => !!u);
}

/**
 * One variation group from `shopper-products` (with `expand=prices,variations`)
 * → record. Pure.
 */
export function mapSbProduct(p: any, country: CountryCode = "GB", hitImage?: string | null): ProductRecord | null {
  const price = Number(p?.price);
  if (!p?.id || !p?.name || !Number.isFinite(price) || price <= 0) return null;
  const books: any[] = p.priceRanges ?? [];
  const list = Math.max(
    ...books.filter((b) => /LIST/i.test(String(b?.pricebook))).map((b) => Number(b.maxPrice ?? b.minPrice)).filter(Number.isFinite),
    0,
  );
  const colour: string | null = p.variationValues?.color ?? p.c_color ?? null;
  const colourAttr = (p.variationAttributes ?? []).find((a: any) => a?.id === "color");
  const colourName = colourAttr?.values?.find((v: any) => v?.value === colour)?.name ?? null;
  const sizeAttr = (p.variationAttributes ?? []).find((a: any) => a?.id === "size");
  const order: string[] = (sizeAttr?.values ?? []).map((v: any) => String(v?.value));
  const labelOf = (v: string) => sizeAttr?.values?.find((x: any) => x?.value === v)?.name ?? v.toUpperCase();
  const mine = (p.variants ?? []).filter((v: any) => !colour || v?.variationValues?.color === colour);
  const bySize = new Map<string, boolean>();
  for (const v of mine) {
    const s = v?.variationValues?.size;
    if (s) bySize.set(String(s), bySize.get(String(s)) === true || v.orderable === true);
  }
  const sizes: SizeVariant[] = [...bySize.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([v, ok]) => ({ label: labelOf(v), availability: ok ? "in_stock" : "out_of_stock" }));
  const imgs = photosOf(p, colour);
  const lead = hitImage ?? imgs[0] ?? null;
  return {
    brand: "sweatybetty",
    country,
    externalId: String(p.id),
    name: String(p.name).trim(),
    url: sbUrl(String(p.name), String(p.id)),
    imageUrl: lead,
    images: cleanGallery(imgs, lead),
    price: toMinor(price),
    listPrice: list > price ? toMinor(list) : null,
    currency: p.currency ?? COUNTRIES[country].currency,
    inStock: sizes.length ? sizes.some((s) => s.availability === "in_stock") : p.inventory?.orderable === true,
    category: Array.isArray(p.c_style) && p.c_style.length ? String(p.c_style.at(-1)).replace(/_/g, " ") : null,
    gender: "kadin",
    variants: sizes.length ? { colors: colourName ? [colourName] : [], sizes } : null,
    groupKey: p.master?.masterId ? `sweatybetty:${p.master.masterId}` : null,
    colorName: colourName,
  };
}

async function guestToken(country: CountryCode): Promise<string> {
  const t = await getJson<any>(`${SITE}/mobify/slas/private/shopper/auth/v1/organizations/${ORG}/oauth2/token`, {
    method: "POST",
    country,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=client_credentials&channel_id=${SITE_ID}`,
  });
  if (!t?.access_token) throw new Error("sweatybetty: no guest token");
  return t.access_token;
}

/** Register as `listSweatyBetty(country)`. GB only. */
export async function listSweatyBetty(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "GB") return [];
  const cap = 1500;
  const token = await guestToken(country);
  const auth = { Authorization: `Bearer ${token}` };
  const hits: any[] = [];
  for (let offset = 0; offset < 2000; offset += 200) {
    await sleep(PAUSE_MS);
    const q = new URLSearchParams({ siteId: SITE_ID, refine: `cgid=${CGID}`, limit: "200", offset: String(offset), currency: "GBP" });
    const d = await getJson<any>(`${API}/search/shopper-search/v1/organizations/${ORG}/product-search?${q}`, { country, headers: auth });
    hits.push(...(d?.hits ?? []));
    if (!d?.hits?.length || offset + 200 >= (d.total ?? 0)) break;
  }
  const imageOf = new Map<string, string>(hits.map((h) => [String(h.productId), h.image?.link]).filter(([, l]) => typeof l === "string") as [string, string][]);
  const ids = [...new Set(hits.map((h) => String(h.productId)).filter(Boolean))];
  const byId = new Map<string, ProductRecord>();
  for (let i = 0; i < ids.length && byId.size < cap; i += 24) {
    await sleep(PAUSE_MS);
    const batch = ids.slice(i, i + 24).map(encodeURIComponent).join(",");
    const d = await getJson<any>(
      `${API}/product/shopper-products/v1/organizations/${ORG}/products?siteId=${SITE_ID}&ids=${batch}&currency=GBP&expand=prices,availability,variations&perPricebook=true&allImages=false`,
      { country, headers: auth },
    );
    for (const p of d?.data ?? []) {
      const r = mapSbProduct(p, country, imageOf.get(String(p.id)) ?? null);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
}
