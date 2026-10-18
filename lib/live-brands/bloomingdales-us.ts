/**
 * Bloomingdale's US by url (`www.bloomingdales.com/shop/product/<slug>?ID=<n>`).
 * The site's own product feed, `/xapi/digital/v1/product/<id>`, answers 200
 * JSON to US datacenter egress (GitHub probe 39135342727, 2026-10-18) while
 * the HTML page is Akamai-walled; it is geo-filtered, so it 403s from Turkey.
 * Prices come from the same shelf ladder the collector reads
 * (packages/collector/src/brands/bloomingdales-us.ts): tier 0 regular,
 * tier 1 the shelf sale, single values only; badge promos are never read.
 * The id is the product id, as the collector's. bloomingdales.ae is a
 * different store and returns null here.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, json, toMinor } from "../live-http";

const SITE = "https://www.bloomingdales.com";
const IMG = "https://images.bloomingdalesassets.com/is/image/BLM/products/";

/** The product id out of a bloomingdales.com product url, or null. */
export function bloomingdalesUsIdFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)bloomingdales\.com$/i.test(u.hostname)) return null;
  const q = u.searchParams.get("ID") ?? u.searchParams.get("id");
  if (q && /^\d+$/.test(q) && /\/product\//.test(u.pathname)) return q;
  const m = u.pathname.match(/\/xapi\/digital\/v1\/product\/(\d+)/);
  return m ? m[1] : null;
}

const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&([a-z])(acute|grave|circ|uml|tilde|cedil);/gi, (_, l, a) =>
      (l + ({ acute: "́", grave: "̀", circ: "̂", uml: "̈", tilde: "̃", cedil: "̧" } as Record<string, string>)[a.toLowerCase()]).normalize("NFC"))
    .replace(/\s+/g, " ")
    .trim();

/** {price, list} from the tiered shelf price: a clean single-value reduction, else the single regular price. */
export function ladderPrice(tiers: any): { price: number; list: number | null } | null {
  if (!Array.isArray(tiers) || !tiers.length) return null;
  const rv = tiers[0]?.values ?? [];
  if (rv.length !== 1 || rv[0]?.type !== "regular" || /value/i.test(String(tiers[0]?.label ?? ""))) return null;
  const reg = Number(rv[0].value);
  if (!(reg > 0)) return null;
  const dv = tiers[1]?.values ?? [];
  const okLabel = /^\s*(sale|now|your choice|clearance)\s*\[PRICE\]\s*$/i.test(String(tiers[1]?.label ?? ""));
  if (tiers.length >= 2 && okLabel && dv.length === 1 && dv[0]?.type === "discount") {
    const sale = Number(dv[0].value);
    if (sale > 0 && sale < reg) return { price: sale, list: reg };
  }
  return { price: reg, list: null };
}

/** Map a `/xapi/digital/v1/product/<id>` body. Pure. */
export function mapBloomingdalesUsProduct(body: any): LiveProduct | null {
  const p = Array.isArray(body?.product) ? body.product[0] : null;
  const id = p?.id != null ? String(p.id) : "";
  const title = decode(String(p?.detail?.name ?? ""));
  if (!id || !title) return null;
  const pr = ladderPrice(p?.pricing?.price?.tieredPrice);
  if (!pr) return null;
  const b = p?.detail?.brand;
  const make = decode(String((typeof b === "string" ? b : b?.name) ?? ""));
  const name = make && !title.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${title}` : title;
  const sel = p?.traits?.colors?.selectedColor;
  const colour = sel != null ? p?.traits?.colors?.colorMap?.[sel] : null;
  const file = colour?.imagery?.images?.[0]?.filePath ?? p?.imagery?.images?.[0]?.filePath;
  const top = String(p?.identifier?.topLevelCategoryName ?? "");
  const path = String(p?.identifier?.productUrl ?? `/shop/product/-?ID=${id}`);
  return {
    brand: "bloomingdales",
    externalId: id,
    name,
    url: SITE + path,
    imageUrl: typeof file === "string" ? `${IMG}${file}?wid=1200&fmt=jpeg&qlt=85` : null,
    price: toMinor(pr.price),
    listPrice: pr.list != null ? toMinor(pr.list) : null,
    inStock: p?.availability?.available === true,
    category: p?.detail?.typeName ? String(p.detail.typeName).toLowerCase().replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase()) : null,
    type: null,
    gender: /^women/i.test(top) ? "kadin" : /^men/i.test(top) ? "erkek" : /^kids/i.test(top) ? "cocuk" : null,
    colorName: colour?.name ? decode(String(colour.name)) : null,
    country: "US",
    currency: "USD",
  };
}

export async function bloomingdalesUsUrl(url: string): Promise<LiveProduct | null> {
  const id = bloomingdalesUsIdFromUrl(url);
  if (!id) return null;
  const body = await json<any>(
    `${SITE}/xapi/digital/v1/product/${id}`,
    { Accept: "application/json", "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
    countryFor("bloomingdales", "us"),
  );
  return body ? mapBloomingdalesUsProduct(body) : null;
}
