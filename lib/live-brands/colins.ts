/**
 * Colin's by url (`colins.com.tr/p/<slug>-<id>`). Inveon, HTML only: the
 * product page sets `window.insider_object.product` (group_code = the colour
 * id the collector stores, unit_price / unit_sale_price, colour, taxonomy) and
 * a schema.org Product (images, availability). Per-size stock is in the size
 * picker's `data-stock="havestock|nostock"`. Plain fetch works (no bot manager).
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, dispatcher, usingProxy } from "../live-http";
import { classifyType } from "../productTypes";

const SITE = "https://www.colins.com.tr";

export function colinsId(url: string): string | null {
  try {
    const u = new URL(url);
    return u.pathname.match(/^\/p\/[^/]*-(\d{3,})\/?$/)?.[1] ?? null;
  } catch { return null; }
}

/** Same 8 s timeout + proxy as live-http's json(), for an HTML page. */
async function text(url: string, country: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "tr-TR,tr;q=0.9" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(country),
    });
    if (!r.ok) {
      console.warn(`live-lookup: www.colins.com.tr refused with HTTP ${r.status}${usingProxy() ? ` (via ${country} proxy)` : " (direct egress)"}`);
      return null;
    }
    return await r.text();
  } catch (err) {
    console.warn(`live-lookup: www.colins.com.tr unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Pure: a fetched product page → LiveProduct (exported for tests). */
export function parseColinsPage(html: string, url: string): LiveProduct | null {
  const i = html.indexOf("window.insider_object.product");
  const block = i < 0 ? "" : html.slice(i, html.indexOf("}", i) + 1);
  const field = (k: string) => block.match(new RegExp(`"${k}":\\s*"?([^",\\n]*)"?`))?.[1]?.trim() ?? "";
  const id = field("group_code");
  const name = block.match(/"name":\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? "";
  const list = Number(field("unit_price"));
  const sale = Number(field("unit_sale_price"));
  const price = Number.isFinite(sale) && sale > 0 ? sale : list;
  if (!id || !name || !Number.isFinite(price) || price <= 0) return null;
  const tax = [...(block.match(/"taxonomy":\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/'([^']*)'/g)].map((m) => m[1].trim());
  const stocks = [...html.matchAll(/data-stock="(\w+)"\s+data-name="[^"]*"/g)].map((m) => m[1]);
  const inStock = stocks.length ? stocks.includes("havestock") : /schema\.org\/InStock/.test(html);
  const img = html.match(/"image":\s*\[\s*"([^"]+)"/)?.[1] ?? (field("product_image_url") || null);
  const category = tax.length ? tax[tax.length - 1] : null;
  const where = `${tax.join(" ")} ${name}`.toLocaleLowerCase("tr");
  const gender = /çocuk/.test(where) ? "cocuk" : /kad[ıi]n/.test(where) ? "kadin" : /erkek/.test(where) ? "erkek" : null;
  return {
    brand: "colins",
    externalId: id,
    name: name.trim(),
    url,
    imageUrl: img,
    price: Math.round(price * 100),
    listPrice: Number.isFinite(list) && list > price ? Math.round(list * 100) : null,
    inStock,
    category,
    type: classifyType(category, name, "colins"),
    gender,
    colorName: field("color") || null,
    country: "TR",
    currency: "TRY",
  };
}

export async function colinsUrl(url: string): Promise<LiveProduct | null> {
  if (!colinsId(url)) return null;
  const clean = `${SITE}${new URL(url).pathname}`;
  const html = await text(clean, countryFor("colins"));
  return html ? parseColinsPage(html, clean) : null;
}
