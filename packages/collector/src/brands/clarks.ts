/**
 * Clarks (clarks.com) — US and Canada. The Next.js storefront on commercetools
 * is Cloudflare-walled for most networks (403 from the Mac and from Hetzner;
 * open to GitHub's runners), but its product grids are Algolia: app
 * KIJ46SYMWD, public search-only key and per-locale index map in the
 * storefront bundle (2026-10-21) — `prod_product_us` (~1,130 products, USD)
 * and `prod_product_ca` (~1,100, CAD).
 *
 * Each hit carries commercetools money: `price` and `wasPrice`
 * ({centAmount, currencyCode}); a reduction is wasPrice > price
 * (`priceType` "sale", ~170 in the US). "promotional" rows have price ==
 * wasPrice (the promotion is applied in the basket) and are skipped. The
 * index is small, so the whole of it is read (2 pages) and filtered here.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";

const APP = "KIJ46SYMWD";
const KEY = "4e28949f630787f93a3ee5d8b6ede50e";
const MARKETS: Partial<Record<CountryCode, { index: string; locale: string; path: string; currency: string }>> = {
  US: { index: "prod_product_us", locale: "en-US", path: "en-us", currency: "USD" },
  CA: { index: "prod_product_ca", locale: "en-CA", path: "en-ca", currency: "CAD" },
};
const PER_PAGE = 1000;
const MAX_PAGES = 5;
const PAUSE_MS = Number(process.env.CLARKS_PAUSE_MS ?? 800);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function genderOf(g: unknown): ProductRecord["gender"] {
  const list = (Array.isArray(g) ? g : [g]).map((x) => String(x ?? "").toLowerCase());
  if (list.some((x) => /kid|boy|girl|infant|junior/.test(x))) return "cocuk";
  const w = list.includes("womens");
  const m = list.includes("mens");
  return w && !m ? "kadin" : m && !w ? "erkek" : null;
}

/** One Algolia hit → a record, or null without a reduction. Pure. */
export function mapClarks(h: any, country: CountryCode): ProductRecord | null {
  const m = MARKETS[country];
  if (!m) return null;
  const price = Number(h?.price?.centAmount);
  const was = Number(h?.wasPrice?.centAmount);
  const name = h?.[`name.${m.locale}`];
  const slug = h?.[`slug.${m.locale}`];
  if (!h?.objectID || !name || !slug || !Number.isInteger(price) || price <= 0 || !Number.isInteger(was) || was <= price) return null;
  if (h.price.currencyCode !== m.currency || (h.wasPrice.currencyCode && h.wasPrice.currencyCode !== m.currency)) return null;
  if (h.price.fractionDigits != null && h.price.fractionDigits !== 2) return null;
  const images = cleanGallery((h.images ?? []).filter((u: unknown) => typeof u === "string"));
  const sub = h[`productSubTypes.${m.locale}`];
  const colour = String(h[`mediumColor.${m.locale}`] ?? "").trim();
  return {
    brand: "clarks",
    country,
    externalId: String(h.objectID),
    name: String(name).replace(/\s+/g, " ").trim(),
    url: `https://www.clarks.com/${m.path}/${slug}/${h.objectID}-p`,
    imageUrl: images?.[0] ?? null,
    images,
    price,
    listPrice: was,
    currency: m.currency,
    inStock: h.inStock !== false,
    category: (Array.isArray(sub) && sub[0]) || (h.coreProductType === "shoe" ? "Shoes" : h.coreProductType ?? null),
    gender: genderOf(h[`gender.${m.locale}`]),
    variants: null,
    groupKey: null,
    colorName: colour || null,
  };
}

/** Register as `listClarks(country)`. US + CA. */
export async function listClarks(country: CountryCode): Promise<ProductRecord[]> {
  const m = MARKETS[country];
  if (!m) return [];
  const byId = new Map<string, ProductRecord>();
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) throw new Error(`clarks/${country}: index exceeds ${MAX_PAGES * PER_PAGE} products`);
    if (page > 0) await sleep(PAUSE_MS);
    const data = await getJson<any>(`https://${APP}-dsn.algolia.net/1/indexes/${m.index}/query`, {
      method: "POST",
      country,
      headers: { "X-Algolia-Application-Id": APP, "X-Algolia-API-Key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "", page, hitsPerPage: PER_PAGE, attributesToHighlight: [] }),
    });
    const hits: any[] = data?.hits;
    if (!Array.isArray(hits)) throw new Error(`clarks/${country}: Algolia page ${page} returned no hits array`);
    for (const h of hits) {
      const r = mapClarks(h, country);
      if (r) byId.set(r.externalId, r);
    }
    if (page + 1 >= Number(data.nbPages ?? 0)) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)];
}
