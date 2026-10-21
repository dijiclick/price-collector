/**
 * Gap Inc. — Gap, Old Navy, Banana Republic, Athleta — through the catalogue
 * search API the storefronts' own category pages call (2026-10-11):
 *
 *   https://api.gap.com/commerce/search/products/v2/cc?brand=on&market=us&locale=en_US&cid=26190&pageSize=200&pageNumber=0
 *
 * No key, no cookie, no bot wall on api.gap.com (the www hosts sit behind
 * Akamai and geo-redirect non-US visitors to a franchise page; the API does
 * not). Prices are major-unit strings in the market's own currency (USD on
 * *.gap.com, CAD on *.gapcanada.ca); `effectivePrice` < `regularPrice` is the
 * discount, and only those colourways are kept.
 *
 * One record per colourway (`ccId`, which is also the PDP `pid`), grouped by
 * style. The listing carries colour-level stock ("In Stock" / "Low" /
 * "Very Low" / "Out of Stock") but NOT per-size stock — sizes would need one
 * PDP call per style, far over the request budget — so `variants` is null.
 *
 * The category ids are each brand's department "Sale"/"Clearance" pages, read
 * from the sites' mega-nav (`"type":"sale"` nodes) on 2026-10-11. They have been
 * stable for years (Old Navy women's sale 26190, Gap women's sale 65179), and a
 * retired id answers 404/empty, which just drops that department.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export type GapIncSlug = "gap" | "oldnavy" | "bananarepublic" | "athleta" | "gapfactory" | "brfactory";
type Gender = ProductRecord["gender"];

interface GapMarket {
  /** Storefront origin, for PDP links and image paths. */
  site: string;
  /** Sale / clearance category ids, each with the section's gender. */
  cids: [cid: string, gender: Gender][];
}
interface GapBrand {
  /** The API's brand code. */
  code: string;
  markets: Partial<Record<CountryCode, GapMarket>>;
}

const ON_CIDS: GapMarket["cids"] = [
  ["26190", "kadin"], ["96964", "kadin"], // women sale / clearance
  ["26061", "erkek"], ["97035", "erkek"], // men
  ["26175", "cocuk"], ["96906", "cocuk"], // girls
  ["26073", "cocuk"], ["96945", "cocuk"], // boys
  ["26231", "kadin"], ["96949", "kadin"], // women's plus
  ["3043045", "cocuk"], ["3043099", "cocuk"], // toddler, baby
  ["26239", "kadin"], // maternity
];
const BR_CIDS: GapMarket["cids"] = [["26495", "kadin"], ["26219", "erkek"]];
// Factory (outlet) stores: same API, brand codes gapfs / brfs, and the same
// category ids on .com and .ca. Their clearance nodes, read from the mega-nav
// on 2026-10-12. The "extra N% off" is a checkout promo, not in effectivePrice.
const GAPFS_CIDS: GapMarket["cids"] = [
  ["1042792", "kadin"], ["1042764", "erkek"], // women, men clearance
  ["1042785", "cocuk"], ["1042766", "cocuk"], // girls, boys
  ["1042786", "cocuk"], ["1042787", "cocuk"], // toddler girl, toddler boy
  ["1091767", "cocuk"], ["1091779", "cocuk"], // baby girl, baby boy
];
const BRFS_CIDS: GapMarket["cids"] = [["1045379", "kadin"], ["1045495", "erkek"], ["1045489", "kadin"]]; // + petites

