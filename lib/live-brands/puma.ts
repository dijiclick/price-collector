/**
 * Puma Turkey by url. tr.puma.com is Magento 2 with GraphQL disabled, so the
 * lookup reads the product page: JSON-LD for the name, and Magento's
 * `spConfig` for THIS colour's price and per-size salability (one page holds
 * every colour of the style). The url names the colour — `…-402916-02.html` is
 * style 402916, colour 02 — and `402916_02` is the id the collector stores
 * (packages/collector/src/brands/puma.ts).
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, dispatcher, toMinor } from "../live-http";

const SITE = "https://tr.puma.com";

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
      console.warn(`live-lookup: tr.puma.com refused with HTTP ${r.status}`);
      return null;
    }
    return await r.text();
  } catch (err) {
    console.warn(`live-lookup: tr.puma.com unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** `{ style, colour }` from a tr.puma.com product url. */
export function parsePumaUrl(url: string): { style: string; colour: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/puma\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/-(\d{6})-(\d{2})\.html$/);
  return m ? { style: m[1], colour: m[2] } : null;
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

function productLd(page: string): any | null {
  for (const m of page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(m[1]);
      if (d?.["@type"] === "Product") return d;
    } catch { /* not this block */ }
  }
  return null;
}

export function mapPumaPage(page: string, style: string, colour: string, url: string): LiveProduct | null {
  const ld = productLd(page);
  const at = page.indexOf('"spConfig"');
  const cfg = at >= 0 ? objectAt(page, at + 10) : null;
  const attrs: any[] = Object.values(cfg?.attributes ?? {});
  const colourAttr = attrs.find((a) => a?.code === "color");
  const codeRe = new RegExp(`/${style}/${colour}/`);
  // The colour option whose children's photos live under /<style>/<colour>/.
  const opt = (colourAttr?.options ?? []).find((o: any) =>
    (o.all_products ?? o.products ?? []).some((c: string) =>
      (cfg?.images?.[c] ?? []).some((im: any) => codeRe.test(String(im?.img ?? im?.full ?? ""))),
    ),
  );
  const children: string[] = (opt?.all_products ?? opt?.products ?? []).map(String);
  const priced = children.find((c) => cfg?.optionPrices?.[c]);
  const op = priced ? cfg.optionPrices[priced] : null;
  let price = Number(op?.finalPrice?.amount);
  let old = Number(op?.oldPrice?.amount);
  if (!Number.isFinite(price) || price <= 0) {
    // No configurable data (simple product): the page's own offer.
    price = Number(ld?.offers?.price);
    old = NaN;
  }
  const name = String(ld?.name ?? "").trim();
  if (!name || !Number.isFinite(price) || price <= 0) return null;
  const inStock = opt
    ? (opt.products ?? []).length > 0
    : !/OutOfStock/i.test(String(ld?.offers?.availability ?? ""));
  const g = name;
  return {
    brand: "puma",
    externalId: `${style}_${colour}`,
    name,
    url: url.split(/[?#]/)[0],
    imageUrl: `https://images.puma.com/image/upload/f_auto,q_auto,b_rgb:fafafa,e_sharpen/global/${style}/${colour}/sv01/fnd/TUR/w/560/h/560/fmt/png`,
    price: toMinor(price),
    listPrice: Number.isFinite(old) && old > price ? toMinor(old) : null,
    inStock,
    category: null,
    type: null,
    gender: /[çc]ocuk|bebek|gen[çc]/i.test(g) ? "cocuk" : /kad[ıi]n/i.test(g) ? "kadin" : /erkek/i.test(g) ? "erkek" : null,
    colorName: opt?.label ?? (typeof ld?.color === "string" ? ld.color : null),
    country: "TR",
    currency: "TRY",
  };
}

export async function pumaUrl(url: string): Promise<LiveProduct | null> {
  const p = parsePumaUrl(url);
  if (!p) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const page = await html(`${SITE}${u.pathname}`, countryFor("puma"));
  return page ? mapPumaPage(page, p.style, p.colour, `${SITE}${u.pathname}`) : null;
}
