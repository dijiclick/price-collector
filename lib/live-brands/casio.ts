/**
 * Casio Turkey by url — the distributor Ersa Saat's official shop
 * (`shopcasio.ersasaat.com.tr/<slug>-kol-saati-d2`; see
 * packages/collector/src/brands/casio.ts). casio.com/tr sells nothing and is
 * walled (Akamai), so only shop links resolve.
 *
 * The product page is server-rendered: the GA4 `view_item` push names the
 * model code (the collector's id), section and dial colour; the price block
 * shows `<u>list</u> shelf`; JSON-LD gives the photo and availability. The
 * basket ("SEPETTE") price is never quoted.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, dispatcher, toMinor, usingProxy } from "../live-http";

const SITE = "https://shopcasio.ersasaat.com.tr";
const HOST = "shopcasio.ersasaat.com.tr";

export function casioPathFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname.toLowerCase() !== HOST) return null;
  const path = u.pathname.replace(/\/+$/, "");
  return /^\/[a-z0-9-]+-d\d+$/i.test(path) ? path : null;
}

const fold = (s: string) =>
  s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").replace(/[Şş]/g, "s").replace(/[Öö]/g, "o").replace(/[Üü]/g, "u").toLowerCase();

/** "12.369,00 ₺" → 12369. */
function trAmount(s: string | null | undefined): number | null {
  const m = String(s ?? "").match(/(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?\s*(?:₺|TL)/);
  if (!m) return null;
  const n = Number(`${m[1].replace(/\./g, "")}.${m[2] ?? "0"}`);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Map a product page. Pure. */
export function mapCasioPage(html: string, path: string): LiveProduct | null {
  // The page's own view_item push, not the related-products lists below it.
  const at = html.search(/item_list_id:\s*"product_detail"/);
  const from = at < 0 ? -1 : html.lastIndexOf("gaProducts.push({", at);
  const ga = from < 0 ? "" : html.slice(from, at + 400);
  const field = (k: string) => {
    const v = ga.match(new RegExp(`\\b${k}:\\s*"([^"]*)"`))?.[1]?.trim();
    return v ? v : null;
  };
  const code = field("item_id");
  const name = (html.match(/<h1 class="product-title[^"]*">([^<]+)<\/h1>/)?.[1] ?? field("item_name") ?? "").replace(/\s+/g, " ").trim();
  // `<span class="price"> <u>12.369,00 ₺</u> 11.750,55 ₺ </span>`
  const block = html.match(/<div class="price-area">[\s\S]*?<span class="price">([\s\S]*?)<\/span>/)?.[1] ?? "";
  const was = trAmount(block.match(/<u>([^<]+)<\/u>/)?.[1]);
  const now = trAmount(block.replace(/<u>[^<]*<\/u>/, "")) ?? (Number(ga.match(/\bprice:\s*([\d.]+)/)?.[1]) || null);
  if (!code || !name || now == null) return null;
  let ld: any = null;
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]);
      if (j?.["@type"] === "Product") { ld = j; break; }
    } catch { /* not JSON */ }
  }
  const g = fold(field("item_gender") ?? "");
  const gender = /cocuk/.test(g) ? "cocuk" : /kadin/.test(g) && !/erkek/.test(g) ? "kadin" : /erkek/.test(g) && !/kadin/.test(g) ? "erkek" : null;
  return {
    brand: "casio",
    externalId: code.toUpperCase(),
    name,
    url: `${SITE}${path}`,
    imageUrl: typeof ld?.image === "string" ? ld.image : `https://cdn.demircloud.com/products/1000/${encodeURIComponent(code.toUpperCase())}.jpg`,
    price: toMinor(now),
    listPrice: was != null && was > now ? toMinor(was) : null,
    inStock: ld?.offers?.availability ? /InStock/i.test(String(ld.offers.availability)) : true,
    category: /kol saati/i.test(name) ? "Kol Saati" : "Saat",
    type: null,
    gender,
    colorName: field("item_color"),
    country: "TR",
    currency: "TRY",
  };
}

export async function casioUrl(url: string): Promise<LiveProduct | null> {
  const path = casioPathFromUrl(url);
  if (!path) return null;
  const country = countryFor("casio");
  try {
    const r = await fetch(`${SITE}${path}`, {
      headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "tr-TR,tr;q=0.9" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(country),
    });
    if (!r.ok) {
      console.warn(`live-lookup: ${HOST} refused with HTTP ${r.status}${usingProxy() ? ` (via ${country} proxy)` : " (direct egress)"}`);
      return null;
    }
    return mapCasioPage(await r.text(), path);
  } catch (err) {
    console.warn(`live-lookup: ${HOST} unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
