/**
 * Pandora outside Turkey — US and Canada (measured 2026-10-12).
 *
 * The storefronts (`us.pandora.net`, `ca.pandora.net`, …) are Salesforce PWA
 * Kit sites behind Cloudflare: the pages 403 from a datacenter IP (and from
 * the Mac), and the runner saw a 500 on `pandora.net`. Same fix as the Turkish
 * adapter (`pandora.ts`): never read a page. Two calls only:
 *
 * 1. A guest token from the storefront's own `/mobify/slas/private` proxy — a
 *    POST that Cloudflare lets through (200 from a GitHub runner for us/ca/uk/au,
 *    probe run 38228958587). The SLAS client is private ("incorrect client
 *    type" for the public PKCE flow), so the token has to come from there.
 * 2. SCAPI on Salesforce's own host (`<shortCode>.api.commercecloud.salesforce
 *    .com`), which is not behind Cloudflare: Shopper Search over the sale
 *    category, then Shopper Products for sizes, stock and photos.
 *
 * NOT the Turkish org. The non-TR sites are separate Salesforce orgs, which is
 * why the old note in lib/brands.ts said "a different org behind Cloudflare":
 *
 *   US, CA  f_ecom_aavx_prd / p0pv8hs2   sites en-US, en-CA   sale cgid `last-chance`
 *   GB      f_ecom_bfcr_prd / qt5gn5mk   site en-GB           (no markdown live 10-12)
 *   AU      f_ecom_bknf_prd / u1gjb8up   site en-AU           (no markdown live 10-12)
 *   CH, NO, AE  f_ecom_bjrn_prd (the TR org)  fr-CH, nb-NO, ar-AE  (no markdown
 *           live 10-12; CH's `sale` category still holds 115 rows at full price)
 *
 * Read from each storefront's `commerceAPI` block in Wayback copies of its home
 * page. Only US and CA carry real markdowns today, so only they are listed in
 * PANDORA_INTL_MARKETS; the rest answer the same calls and can be added the day
 * a sale starts (check its promotion id first — see markdownOf).
 *
 * Prices: `price` / `salePrice` always equal the list price (one "regular"
 * pricebook). The markdown is a promotion: `c_extend.priceInfo.promotionPrice`,
 * id "Last Chance Pricebook" (US) / "last-chance-pricebook" (CA). The figures
 * are the site's own (CA$108 → 53.99, not a computed 50%), so they are taken
 * verbatim. Other promotions on the same field are NOT strikethroughs and are
 * dropped: "Gift Set Pricebook" (set vs. the sum of its parts), "2023-08
 * Diamonds Set" (only when bought with a matching piece), "BAB20%" (build a
 * bracelet), "rotational-banner" alone.
 *
 * Photos: every image link points at the storefront host, which 403s outside a
 * browser (the long-standing "Pandora images 403" bug). The same file is served
 * by Salesforce's image edge, `edge.disstg.commercecloud.salesforce.com/dw/
 * image/v2/<REALM>/<path>` — 200 image/png from the Mac and a runner; `sw`/`sh`
 * resize it (the original is ~4 MB).
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { edgeImage, galleryOf } from "./pandora";

export { edgeImage };

export interface PandoraMarket {
  org: string;
  shortCode: string;
  siteId: string;
  /** Storefront origin: mints the token and is the product URL host. */
  site: string;
  /** Image realm for the DIS edge (the org's 4 letters + _PRD). */
  realm: string;
  /** The storefront's sale category. */
  cgid: string;
}

export const PANDORA_INTL_MARKETS: Partial<Record<CountryCode, PandoraMarket>> = {
  US: { org: "f_ecom_aavx_prd", shortCode: "p0pv8hs2", siteId: "en-US", site: "https://us.pandora.net", realm: "AAVX_PRD", cgid: "last-chance" },
  CA: { org: "f_ecom_aavx_prd", shortCode: "p0pv8hs2", siteId: "en-CA", site: "https://ca.pandora.net", realm: "AAVX_PRD", cgid: "last-chance" },
};

