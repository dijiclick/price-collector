/**
 * W Concept (South Korea, 2026-10-21) — designer multi-brand store (Shinsegae).
 * `maker` is the real brand (Korean name, else English).
 *
 * Route: the storefront's own category API,
 *   POST https://gw-front.wconcept.co.kr/display/api/category/v1/products/{mediumCd}/{large}/{middle}
 *   { custNo:"", domainType:"pc", sort:"WCK", pageNo, pageSize ≤ 60, saleTags:[] }
 * with the public `DISPLAY-API-KEY` header the web app ships in its JS bundle (a
 * site key, not a user credential). Category codes come from the page's own
 * navigation (`categories[].largeCategoryList[].middleCategoryList[]`).
 *
 * Prices: `customerPrice` is the struck price, `salePrice` what anyone pays and
 * `finalPrice` the price after the best coupon (infoTag "쿠폰") — never used.
 * There is no discount filter on this route, so the site's default order is
 * read and only reduced rows are kept (~75% of a page, 2026-10-21).
 *
 * Each row carries its own category path (`categoryDepthName1..3`) and section
 * (`mediumName` 여성/남성/뷰티): the Korean depth-3 (else depth-2) name → an
 * English label lib/productTypes.ts classifies, falling back to the leaf asked
 * for. Names stay Korean.
 *
 * KRW has no minor unit; stored ×100 like every market.
 */
import type { ProductRecord } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "wconcept";

const API = "https://gw-front.wconcept.co.kr/display/api/category/v1/products";
/** The public key the storefront sends with every display call (in its JS bundle). */
const DISPLAY_KEY = "VWmkUPgs6g2fviPZ5JQFQ3pERP4tIXv/J2jppLqSRBk=";
const PAGE = 60; // the API's maximum (100 answers 60)
const CAP = 1500;
const PAUSE_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const WOMEN = "M33439436";
const MEN = "M83985861";
const BEAUTY = "M39593862";

/** [mediumCd, largeCategory, middleCategory, pages of 60, fallback label]. */
export const WCONCEPT_LEAVES: [string, string, string, number, string][] = [
  [WOMEN, "001", "001", 2, "Jackets"], // 아우터
  [WOMEN, "001", "002", 2, "Knitwear"], // 니트
  [WOMEN, "001", "005", 1, "Dresses"], // 원피스
  [WOMEN, "001", "004", 1, "Blouse"], // 블라우스
  [WOMEN, "001", "013", 1, "Shirt"], // 셔츠
  [WOMEN, "001", "003", 1, "T-Shirts"], // 티셔츠
  [WOMEN, "001", "007", 1, "Skirts"], // 스커트
  [WOMEN, "001", "006", 1, "Trousers"], // 팬츠
  [WOMEN, "001", "008", 1, "Jeans"], // 데님
  [WOMEN, "004", "001", 1, "Shoulder Bags"], // 숄더백
  [WOMEN, "004", "008", 1, "Crossbody Bags"], // 크로스백
  [WOMEN, "004", "002", 1, "Tote Bags"], // 토트백
  [WOMEN, "004", "005", 1, "Wallets"], // 지갑
  [WOMEN, "002", "001", 1, "Boots"], // 부츠
  [WOMEN, "002", "002", 1, "Sneakers"], // 스니커즈
  [WOMEN, "002", "010", 1, "Loafers"], // 로퍼
  [WOMEN, "002", "004", 1, "Heels"], // 펌프스
  [WOMEN, "003", "002", 1, "Jewellery"], // 주얼리
  [WOMEN, "003", "005", 1, "Hat"], // 모자
  [WOMEN, "003", "004", 1, "Scarf"], // 스카프/머플러
  [WOMEN, "003", "009", 1, "Sunglasses"], // 아이웨어
  [MEN, "001", "001", 1, "Jackets"], // 아우터
  [MEN, "001", "003", 1, "Knitwear"], // 니트
  [MEN, "001", "004", 1, "Shirt"], // 셔츠
  [MEN, "001", "002", 1, "T-Shirts"], // 티셔츠
  [MEN, "001", "005", 1, "Trousers"], // 팬츠
  [MEN, "001", "006", 1, "Jeans"], // 데님
  [MEN, "002", "006", 1, "Sneakers"], // 스니커즈
  [MEN, "005", "003", 1, "Crossbody Bags"], // 크로스백
  [BEAUTY, "001", "001", 1, "Toner"], // 스킨/토너/미스트
  [BEAUTY, "001", "010", 1, "Moisturiser"], // 모이스처라이저
  [BEAUTY, "008", "001", 1, "Foundation"], // 베이스메이크업
  [BEAUTY, "008", "003", 1, "Lipstick"], // 립메이크업
  [BEAUTY, "004", "001", 1, "Perfume"], // 향수
];

