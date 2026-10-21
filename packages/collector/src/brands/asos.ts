/**
 * ASOS (United Kingdom + its EU stores) through the product-search API its own
 * category pages call:
 *
 *   https://www.asos.com/api/product/search/v2/categories/<cid>?offset=&limit=200&store=COM&lang=en-GB&currency=GBP&country=GB
 *
 * The www HTML is Akamai-walled to scripted clients, but this API path answers
 * a plain GET from a GitHub runner (probe run 38136892282, 2026-10-11), with
 * no key-store version needed. Up to 200 products per call, deep offsets work.
 *
 * ASOS is a multi-brand shop (its own ASOS DESIGN plus ~600 others), so this
 * is the "Çok markalı" ASOS feed. The Sale categories hold ~33k (women) and
 * ~11k (men); the cap is split between them. The listing has current and
 * previous price in the store's currency but no stock or sizes.
 *
 * EU stores (2026-10-21): the same category ids answer per `store` — FR, DE, ES,
 * IT, NL, SE (SEK), DK (DKK) have their own store and language; Ireland,
 * Belgium, Portugal and Finland are served by ASOS's euro "rest of Europe"
 * store (`ROE`, English), Austria by the German store. A store/country pair
 * ASOS does not serve answers 400, which the run surfaces as an error.
 *
 * Note: from this Mac (Turkish line) www.asos.com only answers over IPv4.
 */
import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { mapAsosProduct } from "./_asos";

export const brand = "asos";

const SITE = "https://www.asos.com";
const LIMIT = 200;
const CAP = 1500;
const PAUSE_MS = 700;
const HEADERS = { "User-Agent": "okhttp/4.12.0", Accept: "application/json" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** API store + language per market, and the storefront path its PDP links live under. */
export const ASOS_MARKETS: Partial<Record<CountryCode, { store: string; lang: string; path: string }>> = {
  GB: { store: "COM", lang: "en-GB", path: "" },
  FR: { store: "FR", lang: "fr-FR", path: "/fr" },
  DE: { store: "DE", lang: "de-DE", path: "/de" },
  AT: { store: "DE", lang: "de-DE", path: "/de" },
  ES: { store: "ES", lang: "es-ES", path: "/es" },
  IT: { store: "IT", lang: "it-IT", path: "/it" },
  NL: { store: "NL", lang: "nl-NL", path: "/nl" },
  SE: { store: "SE", lang: "sv-SE", path: "/se" },
  DK: { store: "DK", lang: "da-DK", path: "/dk" },
  IE: { store: "ROE", lang: "en-GB", path: "" },
  BE: { store: "ROE", lang: "en-GB", path: "" },
  PT: { store: "ROE", lang: "en-GB", path: "" },
  FI: { store: "ROE", lang: "en-GB", path: "" },
};

/** Sale category ids with their section gender and share of the cap (global across stores). */
export const SALE: [cid: number, gender: ProductRecord["gender"], share: number][] = [
  [7046, "kadin", 1200], // Women > Sale
  [8409, "erkek", 300], // Men > Sale
];

export const pageUrl = (cid: number, offset: number, country: CountryCode = "GB") => {
  const m = ASOS_MARKETS[country];
  if (!m) throw new Error(`asos: no store for ${country}`);
  return (
    `${SITE}/api/product/search/v2/categories/${cid}?offset=${offset}&limit=${LIMIT}` +
    `&store=${m.store}&lang=${m.lang}&currency=${COUNTRIES[country].currency}&country=${country}&rowlength=4&channel=desktop-web`
  );
};

export function mapAsos(p: any, gender: ProductRecord["gender"], country: CountryCode = "GB"): ProductRecord | null {
  const path = ASOS_MARKETS[country]?.path ?? "";
  return mapAsosProduct(p, { brand, country, gender, pdp: (url) => `${SITE}${path}/${url}` });
}

export async function listProducts(country: CountryCode = "GB"): Promise<ProductRecord[]> {
  if (!ASOS_MARKETS[country]) return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const [cid, gender, share] of SALE) {
    const before = byId.size;
    for (let offset = 0; offset < share; offset += LIMIT) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      const d = await getJson<any>(pageUrl(cid, offset, country), { country, headers: HEADERS });
      const rows: any[] = d?.products ?? [];
      for (const p of rows) {
        const r = mapAsos(p, gender, country);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
        if (byId.size - before >= share) break;
      }
      if (rows.length < LIMIT || offset + LIMIT >= Number(d?.itemCount ?? 0)) break;
    }
  }
  return [...byId.values()].slice(0, CAP);
}