const PAGE_SIZE = 200;
const MAX_PAGES = 8;
/** SCAPI caps `ids` at 24 per request. */
const ID_BATCH = 24;
const DETAIL_CONCURRENCY = 4;
const CAP = Number(process.env.PANDORA_INTL_MAX_PRODUCTS ?? 1500);

const scapi = (m: PandoraMarket) => `https://${m.shortCode}.api.commercecloud.salesforce.com`;

export function searchUrl(m: PandoraMarket, offset: number): string {
  return (
    `${scapi(m)}/search/shopper-search/v1/organizations/${m.org}/product-search` +
    `?siteId=${m.siteId}&refine=${encodeURIComponent(`cgid=${m.cgid}`)}&limit=${PAGE_SIZE}&offset=${offset}` +
    // Naming `expand` replaces the default set; images come from the detail call.
    `&expand=availability,prices,represented_products,variations,custom_properties`
  );
}

export function detailUrl(m: PandoraMarket, ids: string[]): string {
  return (
    `${scapi(m)}/product/shopper-products/v1/organizations/${m.org}/products` +
    `?siteId=${m.siteId}&ids=${ids.map(encodeURIComponent).join(",")}&expand=availability,variations,images&allImages=true`
  );
}

async function token(m: PandoraMarket, country: CountryCode): Promise<string> {
  const res = await getJson<any>(`${m.site}/mobify/slas/private/shopper/auth/v1/organizations/${m.org}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=client_credentials&channel_id=${m.siteId}`,
    country,
  });
  if (!res?.access_token) throw new Error(`pandora-intl/${country}: no access_token`);
  return res.access_token as string;
}

/** A clearance markdown (the "last chance" pricebook), never a bundle or gift-set value. */
const CLEARANCE = /last[\s_-]*chance/i;
const NOT_A_MARKDOWN = /gift|set\b|bundle|bab|buy|bonus|free/i;

/**
 * Current + strikethrough price, or null when the hit is not marked down.
 * Only a promotion whose ids name the clearance pricebook counts.
 */
export function markdownOf(hit: any): { price: number; listPrice: number } | null {
  const info = hit?.c_extend?.priceInfo ?? {};
  const original = info.originalPrice?.value ?? hit?.price;
  const promo = info.promotionPrice;
  const ids: string[] = (promo?.promoDetails ?? []).map((d: any) => String(d?.id ?? ""));
  if (!ids.some((id) => CLEARANCE.test(id)) || ids.some((id) => NOT_A_MARKDOWN.test(id))) return null;
  const current = promo?.value;
  if (typeof original !== "number" || typeof current !== "number" || !(current > 0) || !(current < original)) return null;
  // A >90% "markdown" is a data error, not a deal.
  if (current < original * 0.1) return null;
  return { price: toMinor(current), listPrice: toMinor(original) };
}

