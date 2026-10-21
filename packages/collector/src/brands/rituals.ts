/**
 * Rituals (rituals.com) — Dutch body/beauty brand with its own shops in every
 * EU market. Next.js storefront over Algolia (app UXLMPRG4Y6, the public
 * search-only key the page ships in `ALGOLIA.KEY`), one index per market:
 * `prd_products_b2cweb_<cc>` (the storefront builds `${ENV}_products_b2cweb_${cc}`).
 *
 * Every hit carries the market's own `displayPrice` (what the PDP charges —
 * the JSON-LD offer price) and `originalPrice` (the price the page shows next
 * to it: struck, or labelled "RRP"/adviesprijs, `priceDisplayOptions.showAs`).
 * Rituals sells only its own products, so that RRP is its own regular price.
 * Discounted items are the outlet/sale shelf: `numericFilters originalPrice >
 * 0`, then `originalPrice > displayPrice` again per hit. One query of up to
 * 1,000 hits covers a market (≈600 discounted, measured 2026-10-21) — an
 * empty query without a filter is pinned to 10 hits by a query rule, the
 * filtered one is not.
 *
 * Home goods (candles, fragrance sticks, kitchen, car and dog products) are
 * dropped; body, beauty, hair, fragrance and gift sets stay. `inStockEcom`
 * says whether the web shop can sell it now; sold-out outlet rows are kept
 * (in stock first) so a restock is visible.
 */
import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const APP = "UXLMPRG4Y6";
const KEY = "01b84da08a5be7c3e98d5a01652402b2";
const ORIGIN = "https://www.rituals.com";
const HITS = 1000;
const CAP = 1500;

interface Market { cc: string; lang: string; currency: string }

/** Index suffix, the storefront language for URLs, and the currency the index prices in. */
export const RITUALS_MARKETS: Partial<Record<CountryCode, Market>> = {
  NL: { cc: "nl", lang: "nl", currency: "EUR" },
  BE: { cc: "be", lang: "nl", currency: "EUR" },
  DE: { cc: "de", lang: "de", currency: "EUR" },
  AT: { cc: "at", lang: "de", currency: "EUR" },
  FR: { cc: "fr", lang: "fr", currency: "EUR" },
  ES: { cc: "es", lang: "es", currency: "EUR" },
  IT: { cc: "it", lang: "it", currency: "EUR" },
  PT: { cc: "pt", lang: "pt", currency: "EUR" },
  IE: { cc: "ie", lang: "en", currency: "EUR" },
  FI: { cc: "fi", lang: "fi", currency: "EUR" },
  SE: { cc: "se", lang: "sv", currency: "SEK" },
  DK: { cc: "dk", lang: "da", currency: "DKK" },
  GB: { cc: "gb", lang: "en", currency: "GBP" },
  CH: { cc: "ch", lang: "de", currency: "CHF" },
};

/** Top-level sections / category slugs that are not personal care. */
const NON_BEAUTY = /^(home|kitchen|car_|dog|tea|laundry|towels|bed|cushion|throws|bath_mats|home_decoration|bathroom_accessories|bathrobes|memorial|washingup|aromatherapy|fragrance_sticks|scented_candles|luxury_scented|classic_scented|large_candles|room_sprays|diffusers|gift_cards|umbrellas)/;

export function ritualsQuery(lang: string): string {
  const attrs = [
    "objectID", "productTitle_en", `productTitle_${lang}`, `slug_${lang}`, "slug_en",
    "shortProductDescription_en", "primaryImage", "displayPrice", "originalPrice",
    "inStockEcom", "categoryHierarchy", "categories", "eanCode", "collection",
  ];
  const p = new URLSearchParams({
    query: "",
    hitsPerPage: String(HITS),
    numericFilters: JSON.stringify(["originalPrice.default>0"]),
    attributesToRetrieve: JSON.stringify(attrs),
    attributesToHighlight: "[]",
  });
  return JSON.stringify({ params: p.toString() });
}

/** One Algolia hit → a record, or null when it is not a real markdown or not personal care. Pure. */
export function mapRitualsHit(h: any, country: CountryCode, m: Market): ProductRecord | null {
  const price = Number(h?.displayPrice?.default);
  const was = Number(h?.originalPrice?.default);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(was) || was <= price) return null;
  const lvl0 = String(h?.categoryHierarchy?.lvl0 ?? "");
  const cats: string[] = Array.isArray(h?.categories) ? h.categories.map(String) : [];
  if (/^home$/i.test(lvl0) || cats.some((c) => NON_BEAUTY.test(c))) return null;
  const id = String(h?.objectID ?? "");
  const name = String(h?.productTitle_en || h?.[`productTitle_${m.lang}`] || "").trim();
  const slug = String(h?.[`slug_${m.lang}`] || h?.slug_en || "");
  if (!id || !name || !slug.startsWith("/")) return null;
  const desc = String(h?.shortProductDescription_en ?? "").trim();
  const lvl = [h?.categoryHierarchy?.lvl2, h?.categoryHierarchy?.lvl1, lvl0].find((x) => typeof x === "string" && x);
  const img = typeof h?.primaryImage === "string" && /^https?:\/\//.test(h.primaryImage) ? h.primaryImage : null;
  return {
    brand: "rituals",
    country,
    externalId: id,
    // The title is a ritual name ("Skin Revive Glow Mask"); the short description says what it is.
    name: desc && !name.toLowerCase().includes(desc.toLowerCase()) ? `${name} – ${desc}` : name,
    url: `${ORIGIN}${slug}`,
    imageUrl: img,
    images: img ? [img] : null,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: m.currency,
    inStock: h?.inStockEcom === true,
    barcodes: typeof h?.eanCode === "string" && /^\d{8,14}$/.test(h.eanCode) ? [h.eanCode] : null,
    category: lvl ?? null,
    gender: /for him|men\b/i.test(String(h?.categoryHierarchy?.lvl1 ?? "")) ? "erkek" : null,
  };
}

/** Register as `listRituals(country)`. NL BE DE AT FR ES IT PT IE FI SE DK GB CH. */
export async function listRituals(country: CountryCode): Promise<ProductRecord[]> {
  const m = RITUALS_MARKETS[country];
  if (!m) return [];
  const res = await getJson<any>(`https://${APP}-dsn.algolia.net/1/indexes/prd_products_b2cweb_${m.cc}/query`, {
    method: "POST",
    country,
    headers: {
      "X-Algolia-Application-Id": APP,
      "X-Algolia-API-Key": KEY,
      "Content-Type": "application/json",
      Origin: ORIGIN,
      Referer: `${ORIGIN}/`,
    },
    body: ritualsQuery(m.lang),
  });
  const hits: any[] = Array.isArray(res?.hits) ? res.hits : [];
  const total = Number(res?.nbHits ?? 0);
  if (!hits.length) throw new Error(`rituals ${country}: 0 discounted hits`);
  if (total > hits.length) throw new Error(`rituals ${country}: ${total} discounted hits, page holds ${hits.length}`);
  const byId = new Map<string, ProductRecord>();
  for (const h of hits) {
    const r = mapRitualsHit(h, country, m);
    if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
  }
  return [...byId.values()].sort((a, b) => Number(b.inStock) - Number(a.inStock)).slice(0, CAP);
}
