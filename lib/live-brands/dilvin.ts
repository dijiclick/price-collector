/**
 * Dilvin by url (`dilvin.com.tr/<model>-<slug>-<colour>`, one path segment).
 * Kobimaster, HTML only: the product page sets `var jspValue = {…}` (ProductID —
 * the id the collector stores — ModelName, Stock, SKU "<model>_<colour>",
 * ImageUrl) and prints the struck `price-standard` and charged `price-sales`
 * in the main price box (packages/collector/src/brands/dilvin.ts reads the same
 * two from the listing cards). Direct egress: Turkish shops never use the proxy.
 */
import type { LiveProduct } from "../live-lookup";
import { UA } from "../live-http";
import { classifyType } from "../productTypes";

const SITE = "https://www.dilvin.com.tr";

export function dilvinPathFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)dilvin\.com\.tr$/.test(u.hostname.toLowerCase())) return null;
  if (!/^\/[^/.]+-[^/.]+\/?$/.test(u.pathname)) return null;
  return u.pathname.replace(/\/$/, "");
}

/** "1.499,99 TL" → 149999 kuruş. */
const kurus = (s: string | undefined): number => {
  const m = String(s ?? "").match(/([\d.]+(?:,\d{1,2})?)/);
  return m ? Math.round(Number(m[1].replace(/\./g, "").replace(",", ".")) * 100) : NaN;
};

/** Pure: a fetched product page → LiveProduct (exported for tests). */
export function parseDilvinPage(html: string, url: string): LiveProduct | null {
  let j: any;
  try { j = JSON.parse(html.match(/var jspValue = (\{.*?\});/)?.[1] ?? ""); } catch { return null; }
  // jspValue.Price is what the page charges. The struck price is the main box's
  // <div class="price-standard">; related-product cards below use <span>s.
  const price = Math.round(Number(j?.Price) * 100);
  const struck = kurus(html.match(/<div class="price-standard">([^<]*)</)?.[1]);
  const name = String(j?.ModelName ?? "").replace(/\s+/g, " ").trim();
  if (!j?.ProductID || !name || !Number.isFinite(price) || price <= 0) return null;
  const colour = String(j.SKU ?? "").split("_").slice(1).join(" ").trim() || null;
  return {
    brand: "dilvin",
    externalId: String(j.ProductID),
    name,
    url,
    imageUrl: typeof j.ImageUrl === "string" && j.ImageUrl ? `${SITE}/${j.ImageUrl.replace(/^\//, "")}` : null,
    price,
    listPrice: Number.isFinite(struck) && struck > price ? struck : null,
    inStock: Number(j.Stock) > 0 && j.IsSaleable !== false,
    category: null,
    type: classifyType(null, name, "dilvin"),
    gender: "kadin",
    colorName: colour,
    country: "TR",
    currency: "TRY",
  };
}

export async function dilvinUrl(url: string): Promise<LiveProduct | null> {
  const path = dilvinPathFromUrl(url);
  if (!path) return null;
  const clean = `${SITE}${path}`;
  try {
    const r = await fetch(clean, {
      headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "tr-TR,tr;q=0.9" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!r.ok) {
      console.warn(`live-lookup: www.dilvin.com.tr refused with HTTP ${r.status} (direct egress)`);
      return null;
    }
    return parseDilvinPage(await r.text(), clean);
  } catch (err) {
    console.warn(`live-lookup: www.dilvin.com.tr unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
