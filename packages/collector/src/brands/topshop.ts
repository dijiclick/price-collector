/**
 * Topshop (United Kingdom) — the relaunched topshop.com runs on ASOS's
 * "Chameleon" platform (Next.js, `x-powered-by: ASOS Chameleon`).
 *
 * Akamai there blocks BROWSER user agents (403 to a Chrome or Safari UA) but
 * serves the pages to a non-browser client: with an `okhttp/…` UA the Sale
 * category answers 200 from a GitHub runner, no proxy (probe 2026-10-11).
 * The ASOS product-search API on the same host refuses us ("Invalid Key Store
 * Data Version"), but it is not needed: every PLP page embeds its own result
 * set as `plpData` in the React Server Components payload — 72 products per
 * `?page=N`, each with current / previous price in GBP, colour and gallery.
 *
 * The Sale category (cid 53075, "Special Prices" in the nav) holds ~3k rows;
 * pages are read in order until the cap. The listing has no per-size stock.
 * Topshop is womenswear.
 */
import type { ProductRecord } from "../types";
import { getText } from "../http";
import { mapAsosProduct } from "./_asos";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "topshop";

const SITE = "https://www.topshop.com";
export const SALE_CID = 53075;
const PAGE_SIZE = 72;
const CAP = 1500;
const MAX_PAGES = 30;
const PAUSE_MS = 800;
/** Akamai lets non-browser clients through and 403s browser UAs. */
const HEADERS = { "User-Agent": "okhttp/4.12.0", Accept: "text/html" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const pageUrl = (page: number) => `${SITE}/gb/topshop/category/sale?cid=${SALE_CID}${page > 1 ? `&page=${page}` : ""}`;

/**
 * Pull `plpData` out of a Next.js App Router page: the RSC payload is a series
 * of `self.__next_f.push([1,"<js string>"])` calls whose decoded strings
 * concatenate into one stream; the object is cut out by brace matching.
 */
export function extractPlpData(html: string): { itemCount: number; products: any[] } | null {
  let stream = "";
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  for (let m; (m = re.exec(html)); ) {
    try {
      stream += JSON.parse(`"${m[1]}"`);
    } catch {
      /* a chunk that is not a plain string literal */
    }
  }
  const at = stream.indexOf('"plpData":');
  if (at < 0) return null;
  const start = stream.indexOf("{", at);
  let depth = 0;
  let inStr = false;
  for (let i = start; i < stream.length; i++) {
    const c = stream[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        const o = JSON.parse(stream.slice(start, i + 1));
        return { itemCount: Number(o?.itemCount ?? 0), products: Array.isArray(o?.products) ? o.products : [] };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Map one `plpData.products[]` row. Pure; null unless marked down. */
export function mapTopshop(p: any, country: CountryCode = "GB"): ProductRecord | null {
  return mapAsosProduct(p, {
    brand,
    country,
    gender: "kadin",
    // url: "topshop/<slug>/prd/<id>" → the market's PDP, /gb/product/<slug>/<id>.
    pdp: (url, id) => {
      const slug = url.split("/")[1];
      return slug ? `${SITE}/gb/product/${slug}/${id}` : `${SITE}/gb/${url}`;
    },
  });
}

export async function listProducts(country: CountryCode = "GB"): Promise<ProductRecord[]> {
  if (country !== "GB") return [];
  const byId = new Map<string, ProductRecord>();
  let total = Infinity;
  for (let page = 1; page <= MAX_PAGES && (page - 1) * PAGE_SIZE < total && byId.size < CAP; page++) {
    if (page > 1) await sleep(PAUSE_MS);
    const html = await getText(pageUrl(page), { country, headers: HEADERS });
    const plp = extractPlpData(html);
    if (!plp) {
      if (page === 1) throw new Error("topshop: no plpData on the sale page");
      break;
    }
    total = plp.itemCount;
    if (!plp.products.length) break;
    for (const p of plp.products) {
      const r = mapTopshop(p, country);
      if (r) byId.set(r.externalId, r);
    }
  }
  return [...byId.values()].slice(0, CAP);
}
