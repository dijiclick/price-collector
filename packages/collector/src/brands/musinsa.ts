/**
 * MUSINSA (South Korea, 2026-10-21) — Korea's biggest fashion marketplace.
 * Multi-brand: `maker` is the real brand as Musinsa prints it (Korean name).
 *
 * Route: the storefront's own listing API, `api.musinsa.com/api2/dp/v1/plp/goods`
 * (the web app's category grid, behind Cloudflare but answering a plain GET —
 * verified from a GitHub runner, no proxy: probe 39634127022). No key, no cookie.
 *
 *   category=<code>   Musinsa's own category tree (001 tops, 002 outer, 003
 *                     pants, 100 dress/skirt, 004 bags, 103 shoes, 101 small
 *                     goods, 026 underwear, 104 beauty). Leaf codes are queried
 *                     one by one because the listing row carries NO category —
 *                     the code we asked for is the only place the type exists,
 *                     so each query carries an English label lib/productTypes.ts
 *                     can classify (names stay Korean).
 *   isSale=true       the site's own "세일" filter.
 *   sortCode=POPULAR  the site's default order, so each leaf yields its best sellers.
 *   size              ≤ 100 (larger is a 400 "잘못된 파라미터").
 *
 * Price: `normalPrice` is the struck-through price the PDP shows, `price` the
 * selling price. `couponPrice`/`finalPrice`/`extraDiscountAmount` are coupon and
 * member benefits and are never used. A row whose price varies by option
 * (`isOptionSalePriceVaried`) is dropped: its strike could be a range.
 *
 * Caveat for the owner: ~74% of Musinsa's tops carry a sale flag (258k of 350k,
 * 2026-10-21) — Korean marketplaces strike a 정가 on most listings. Each row's
 * strike is the shop's own; nothing here invents one.
 *
 * KRW has no minor unit; like every market, prices are stored ×100.
 */
import type { ProductRecord } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "musinsa";

const API = "https://api.musinsa.com/api2/dp/v1/plp/goods";
const CAP = 1500;
const PAUSE_MS = 350;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** [Musinsa category code, English label for the classifier, rows to take]. */
export const MUSINSA_LEAVES: [string, string, number][] = [
  // 상의 tops
  ["001001", "T-Shirts", 25],
  ["001002", "Shirts & Blouses", 35],
  ["001003", "Polo Shirts", 15],
  ["001004", "Hoodies", 35],
  ["001005", "Sweatshirts", 35],
  ["001006", "Knitwear", 50],
  ["001010", "Long Sleeve T-Shirts", 35],
  // 아우터 outer
  ["002020", "Cardigans", 35],
  ["002022", "Zip Hoodies", 25],
  ["002012", "Puffer Jackets", 35],
  ["002013", "Long Puffer Coats", 25],
  ["002027", "Padded Jackets", 25],
  ["002007", "Coats", 25],
  ["002024", "Coats", 15],
  ["002008", "Trench Coats", 15],
  ["002003", "Blazers", 25],
  ["002002", "Leather Jackets", 25],
  ["002001", "Bomber Jackets", 15],
  ["002023", "Fleece Jackets", 25],
  ["002025", "Shearling Jackets", 15],
  ["002017", "Denim Jackets", 15],
  ["002006", "Jackets", 15],
  ["002018", "Track Jackets", 15],
  ["002021", "Vest", 15],
  // 바지 pants
  ["003002", "Jeans", 50],
  ["003007", "Trousers", 35],
  ["003008", "Trousers", 35],
  ["003004", "Joggers", 25],
  ["003009", "Shorts", 15],
  ["003005", "Leggings", 15],
  ["003010", "Jumpsuits", 15],
  // 원피스/스커트
  ["100001", "Dresses", 20],
  ["100002", "Dresses", 20],
  ["100003", "Dresses", 15],
  ["100004", "Skirts", 15],
  ["100005", "Skirts", 15],
  ["100006", "Skirts", 15],
  // 신발 shoes
  ["103004", "Sneakers", 50],
  ["103001", "Shoes", 35],
  ["103002", "Boots", 35],
  ["103007", "Boots", 15],
  ["103005", "Running Shoes", 25],
  ["103003", "Sandals", 15],
  // 가방 bags
  ["004003", "Shoulder Bags", 35],
  ["004002", "Crossbody Bags", 25],
  ["004001", "Backpacks", 25],
  ["004015", "Tote Bags", 15],
  ["004014", "Tote Bags", 15],
  ["004016", "Wallets", 15],
  // 소품 accessories
  ["101006", "Jewellery", 35],
  ["101003002", "Sunglasses", 15],
  ["101003001", "Glasses", 10],
  ["101007", "Belts", 15],
  ["101008", "Scarf", 15],
  ["101005", "Watches", 15],
  ["101002001", "Socks", 10],
  // 속옷/홈웨어
  ["026001", "Bra", 15],
  ["026003", "Lingerie", 15],
  ["026004", "Men's Underwear", 15],
  ["026005", "Pyjamas", 15],
  // 뷰티 beauty (supplements, devices and oral care are skipped)
  ["104001", "Face Cream", 35],
  ["104002", "Sunscreen", 15],
  ["104003", "Cleanser", 15],
  ["104005", "Perfume", 25],
  ["104006", "Hair Care", 15],
  ["104007", "Body Lotion", 15],
  ["104013", "Face Masks", 15],
  ["104014", "Foundation", 15],
  ["104015", "Lipstick", 15],
  ["104016", "Eye Makeup", 10],
];

export function listUrl(code: string, size: number, page = 1, brandSlug?: string): string {
  const b = brandSlug ? `&brand=${encodeURIComponent(brandSlug)}` : "";
  return `${API}?gf=A&sortCode=POPULAR&page=${page}&size=${size}&caller=CATEGORY&category=${code}${b}&isSale=true`;
}