/** Depth-3 (else depth-2) Korean name → English label. Unmapped → the leaf's label. */
const NAMES: Record<string, string> = {
  자켓: "Jackets", 재킷: "Jackets", 코트: "Coats", 패딩: "Puffer Jackets", 점퍼: "Jackets", 블레이저: "Blazers",
  트렌치코트: "Trench Coats", 무스탕: "Shearling Jackets", 퍼: "Shearling Jackets", 베스트: "Vest", 가디건: "Cardigans",
  풀오버: "Knitwear", 캐시미어: "Knitwear", 후드집업: "Zip Hoodies", 슬리브리스: "Tank Tops", 긴팔: "Long Sleeve T-Shirts",
  반팔: "T-Shirts", 맨투맨: "Sweatshirts", 후드: "Hoodies", 스웨트셔츠: "Sweatshirts",
  미니: "Skirts", 미디: "Skirts", 롱: "Skirts", 와이드: "Trousers", 슬랙스: "Trousers", 쇼츠: "Shorts", 레깅스: "Leggings",
  원피스: "Dresses", 셔츠: "Shirt", 블라우스: "Blouse",
  부츠: "Boots", 앵클부츠: "Boots", 롱부츠: "Boots", 스니커즈: "Sneakers", 로퍼: "Loafers", 펌프스: "Heels", 샌들: "Sandals",
  귀걸이: "Earrings", 목걸이: "Necklaces", 반지: "Ring", 팔찌: "Bracelets", 선글라스: "Sunglasses", 안경: "Glasses",
  비니: "Beanies", 볼캡: "Cap", 머플러: "Scarf", 스카프: "Scarf", 향수: "Perfume",
};

export function wconceptLabel(depth2: unknown, depth3: unknown, fallback: string | null): string | null {
  return (typeof depth3 === "string" && NAMES[depth3]) || (typeof depth2 === "string" && NAMES[depth2]) || fallback;
}

function genderOf(medium: unknown): ProductRecord["gender"] {
  if (medium === "여성") return "kadin";
  if (medium === "남성") return "erkek";
  if (medium === "키즈") return "cocuk";
  return null;
}

export function requestBody(page: number): string {
  return JSON.stringify({ custNo: "", domainType: "pc", sort: "WCK", pageNo: page, pageSize: PAGE, saleTags: [] });
}

/** One listing row → a record. Pure; null unless salePrice is below customerPrice. */
export function mapWconceptItem(it: any, fallbackLabel: string | null = null, country: CountryCode = "KR"): ProductRecord | null {
  if (!it?.itemCd || !it?.itemName) return null;
  const was = Number(it.customerPrice);
  const now = Number(it.salePrice);
  if (!(now > 0) || !(was > now)) return null;
  const maker = [it.brandNameKr, it.brandNameEn].find((b) => typeof b === "string" && b.trim());
  return {
    brand,
    country,
    externalId: String(it.itemCd),
    name: String(it.itemName).trim(),
    url: `https://www.wconcept.co.kr/Product/${it.itemCd}`,
    imageUrl: typeof it.productImageUrl === "string" ? it.productImageUrl : null,
    price: Math.round(now * 100),
    listPrice: Math.round(was * 100),
    currency: "KRW",
    // `statusCd` "01" = on sale; anything else (sold out / suspended) is not buyable.
    inStock: it.statusCd == null || String(it.statusCd) === "01",
    category: wconceptLabel(it.categoryDepthName2, it.categoryDepthName3, fallbackLabel),
    maker: maker ? String(maker).trim() : null,
    gender: genderOf(it.mediumName),
    variants: null,
    groupKey: null,
  };
}

export async function listWconcept(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "KR") return [];
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const [medium, large, middle, pages, label] of WCONCEPT_LEAVES) {
    for (let page = 1; page <= pages; page++) {
      if (calls++ > 0) await sleep(PAUSE_MS);
      const data = await getJson<any>(`${API}/${medium}/${large}/${middle}`, {
        country,
        method: "POST",
        body: requestBody(page),
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "DISPLAY-API-KEY": DISPLAY_KEY,
          Origin: "https://display.wconcept.co.kr",
          Referer: "https://display.wconcept.co.kr/",
        },
        retries: 2,
      });
      const content = data?.data?.content;
      if (data?.result !== "SUCCESS" || !Array.isArray(content)) {
        throw new Error(`wconcept: ${medium}/${large}/${middle} p${page} answered ${data?.result} ${data?.errorCode ?? ""}`);
      }
      for (const it of content) {
        const r = mapWconceptItem(it, label, country);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (content.length < PAGE) break;
    }
  }
  const all = [...byId.values()];
  if (all.length === 0) throw new Error("wconcept: 0 discounted rows across every category");
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listWconcept;
