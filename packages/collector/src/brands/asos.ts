/**
 * ASOS (United Kingdom) through the product-search API its own category pages
 * call:
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
 * previous price in GBP but no stock or sizes.
 *
 * Note: from this Mac (Turkish line) www.asos.com only answers over IPv4.
 */
import type { ProductRecord } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";
import { mapAsosProduct } from "./_asos";

export const brand = "asos";

const SITE = "https://www.asos.com";
const LIMIT = 200;
const CAP = 1500;
const PAUSE_MS = 700;
const HEADERS = { "User-Agent": "okhttp/4.12.0", Accept: "application/json" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sale category ids with their section gender and share of the cap. */
export const SALE: [cid: number, gender: ProductRecord["gender"], share: number][] = [
  [7046, "kadin", 1200], // Women > Sale
  [8409, "erkek", 300], // Men > Sale
];

export const pageUrl = (cid: number, offset: number) =>
  `${SITE}/api/product/search/v2/categories/${cid}?offset=${offset}&limit=${LIMIT}` +
  `&store=COM&lang=en-GB&currency=GBP&country=GB&rowlength=4&channel=desktop-web`;

export function mapAsos(p: any, gender: ProductRecord["gender"], country: CountryCode = "GB"): ProductRecord | null {
  return mapAsosProduct(p, { brand, country, gender, pdp: (url) => `${SITE}/${url}` });
}

export async function listProducts(country: CountryCode = "GB"): Promise<ProductRecord[]> {
  if (country !== "GB") return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const [cid, gender, share] of SALE) {
    const before = byId.size;
    for (let offset = 0; offset < share; offset += LIMIT) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      const d = await getJson<any>(pageUrl(cid, offset), { country, headers: HEADERS });
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
