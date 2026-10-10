/**
 * Modanisa by url. The product page (`/<slug>.html`) embeds its analytics
 * product object — `{"id":…,"unit_sale":1299.99,"unit_sale_price":799.99,
 * "stock":47,…}` — which carries both the struck-through and the selling
 * price, so one HTML fetch is the lookup. `unit_sale_price` is the shelf
 * price; basket campaigns ("2000 TL ve Üzeri %20") are not applied, matching
 * packages/collector/src/brands/modanisa.ts.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, dispatcher, toMinor } from "../live-http";

const SITE = "https://www.modanisa.com";

async function html(url: string, country: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "tr-TR,tr;q=0.9" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(country),
    });
    if (!r.ok) {
      console.warn(`live-lookup: modanisa.com refused with HTTP ${r.status}`);
      return null;
    }
    return await r.text();
  } catch (err) {
    console.warn(`live-lookup: modanisa.com unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** The JSON object literal starting at the first `{` after `from`. */
function objectAt(text: string, from: number): any | null {
  const start = text.indexOf("{", from);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

const jsVar = (page: string, name: string): string | null =>
  page.match(new RegExp(`var ${name}\\s*=\\s*(["'])((?:\\\\.|(?!\\1).)*)\\1`))?.[2] ?? null;

export function mapModanisaPage(page: string): LiveProduct | null {
  const at = page.search(/"product":\s*\{"id":/);
  const p = at >= 0 ? objectAt(page, at + 10) : null;
  const price = Number(p?.unit_sale_price);
  if (!p?.id || !p.name || !Number.isFinite(price) || price <= 0) return null;
  const list = Number(p.unit_sale);
  const colour = page.match(/variant\s*:\s*"([^"]*)"/)?.[1] ?? null;
  const cats: string[] = Array.isArray(p.taxonomy) ? p.taxonomy.map(String) : [];
  const c = cats.join(" | ");
  return {
    brand: "modanisa",
    externalId: String(p.id),
    // The page's own title var matches the listing name the collector stores;
    // the analytics object sometimes drops the " - Brand" suffix.
    name: String(jsVar(page, "productName") ?? p.name).replace(/\s+/g, " ").trim(),
    url: p.url ? `${SITE}${String(p.url).replace(/\\\//g, "/")}` : SITE,
    imageUrl: typeof p.product_image_url === "string" ? p.product_image_url : null,
    price: toMinor(price),
    listPrice: Number.isFinite(list) && list > price ? toMinor(list) : null,
    inStock: p.stock == null ? true : Number(p.stock) > 0,
    // Marketplace: the label goes in category, as the collector does.
    category: jsVar(page, "productBrand"),
    type: null,
    gender: /[çc]ocuk|bebek|gen[çc] k[ıi]z/i.test(c) ? "cocuk" : /\berkek\b/i.test(c) ? "erkek" : "kadin",
    colorName: colour || null,
    country: "TR",
    currency: "TRY",
  };
}

export async function modanisaUrl(url: string): Promise<LiveProduct | null> {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  // Product pages are /<slug>.html (categories are .htm / .list / .page).
  if (!/^\/(?:[a-z]{2}\/)?[^/]+\.html$/i.test(u.pathname)) return null;
  const page = await html(`${SITE}${u.pathname}`, countryFor("modanisa"));
  return page ? mapModanisaPage(page) : null;
}
