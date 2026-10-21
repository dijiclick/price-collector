/**
 * Gina Tricot through the Unbxd search API its own Next.js frontend calls
 * (2026-10-11). The site key and api key per market are public — they ship in
 * the storefront's JS bundle — and search.unbxd.io answers a plain GET with no
 * cookie. No proxy.
 *
 * One `category` call per 100 rows returns, per product: `price` (original) and
 * `sellingPrice` (current), both NOK major units, the product url, every photo,
 * and `sizes` — a Python-literal string `[{'sku': …, 'size': '38', 'qty': 12}, …]`
 * with live per-size stock, which is what powers size-restock alerts.
 *
 * The sale lives in category `124894` (`/no/salg/allsale`, ~850 rows). A few of
 * its rows are not actually reduced (sellingPrice == price) and are dropped.
 * "Young Gina" / "Young 14" rows are the girls' line (sizes 134–170) → cocuk.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "ginatricot";

export const GINATRICOT_MARKETS: Partial<Record<CountryCode, { siteKey: string; apiKey: string; saleId: string }>> = {
  NO: {
    siteKey: "ss-unbxd-auk-prod-ginatricot-no73331773038139",
    apiKey: "1a4505584344dacf9a49c8694e06917a",
    saleId: "124894",
  },
  // 2026-10-21: the other markets' keys sit next to NO's in the storefront's env
  // chunk (`unbxd.keys`); the all-sale category id is the same everywhere.
  SE: { siteKey: "ss-unbxd-auk-prod-ginatricot-se73331773038031", apiKey: "278db028d5858283939019aa24d00bb1", saleId: "124894" },
  FI: { siteKey: "ss-unbxd-auk-prod-ginatricot-fi73331773038053", apiKey: "3e09ec3ac7e99681e11a58293a2e10aa", saleId: "124894" },
  DK: { siteKey: "ss-unbxd-auk-prod-ginatricot-dk73331773038027", apiKey: "980c21993b1b28d55a3f06642475659a", saleId: "124894" },
  NL: { siteKey: "ss-unbxd-auk-prod-ginatricot-nl73331773038110", apiKey: "14eb2d4e940f165ef2c916df5c5eb3f2", saleId: "124894" },
  DE: { siteKey: "ss-unbxd-auk-prod-ginatricot-de73331773041373", apiKey: "ecaef10895dc1985a602dfbef67b79ff", saleId: "124894" },
  FR: { siteKey: "ss-unbxd-auk-prod-ginatricot-fr73331773038896", apiKey: "2a0e2f5606d0b13d1db9121e81dbb6e5", saleId: "124894" },
  AT: { siteKey: "ss-unbxd-auk-prod-ginatricot-at73331773038029", apiKey: "a9d3d4647a3dde29787d57181b6b8d50", saleId: "124894" },
  // The "EU" storefront (ginatricot.com/eu, EUR, "customers all over Europe") serves every EU country without its own site.
  BE: { siteKey: "ss-unbxd-auk-prod-ginatricot-eu73331773038202", apiKey: "5162337a60bb5ea3efaff3a08836199d", saleId: "124894" },
  IE: { siteKey: "ss-unbxd-auk-prod-ginatricot-eu73331773038202", apiKey: "5162337a60bb5ea3efaff3a08836199d", saleId: "124894" },
};

const ROWS = 100;
const MAX_PAGES = Number(process.env.GINATRICOT_MAX_PAGES ?? 20);
const CAP = 1500;
const FIELDS = [
  "uniqueId", "title", "price", "sellingPrice", "currency", "sizes", "availability", "productUrl",
  "imageUrl", "categories", "categoryPath1", "color", "styleId",
].join(",");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function saleUrl(country: CountryCode, start: number): string {
  const m = GINATRICOT_MARKETS[country]!;
  return `https://search.unbxd.io/${m.apiKey}/${m.siteKey}/category?p-id=${encodeURIComponent(`"${m.saleId}"`)}` +
    `&rows=${ROWS}&start=${start}&fields=${FIELDS}`;
}

/** Parse the `sizes` Python-literal string into per-size availability. */
export function parseSizes(raw: unknown): SizeVariant[] {
  if (typeof raw !== "string") return [];
  const out: SizeVariant[] = [];
  for (const obj of raw.match(/\{[^}]*\}/g) ?? []) {
    const size = /'size':\s*'([^']*)'/.exec(obj)?.[1]?.trim();
    const qty = Number(/'qty':\s*(-?\d+)/.exec(obj)?.[1] ?? NaN);
    if (!size || !Number.isFinite(qty)) continue;
    out.push({ label: size, availability: qty <= 0 ? "out_of_stock" : qty <= 2 ? "low_on_stock" : "in_stock" });
  }
  return out;
}

export function mapGinaTricot(p: any, country: CountryCode = "NO"): ProductRecord | null {
  const id = p?.uniqueId ?? p?.id;
  const price = Number(p?.sellingPrice);
  const list = Number(p?.price);
  if (!id || !p?.title || !p?.productUrl || !(price > 0)) return null;
  const sizes = parseSizes(p.sizes);
  const imgs: string[] = Array.isArray(p.imageUrl) ? p.imageUrl : typeof p.imageUrl === "string" ? [p.imageUrl] : [];
  const top: string[] = Array.isArray(p.categoryPath1) ? p.categoryPath1 : [];
  const colour = Array.isArray(p.color) ? p.color[0] : p.color;
  const inStock = sizes.length ? sizes.some((s) => s.availability !== "out_of_stock") : p.availability === "true";
  return {
    brand,
    country,
    externalId: String(id),
    name: String(p.title).trim(),
    url: String(p.productUrl),
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: list > price ? toMinor(list) : null,
    currency: COUNTRIES[country].currency,
    inStock,
    category: Array.isArray(p.categories) && p.categories[0] ? String(p.categories[0]) : null,
    gender: top.some((c) => /^young/.test(c)) ? "cocuk" : "kadin",
    variants: sizes.length ? { colors: colour ? [String(colour)] : [], sizes } : null,
    groupKey: p.styleId ? `${brand}:${p.styleId}` : null,
    colorName: colour ? String(colour) : null,
  };
}

export async function listGinaTricot(country: CountryCode = "NO"): Promise<ProductRecord[]> {
  if (!GINATRICOT_MARKETS[country]) return [];
  const want = COUNTRIES[country].currency;
  const byId = new Map<string, ProductRecord>();
  let total = Infinity;
  for (let page = 0; page < MAX_PAGES && page * ROWS < total; page++) {
    if (page > 0) await sleep(600);
    const data = await getJson<any>(saleUrl(country, page * ROWS), { country });
    const rows: any[] = data?.response?.products ?? [];
    total = Number(data?.response?.numberOfProducts ?? 0);
    if (!rows.length) break;
    for (const p of rows) {
      if (p?.currency && p.currency !== want) throw new Error(`ginatricot/${country}: got ${p.currency}, want ${want}`);
      const r = mapGinaTricot(p, country);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listGinaTricot;
