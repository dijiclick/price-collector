/**
 * Benefit Cosmetics United States by url (`benefitcosmetics.com/en-us/product/<slug>-<PID>.html`).
 *
 * SFRA storefront. Its `Product-Variation` controller answers the product as
 * JSON (`{action, product: {id, productName, price: {sales, list}, available,
 * images, …}}`) to a plain GET from US egress — probe run 39135885465
 * (2026-10-18, 200, 24.6 KB). Turkish and German addresses get a 403, so this
 * only answers from the US. The id is the variant pid in the url, as the
 * collector's.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, json, toMinor } from "../live-http";

const SITE = "https://www.benefitcosmetics.com";

export function benefitPidFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)benefitcosmetics\.com$/i.test(u.hostname) || !/^\/en-us\//i.test(u.pathname)) return null;
  return u.pathname.match(/\/product\/[^/]*?-([A-Z0-9]+)\.html$/)?.[1] ?? null;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Map a `Product-Variation` body. Pure. */
export function mapBenefitVariation(body: any, url: string): LiveProduct | null {
  const p = body?.product;
  const id = typeof p?.id === "string" ? p.id : "";
  const name = String(p?.productName ?? "").replace(/\s+/g, " ").trim();
  const price = num(p?.price?.sales?.value ?? p?.price?.min?.sales?.value);
  if (!id || !name || price == null) return null;
  const list = num(p?.price?.list?.value ?? p?.price?.min?.list?.value);
  const imgs: any[] = p?.images?.large ?? p?.images?.medium ?? p?.images?.small ?? [];
  const img = imgs.map((i) => i?.absURL ?? i?.url).find((u) => typeof u === "string" && /^https?:\/\//.test(u)) ?? null;
  const shade = (p?.variationAttributes ?? [])
    .flatMap((a: any) => (a?.values ?? []).filter((v: any) => v?.selected))
    .map((v: any) => v?.displayValue)
    .find((v: unknown) => typeof v === "string" && v.trim() && !/^(mini|full size|standard|kit|set)$/i.test(v.trim()));
  const href = typeof p?.selectedProductUrl === "string" && p.selectedProductUrl.startsWith("/en-us/") ? SITE + p.selectedProductUrl : url.split(/[?#]/)[0];
  return {
    brand: "benefit",
    externalId: id,
    name,
    url: href,
    imageUrl: img,
    price: toMinor(price),
    listPrice: list != null && list > price ? toMinor(list) : null,
    inStock: p?.available !== false && p?.readyToOrder !== false,
    category: typeof p?.primaryCategory?.name === "string" ? p.primaryCategory.name : null,
    type: null,
    gender: null,
    colorName: typeof shade === "string" ? shade.trim() : null,
    country: "US",
    currency: "USD",
  };
}

export async function benefitUrl(url: string): Promise<LiveProduct | null> {
  const pid = benefitPidFromUrl(url);
  if (!pid) return null;
  const body = await json<any>(
    `${SITE}/on/demandware.store/Sites-benco-us-Site/en_US/Product-Variation?pid=${encodeURIComponent(pid)}&quantity=1`,
    { Accept: "application/json", "User-Agent": UA, "X-Requested-With": "XMLHttpRequest" },
    countryFor("benefit", "us"),
  );
  return body ? mapBenefitVariation(body, url) : null;
}