const titleCase = (s: string) => s.replace(/(^|[\s-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());

/** Map one search hit to a record (prices + stock). Null when not marked down. */
export function mapIntlHit(hit: any, country: CountryCode, m: PandoraMarket): ProductRecord | null {
  const id = String(hit?.productId ?? "");
  const p = id ? markdownOf(hit) : null;
  if (!p) return null;
  const cat = hit?.representedProduct?.c_primaryCategory ?? hit?.c_extend?.custom?.primaryCategory;
  return {
    brand: "pandora",
    country,
    externalId: id,
    // Clearance names carry a "FINAL SALE - " prefix the card does not need.
    name: String(hit.productName ?? "").replace(/^\s*final sale\s*[-–]\s*/i, "").trim(),
    url: hit.c_slugURL ?? `${m.site}/en/${id}.html`,
    imageUrl: null,
    images: null,
    ...p,
    currency: COUNTRIES[country].currency,
    // `orderable` is true for sold-out hits too; c_productInStock is the flag that moves.
    inStock: hit.c_productInStock !== false,
    category: typeof cat === "string" && cat ? titleCase(cat.toLowerCase()) : null,
    gender: null,
    variants: null,
    groupKey: null,
    colorName: null,
  };
}

/** Card photo: the packshot the listing shows (not the bracelet-builder cut-out). */
function packshot(groups: any[]): string | null {
  for (const view of ["main_rect_center", "main", "singlepackshot_rect_center"]) {
    const link = groups.find((g) => g?.viewType === view && !g?.variationAttributes)?.images?.[0]?.link;
    if (typeof link === "string") return link;
  }
  return null;
}

/** Sizes (ring sizes, bracelet lengths) with per-size stock. "one size" is not a size. */
export function sizesOf(product: any): SizeVariant[] {
  const attr = (product?.variationAttributes ?? []).find((a: any) => a?.id === "size");
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const v of attr?.values ?? []) {
    const label = String(v?.name ?? "").trim();
    if (!label || /^one size$/i.test(label) || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, availability: v?.orderable ? "in_stock" : "out_of_stock" });
  }
  return out;
}

/** Fill photos, sizes and stock from a Shopper Products record. Pure. */
export function applyDetail(rec: ProductRecord, product: any, realm: string): void {
  const groups: any[] = Array.isArray(product?.imageGroups) ? product.imageGroups : [];
  const first = packshot(groups);
  const gallery = galleryOf(groups, first, rec.externalId) ?? [];
  const imageUrl = edgeImage(first ?? gallery[0], realm);
  rec.imageUrl = imageUrl;
  rec.images = cleanGallery(gallery.map((u) => edgeImage(u, realm)), imageUrl);
  const sizes = sizesOf(product);
  if (sizes.length > 0) rec.variants = { colors: [], sizes };
  if (typeof product?.inventory?.orderable === "boolean") rec.inStock = product.inventory.orderable;
  if (sizes.length > 0 && !sizes.some((s) => s.availability === "in_stock")) rec.inStock = false;
}

async function pool<T>(items: T[], workers: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

export async function listPandoraIntl(country: CountryCode): Promise<ProductRecord[]> {
  const m = PANDORA_INTL_MARKETS[country];
  if (!m) return [];
  const auth = { Authorization: `Bearer ${await token(m, country)}` };
  const byId = new Map<string, ProductRecord>();
  let hits = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE;
    const res = await getJson<any>(searchUrl(m, offset), { headers: auth, country });
    for (const hit of res?.hits ?? []) {
      hits++;
      const rec = mapIntlHit(hit, country, m);
      if (rec) byId.set(rec.externalId, rec);
    }
    if (offset + PAGE_SIZE >= (res?.total ?? 0)) break;
  }

  const off = (r: ProductRecord) => (r.listPrice! - r.price) / r.listPrice!;
  const rank = (all: ProductRecord[]) =>
    all.sort((a, z) => Number(z.inStock) - Number(a.inStock) || off(z) - off(a)).slice(0, CAP);
  const recs = rank([...byId.values()]);

  const batches: ProductRecord[][] = [];
  for (let i = 0; i < recs.length; i += ID_BATCH) batches.push(recs.slice(i, i + ID_BATCH));
  await pool(batches, DETAIL_CONCURRENCY, async (batch) => {
    // Best-effort: photos/sizes are enrichment; the prices are already in hand.
    const res = await getJson<any>(
      detailUrl(m, batch.map((r) => r.externalId)),
      { headers: auth, country },
    ).catch(() => null);
    const byPid = new Map((res?.data ?? []).map((p: any) => [String(p?.id ?? ""), p]));
    for (const rec of batch) {
      const p = byPid.get(rec.externalId);
      if (p) applyDetail(rec, p, m.realm);
    }
  });

  if (recs.length === 0) {
    throw new Error(`pandora-intl/${country}: no marked-down products (${hits} hits in cgid=${m.cgid})`);
  }
  return rank(recs);
}