/**
 * Brands whose OWN Korean web shop is out of reach (SPAO/Topten: E-Land's and
 * Shinsung's server-rendered shops; topten10mall.com does not even answer from
 * abroad) but which run an official store on Musinsa: the same API with
 * `brand=<musinsa slug>` returns only that brand's goods, sold by the brand's
 * Musinsa store at the price Musinsa shows. Rows are stored under OUR slug and
 * link to the Musinsa product page.
 */
export const MUSINSA_STORES: Record<string, string> = {
  spao: "spao",
  topten: "topten",
  "8seconds": "8seconds",
};

/**
 * A brand store is small (SPAO: ~170 reduced tops), so it is walked by top-level
 * category with size 100 and paged; specific leaves go first so a knit is a
 * knit and not a "Top" (first leaf wins, as in the marketplace walk).
 */
export const MUSINSA_BRAND_LEAVES: [string, string][] = [
  ["001006", "Knitwear"],
  ["001004", "Hoodies"],
  ["001005", "Sweatshirts"],
  ["001002", "Shirts & Blouses"],
  ["001", "Top"],
  ["002020", "Cardigans"],
  ["002022", "Zip Hoodies"],
  ["002", "Jackets"],
  ["003002", "Jeans"],
  ["003", "Trousers"],
  ["100004", "Skirts"],
  ["100005", "Skirts"],
  ["100006", "Skirts"],
  ["100", "Dresses"],
  ["103", "Shoes"],
  ["004", "Bags"],
  ["026", "Underwear"],
  ["101", ""],
];
const BRAND_PAGE = 100;
/**
 * At most this many pages (×100, most popular first) per category. SPAO and
 * Topten fit in one or two; 8seconds' store ignores `isSale` with a brand filter
 * and lists ~1,400 tops, ~65% reduced, so its long tail is cut here on purpose
 * (≤ 72 requests per brand) and the result capped at CAP like the marketplace.
 */
const BRAND_MAX_PAGES = 4;

function genderOf(t: unknown): ProductRecord["gender"] {
  if (t === "여성") return "kadin";
  if (t === "남성") return "erkek";
  return null; // 공용 (unisex) or blank
}

/** One listing row → a record. Pure; null unless the shop strikes a real price. */
export function mapMusinsaGoods(g: any, category: string | null, country: CountryCode = "KR", asBrand?: string): ProductRecord | null {
  if (!g?.goodsNo || !g?.goodsName) return null;
  const was = Number(g.normalPrice);
  const now = Number(g.price);
  if (!(now > 0) || !(was > now)) return null;
  if (g.isOptionSalePriceVaried) return null;
  return {
    brand: asBrand ?? brand,
    country,
    externalId: String(g.goodsNo),
    name: String(g.goodsName).trim(),
    url: typeof g.goodsLinkUrl === "string" && g.goodsLinkUrl ? g.goodsLinkUrl : `https://www.musinsa.com/products/${g.goodsNo}`,
    imageUrl: typeof g.thumbnail === "string" ? g.thumbnail : null,
    price: Math.round(now * 100),
    listPrice: Math.round(was * 100),
    currency: "KRW",
    inStock: g.isSoldOut !== true,
    category,
    maker: asBrand ? null : typeof g.brandName === "string" && g.brandName.trim() ? g.brandName.trim() : null,
    gender: genderOf(g.displayGenderText),
    variants: null,
    groupKey: null,
  };
}

export async function listMusinsa(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "KR") return [];
  const byId = new Map<string, ProductRecord>();
  for (let i = 0; i < MUSINSA_LEAVES.length; i++) {
    const [code, label, take] = MUSINSA_LEAVES[i];
    if (i > 0) await sleep(PAUSE_MS);
    const data = await getJson<any>(listUrl(code, take), { country, retries: 2, headers: { Referer: "https://www.musinsa.com/" } });
    if (data?.meta?.result !== "SUCCESS" || !Array.isArray(data?.data?.list)) {
      throw new Error(`musinsa: category ${code} answered ${JSON.stringify(data?.meta ?? null)}`);
    }
    for (const g of data.data.list) {
      const r = mapMusinsaGoods(g, label, country);
      // First (more specific) leaf wins: a product listed under two leaves keeps its first type.
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  if (all.length === 0) throw new Error("musinsa: 0 discounted rows across every category");
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listMusinsa;

/** One brand's official Musinsa store (see MUSINSA_STORES), discounted rows only. */
export async function listMusinsaStore(ourSlug: string, country: CountryCode): Promise<ProductRecord[]> {
  const slug = MUSINSA_STORES[ourSlug];
  if (!slug || country !== "KR") return [];
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const [code, label] of MUSINSA_BRAND_LEAVES) {
    for (let page = 1; ; page++) {
      if (page > BRAND_MAX_PAGES) break;
      if (calls++ > 0) await sleep(PAUSE_MS);
      const data = await getJson<any>(listUrl(code, BRAND_PAGE, page, slug), { country, retries: 2, headers: { Referer: "https://www.musinsa.com/" } });
      if (data?.meta?.result !== "SUCCESS" || !Array.isArray(data?.data?.list)) {
        throw new Error(`musinsa/${ourSlug}: category ${code} answered ${JSON.stringify(data?.meta ?? null)}`);
      }
      for (const g of data.data.list) {
        // The filter is the brand's own store; a stray row from another brand is not its product.
        if (g?.brand !== slug) continue;
        const r = mapMusinsaGoods(g, label || null, country, ourSlug);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (!data.data.pagination?.hasNext) break;
    }
  }
  const all = [...byId.values()];
  if (all.length === 0) throw new Error(`musinsa/${ourSlug}: 0 discounted rows in the brand's store`);
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