export const GAPINC: Record<GapIncSlug, GapBrand> = {
  gap: {
    code: "gap",
    markets: {
      US: {
        site: "https://www.gap.com",
        cids: [
          ["65179", "kadin"], ["65289", "erkek"], ["65194", "cocuk"], ["65217", "cocuk"],
          ["65263", "cocuk"], ["65236", "cocuk"],
        ],
      },
      CA: {
        site: "https://www.gapcanada.ca",
        cids: [
          ["1065871", "kadin"], ["1065870", "erkek"], ["1065850", "cocuk"], ["1065844", "cocuk"],
          ["1065853", "cocuk"], ["1029762", "kadin"],
        ],
      },
    },
  },
  oldnavy: {
    code: "on",
    markets: {
      US: { site: "https://oldnavy.gap.com", cids: ON_CIDS },
      CA: { site: "https://oldnavy.gapcanada.ca", cids: ON_CIDS },
    },
  },
  bananarepublic: {
    code: "br",
    markets: {
      US: { site: "https://bananarepublic.gap.com", cids: BR_CIDS },
      CA: { site: "https://bananarepublic.gapcanada.ca", cids: BR_CIDS },
    },
  },
  // Canada (2026-10-21): athleta.gapcanada.ca is live again and the API answers
  // `market=ca` on the same sale ids in CAD (Venice Jogger: 119.00 CA vs 98.00 US
  // regular; ~1,925 + 325 sale colours).
  athleta: {
    code: "at",
    markets: {
      US: { site: "https://athleta.gap.com", cids: [["1023728", "kadin"], ["1073226", "cocuk"]] },
      CA: { site: "https://athleta.gapcanada.ca", cids: [["1023728", "kadin"], ["1073226", "cocuk"]] },
    },
  },
  gapfactory: {
    code: "gapfs",
    markets: {
      US: { site: "https://www.gapfactory.com", cids: GAPFS_CIDS },
      CA: { site: "https://www.gapfactory.ca", cids: GAPFS_CIDS },
    },
  },
  brfactory: {
    code: "brfs",
    markets: {
      US: { site: "https://bananarepublicfactory.gapfactory.com", cids: BRFS_CIDS },
      CA: { site: "https://bananarepublicfactory.gapfactory.ca", cids: BRFS_CIDS },
    },
  },
};

const API = "https://api.gap.com/commerce/search/products/v2/cc";
const PAGE = 200;
const CAP = Number(process.env.GAPINC_CAP ?? 1500);
const MAX_REQUESTS = Number(process.env.GAPINC_MAX_REQUESTS ?? 40);
const PAUSE_MS = Number(process.env.GAPINC_PAUSE_MS ?? 700);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function gapSearchUrl(code: string, country: CountryCode, cid: string, page: number): string {
  const m = country.toLowerCase();
  return `${API}?brand=${code}&market=${m}&locale=en_${country}&cid=${cid}&pageSize=${PAGE}&pageNumber=${page}`;
}

/** Gender from Gap's own product-type line ("womens dresses", "toddler boys jeans"). */
export function gapGender(webProductType: unknown, fallback: Gender): Gender {
  const t = String(webProductType ?? "").toLowerCase();
  if (/\b(girls?|boys?|baby|toddler|kids?)\b/.test(t)) return "cocuk";
  if (/\b(wom[ae]ns?|maternity|petites?)\b/.test(t)) return "kadin";
  if (/\bm[ae]ns?\b/.test(t)) return "erkek";
  return fallback;
}

/** Photos of one colourway: the main shot, then the alternate views, in order. */
function photosOf(site: string, cc: any): string[] {
  const imgs: any[] = Array.isArray(cc?.images) ? cc.images : [];
  const path = (type: string) => imgs.find((i) => i?.type === type)?.path;
  const alts = imgs
    .filter((i) => /^AV\d+$/.test(String(i?.type)))
    .sort((a, b) => Number(a.type.slice(2)) - Number(b.type.slice(2)))
    .map((i) => i.path);
  return [path("P01"), ...alts]
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .map((p) => `${site}/${p.replace(/^\/+/, "")}`);
}

/**
 * Map one search `products[]` style to a record per DISCOUNTED colourway. Pure.
 * `fallbackGender` is the section the category id belongs to.
 */
