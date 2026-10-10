/**
 * LC Waikiki by url (`lcw.com/<slug>-o-<optionId>`). The product page is
 * server-rendered: a schema.org Product (name, images, the basket price the
 * shop charges) plus the size picker's `new SingleSizeProduct(…)` calls, which
 * carry per-size stock and the struck-through price. Akamai refuses Node's
 * default fetch, hence the shared browser-shaped HTTP/2 request.
 *
 * The id is the colour option — what the collector stores (`OptionId`).
 */
import type { LiveProduct } from "../live-lookup";
import { countryFor } from "../live-http";
import { classifyType } from "../productTypes";
import { browserText, decodeEntities, trMoney } from "./_browser";

const SITE = "https://www.lcw.com";

export function lcwOptionId(url: string): string | null {
  try {
    const u = new URL(url);
    return u.pathname.match(/-o-(\d{5,})\/?$/)?.[1] ?? null;
  } catch { return null; }
}

function jsonLdProduct(html: string): any | null {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(m[1]);
      if (d?.["@type"] === "Product") return d;
    } catch { /* next block */ }
  }
  return null;
}

/** Pure: a fetched product page → LiveProduct (exported for tests). */
export function parseLcwPage(html: string, optionId: string, url: string): LiveProduct | null {
  const ld = jsonLdProduct(html);
  const sizes = [...html.matchAll(/new SingleSizeProduct\(([^)]*)\)/g)]
    // Quoted args hold Turkish decimals ('649,99'), so split on commas OUTSIDE quotes.
    .map((m) => (m[1].match(/'[^']*'|[^,\s][^,]*/g) ?? []).map((a) => a.trim().replace(/^'|'$/g, "")))
    .filter((a) => a[0] === optionId);
  // Size rows: [optionId, productId, sizeId, label, order, stock, price, …, oldPrice, 'TL', …]
  const rowPrice = sizes.length ? trMoney(sizes[0][6]) : NaN;
  const rowOld = sizes.length ? trMoney(sizes[0][8]) : NaN;
  const price = Number(ld?.offers?.price) > 0 ? Number(ld.offers.price) : rowPrice;
  if (!ld?.name || !Number.isFinite(price) || price <= 0) return null;
  const inStock = sizes.length
    ? sizes.some((a) => Number(a[5]) > 0)
    : /InStock/.test(String(ld.offers?.availability ?? ""));
  const colour = html.match(new RegExp(`new Option\\(${optionId}\\s*,\\s*'([^']*)'`))?.[1];
  const sex = (ld.additionalProperty ?? []).find((p: any) => p?.name === "Cinsiyet")?.value ?? "";
  const s = String(sex).toLocaleLowerCase("tr");
  const gender = /çocuk|bebek/.test(s) ? "cocuk" : s.startsWith("kad") ? "kadin" : s.startsWith("erkek") ? "erkek" : null;
  const category = String(ld.category ?? "").split(">").pop()?.trim() || null;
  const name = decodeEntities(String(ld.name)).trim();
  const image = Array.isArray(ld.image) ? ld.image[0] : ld.image;
  return {
    brand: "lcw",
    externalId: optionId,
    name,
    url,
    imageUrl: typeof image === "string" ? image : null,
    price: Math.round(price * 100),
    listPrice: Number.isFinite(rowOld) && rowOld > price ? Math.round(rowOld * 100) : null,
    inStock,
    category,
    type: classifyType(category, name, "lcw"),
    gender,
    colorName: colour ? decodeEntities(colour).trim() || null : null,
    country: "TR",
    currency: "TRY",
  };
}

export async function lcwUrl(url: string): Promise<LiveProduct | null> {
  const id = lcwOptionId(url);
  if (!id) return null;
  const clean = `${SITE}${new URL(url).pathname}`;
  const html = await browserText(clean, { country: countryFor("lcw"), order: "proxy-first" });
  return html ? parseLcwPage(html, id, clean) : null;
}
