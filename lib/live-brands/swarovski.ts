/**
 * Swarovski by url (`swarovski.com/<locale>/p-<master>/<slug>?variantID=<id>`).
 *
 * swarovski.com itself answers 403 to datacenter egress (Akamai); its Baqend
 * Speed Kit cache does not, with `Origin: https://www.swarovski.com` — the
 * route the collector uses (packages/collector/src/brands/swarovski.ts and
 * swarovski-tr.ts). The product page through the cache carries a schema.org
 * Product (sale price, sku, availability) and prints the strike price as
 * `swa-product-information__price__original`. Baqend refuses roughly one
 * fresh copy in four with a fast 400, so a few cache-busted copies are tried.
 *
 * The id is the variant's sku (= `variantID`), the collector's externalId.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, toMinor } from "../live-http";

const SITE = "https://www.swarovski.com";
const BAQEND = "https://swarovski.app.baqend.com";
const INSTALL_JS = `${BAQEND}/v1/speedkit/install.js?d=production&o=${encodeURIComponent(SITE)}&es=modern`;
const FALLBACK_BUILD = { bqcv: "22a0a3a5", bqsk: "2.22.5" };
const TRIES = 4;

/** Locale → market the collector stores it under. */
const MARKETS: Record<string, { country: string; currency: string; decimalComma: boolean }> = {
  "tr-TR": { country: "TR", currency: "TRY", decimalComma: true },
  "en-US": { country: "US", currency: "USD", decimalComma: false },
  "en_GB-CA": { country: "CA", currency: "CAD", decimalComma: false },
  "en_GB-AU": { country: "AU", currency: "AUD", decimalComma: false },
};

export interface SwarovskiRef {
  locale: string;
  path: string;
  variant: string | null;
}

export function swarovskiRefFromUrl(url: string): SwarovskiRef | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)swarovski\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/([A-Za-z_-]+)\/p-[A-Za-z0-9]+(?:\/[^?#]*)?$/);
  if (!m || !MARKETS[m[1]]) return null;
  const variant = u.searchParams.get("variantID");
  return { locale: m[1], path: u.pathname, variant: variant && /^\d+$/.test(variant) ? variant : null };
}

/** "5.590 ₺" (decimal comma) / "$1,234.00" → major units. */
export function swarovskiMoney(s: string | undefined, decimalComma: boolean): number {
  const t = String(s ?? "").replace(/&nbsp;/g, " ").replace(/[^\d.,]/g, "");
  if (!/\d/.test(t)) return NaN;
  const n = parseFloat(decimalComma ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/** Map a product page served through Baqend. Pure. */
export function mapSwarovskiPdp(html: string, ref: SwarovskiRef): LiveProduct | null {
  const market = MARKETS[ref.locale];
  if (!market) return null;
  let product: any = null;
  let crumbs: any[] = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]);
      if (j?.["@type"] === "Product") product = j;
      if (j?.["@type"] === "BreadcrumbList") crumbs = j.itemListElement ?? [];
    } catch { /* another block */ }
  }
  const price = Number(product?.offers?.price);
  const sku = product?.sku ? String(product.sku) : ref.variant;
  if (!product?.name || !sku || !Number.isFinite(price) || price <= 0) return null;
  const was = swarovskiMoney(html.match(/swa-product-information__price__original[^"]*">\s*([^<]*)</)?.[1], market.decimalComma);
  // The last crumb is the product itself; the one before is its deepest category.
  const cats = [...crumbs].sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0)).map((c) => c?.item?.name).filter(Boolean);
  const category = cats.length >= 2 ? String(cats[cats.length - 2]) : null;
  const img = typeof product.image === "string" ? product.image : Array.isArray(product.image) ? product.image[0] : null;
  return {
    brand: "swarovski",
    externalId: sku,
    name: String(product.name).trim(),
    url: typeof product.url === "string" && product.url.startsWith(SITE) ? product.url : `${SITE}${ref.path}${ref.variant ? `?variantID=${ref.variant}` : ""}`,
    imageUrl: typeof img === "string" ? img.replace(/\$size_\d+/, "$size_1200").replace(/w_auto/, "w_800").replace(/dpr_auto/, "dpr_1.0") : null,
    price: toMinor(price),
    listPrice: Number.isFinite(was) && was > price && price >= was * 0.1 ? toMinor(was) : null,
    inStock: !/OutOfStock|SoldOut|Discontinued/i.test(String(product.offers?.availability ?? "")),
    category,
    type: null,
    gender: null,
    colorName: null,
    country: market.country as LiveProduct["country"],
    currency: market.currency,
  };
}

async function text(url: string, headers: Record<string, string>, ms: number): Promise<{ status: number; body: string }> {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms), cache: "no-store" });
    return { status: r.status, body: r.ok ? await r.text() : "" };
  } catch {
    return { status: 0, body: "" };
  }
}

async function build(): Promise<{ bqcv: string; bqsk: string }> {
  const { body } = await text(INSTALL_JS, { "User-Agent": UA }, 4000);
  const m = body.match(/wrapper-sw\.js\?r=([0-9a-f]{8})[0-9a-f-]*&(?:amp;)?v=([0-9][0-9.]*[0-9])/i);
  return m ? { bqcv: m[1], bqsk: m[2] } : FALLBACK_BUILD;
}

export async function swarovskiUrl(url: string): Promise<LiveProduct | null> {
  const ref = swarovskiRefFromUrl(url);
  if (!ref) return null;
  const b = await build();
  const headers = { Origin: SITE, Referer: `${SITE}/`, Accept: "text/html", "User-Agent": UA };
  for (let i = 0; i < TRIES; i++) {
    const qs = new URLSearchParams();
    if (ref.variant) qs.set("variantID", ref.variant);
    qs.set("mdcb", `${Date.now().toString(36)}${i}`);
    qs.set("bqcv", b.bqcv);
    qs.set("bqsk", b.bqsk);
    const res = await text(`${BAQEND}/v1/asset/${SITE}${ref.path}?${qs}`, headers, 8000);
    if (res.status === 200) return mapSwarovskiPdp(res.body, ref);
    if (res.status !== 400 && res.status < 500) {
      console.warn(`live-lookup: swarovski.app.baqend.com refused with HTTP ${res.status}`);
      return null;
    }
  }
  console.warn("live-lookup: swarovski.app.baqend.com served no copy of the product page");
  return null;
}