export function mapGapStyle(
  slug: GapIncSlug,
  country: CountryCode,
  site: string,
  style: any,
  fallbackGender: Gender = null,
): ProductRecord[] {
  const out: ProductRecord[] = [];
  if (!style?.styleId) return out;
  const type = String(style.webProductType ?? "").replace(/^z\s+/i, "").trim();
  const category = type && !/needs wpt/i.test(type) ? type : null;
  for (const cc of style.styleColors ?? []) {
    const price = parseFloat(cc?.effectivePrice);
    const regular = parseFloat(cc?.regularPrice);
    if (!cc?.ccId || !Number.isFinite(price) || price <= 0) continue;
    if (!Number.isFinite(regular) || regular <= price) continue;
    const status = String(cc.inventoryStatus ?? "");
    const photos = photosOf(site, cc);
    const colour = [cc.ccName, cc.ccShortDescription].filter(Boolean).join(" · ") || null;
    out.push({
      brand: slug,
      country,
      externalId: String(cc.ccId),
      name: String(cc.styleName ?? style.styleName ?? "").trim(),
      url: `${site}/browse/product.do?pid=${cc.ccId}`,
      imageUrl: photos[0] ?? null,
      images: cleanGallery(photos, photos[0] ?? null),
      price: toMinor(price),
      listPrice: toMinor(regular),
      currency: COUNTRIES[country].currency,
      inStock: !/out of stock/i.test(status) && Number(cc.inventoryCount ?? 1) > 0,
      category,
      gender: gapGender(type, fallbackGender),
      variants: null,
      groupKey: `${slug}:${style.styleId}`,
      colorName: colour,
    });
  }
  return out;
}

export async function listGapInc(slug: GapIncSlug, country: CountryCode): Promise<ProductRecord[]> {
  const b = GAPINC[slug];
  const m = b?.markets[country];
  if (!m) return [];
  const seen = new Set<string>();
  // Every department gets its first page, then more rounds only while under the
  // cap; the result is interleaved so the cap never fills from women's alone.
  const queue = m.cids.map(([cid, gender]) => ({ cid, gender, page: 0, done: false, rows: [] as ProductRecord[] }));
  let requests = 0;
  let failures = 0;
  const kept = () => queue.reduce((n, q) => n + q.rows.length, 0);
  while (requests < MAX_REQUESTS && queue.some((q) => !q.done) && (requests === 0 || kept() < CAP)) {
    for (const q of queue) {
      if (q.done || requests >= MAX_REQUESTS || (q.page > 0 && kept() >= CAP)) continue;
      if (requests > 0) await sleep(PAUSE_MS);
      requests++;
      const data = await getJson<any>(gapSearchUrl(b.code, country, q.cid, q.page), { country, retries: 1 }).catch(() => null);
      if (!data) {
        failures++;
        q.done = true;
        continue;
      }
      const styles: any[] = data.products ?? [];
      for (const s of styles) {
        for (const r of mapGapStyle(slug, country, m.site, s, q.gender)) {
          if (seen.has(r.externalId)) continue;
          seen.add(r.externalId);
          q.rows.push(r);
        }
      }
      q.page++;
      const pages = Number(data.pagination?.pageNumberTotal ?? 0);
      if (!styles.length || q.page >= pages) q.done = true;
      // Kids' sections get a slice, so women's and men's lead the feed.
      if (q.gender === "cocuk" && q.rows.length >= CAP / 12) {
        q.rows.length = Math.ceil(CAP / 12);
        q.done = true;
      }
    }
  }
  if (seen.size === 0 && failures > 0) throw new Error(`${slug}/${country}: gap search API refused`);
  return interleave(queue.map((q) => q.rows), CAP);
}

/** Round-robin merge, in-stock rows first, capped. Pure. */
export function interleave(lists: ProductRecord[][], cap: number): ProductRecord[] {
  const pick = (inStock: boolean) => {
    const ls = lists.map((l) => l.filter((r) => r.inStock === inStock));
    const out: ProductRecord[] = [];
    for (let i = 0; ls.some((l) => i < l.length); i++) for (const l of ls) if (i < l.length) out.push(l[i]);
    return out;
  };
  return [...pick(true), ...pick(false)].slice(0, cap);
}
