/**
 * 29CM (South Korea, 2026-10-21) — curated multi-brand store (Musinsa group).
 * `maker` is the real brand as 29CM prints it (Korean name).
 *
 * Route: the storefront's own listing BFF,
 *   POST https://display-bff-api.29cm.co.kr/api/v1/listing/items
 *   { pageRequest:{page,size≤100}, sortType:"RECOMMENDED", pageType:"CATEGORY_PLP",
 *     facets:{ categoryFacetInputs:[{largeId,middleId}], discountFacetInputs:[{type:"ONLY_DISCOUNT"}] } }
 * — no key, no cookie; verified from a GitHub runner, no proxy (probe 39634127022).
 * Category codes come from `/api/v1/categories/tree` / `/api/v2/listing/facet-group`.
 *
 * Prices (`itemInfo`): `originalPrice` is the struck price, `sellPrice` what
 * anyone pays, and `displayPrice` the price AFTER the best coupon (badge "쿠폰")
 * — never used: a row whose only reduction is a coupon has sellPrice ==
 * originalPrice and is dropped.
 *
 * Each row carries its own large/middle/small category names
 * (`itemEvent.eventProperties`), so the type comes from the row itself: the
 * Korean small (else middle) name → an English label lib/productTypes.ts
 * classifies. Gender is the large category (여성의류 / 남성의류 …). Names stay Korean.
 *
 * KRW has no minor unit; stored ×100 like every market.
 */
import type { ProductRecord } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "29cm";

const API = "https://display-bff-api.29cm.co.kr/api/v1/listing/items?colorchipVariant=treatment";
const CAP = 1500;
const PAUSE_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * [largeId, middleId, rows to take, label] — the site's own category tree. The
 * label is the fallback type when a row's own primary category is a theme
 * shelf (단독, 해외브랜드, 어스/비건 …) rather than a product type.
 */
export const LEAVES_29CM: [number, number, number, string][] = [
  // 여성의류 women's clothing
  [268100100, 268102100, 140, "Jackets"], // 아우터
  [268100100, 268103100, 110, "Top"], // 상의
  [268100100, 268105100, 90, "Knitwear"], // 니트웨어
  [268100100, 268106100, 90, "Trousers"], // 바지
  [268100100, 268104100, 45, "Dresses"], // 원피스
  [268100100, 268107100, 45, "Skirts"], // 스커트
  [268100100, 268109100, 20, "Lingerie"], // 언더웨어
  [268100100, 268110100, 20, "Pyjamas"], // 홈웨어
  // 남성의류 men's clothing
  [272100100, 272102100, 90, "Jackets"], // 아우터
  [272100100, 272103100, 70, "Top"], // 상의
  [272100100, 272104100, 70, "Trousers"], // 하의
  [272100100, 272110100, 45, "Knitwear"], // 니트웨어
  // 가방 bags
  [269100100, 269101100, 40, "Shoulder Bags"], // 여성 숄더백
  [269100100, 269102100, 30, "Crossbody Bags"], // 여성 크로스백
  [269100100, 269103100, 25, "Tote Bags"], // 여성 토트백
  [269100100, 269106100, 20, "Backpacks"], // 여성 백팩
  [273100100, 273101100, 15, "Crossbody Bags"], // 남성 크로스백
  [273100100, 273104100, 15, "Backpacks"], // 남성 백팩
  // 슈즈 shoes
  [270100100, 270106100, 40, "Sneakers"], // 여성 스니커즈
  [270100100, 270103100, 40, "Boots"], // 여성 부츠
  [270100100, 270101100, 20, "Loafers"], // 여성 로퍼
  [270100100, 270102100, 15, "Heels"], // 여성 힐/펌프스
  [270100100, 270121100, 15, "Shoes"], // 여성 플랫슈즈
  [274100100, 274101100, 35, "Sneakers"], // 남성 스니커즈
  [274100100, 274103100, 10, "Shoes"], // 남성 구두
  [274100100, 274104100, 10, "Boots"], // 남성 부츠
  // 액세서리 / 주얼리 / 모자
  [271100100, 271104100, 15, "Sunglasses"], // 여성 아이웨어
  [271100100, 271117100, 20, "Scarf"], // 여성 머플러
  [271100100, 271112100, 15, "Wallets"], // 여성 지갑/카드케이스
  [271100100, 271103100, 10, "Watches"], // 여성 시계
  [275100100, 275112100, 10, "Wallets"], // 남성 지갑/카드케이스
  [305100100, 305101100, 25, "Earrings"], // 귀걸이
  [305100100, 305102100, 25, "Necklaces"], // 목걸이
  [305100100, 305103100, 15, "Ring"], // 반지
  [305100100, 305104100, 15, "Bracelets"], // 팔찌
  [310100100, 310109100, 15, "Cap"], // 여성 볼캡
  [310100100, 310110100, 15, "Beanies"], // 여성 비니
  // 뷰티 beauty (health food and devices skipped)
  [266100100, 266101100, 45, "Face Cream"], // 스킨케어
  [266100100, 266105100, 25, "Makeup"], // 메이크업
  [266100100, 266107100, 25, "Perfume"], // 프래그런스
  [266100100, 266102100, 10, "Body Lotion"], // 바디케어
  [266100100, 266104100, 10, "Hair Care"], // 헤어케어
];

/** 29CM small-category name → English label lib/productTypes.ts classifies. */
const SMALL: Record<string, string> = {
  "긴소매 셔츠": "Shirt", "반소매 셔츠": "Shirt", 셔츠: "Shirt", 블라우스: "Blouse",
  "긴소매 티셔츠": "Long Sleeve T-Shirts", "반소매 티셔츠": "T-Shirts", "피케/카라 티셔츠": "Polo Shirts",
  스웨트셔츠: "Sweatshirts", 후디: "Hoodies", 집업: "Zip Hoodies", 슬리브리스: "Tank Tops",
  카디건: "Cardigans", 베스트: "Vest", 폴로셔츠: "Polo Shirts", 후드: "Hoodies",
  "기타 니트": "Knitwear", 브이넥: "Knitwear", 캐시미어: "Knitwear", 크루넥: "Knitwear", 터틀넥: "Knitwear",
  데님: "Jeans", "데님 팬츠": "Jeans", 부츠컷: "Jeans", 레깅스: "Leggings", 쇼트: "Shorts",
  스트레이트: "Trousers", "스트레이트 팬츠": "Trousers", 슬랙스: "Trousers", 슬림: "Trousers", "슬림 팬츠": "Trousers",
  와이드: "Trousers", "와이드 팬츠": "Trousers", "코튼 팬츠": "Trousers", "기타 팬츠": "Trousers",
  트레이닝: "Joggers", "트레이닝 팬츠": "Joggers",
  롱: "Skirts", 미니: "Skirts", 미디: "Skirts",
  "데님 원피스": "Dresses", "롱 원피스": "Dresses", "미니 원피스": "Dresses", "미디 원피스": "Dresses",
  경량패딩: "Padded Jackets", 롱패딩: "Long Puffer Coats", 숏패딩: "Puffer Jackets", 롱코트: "Coats", 숏코트: "Coats",
  하프코트: "Coats", "트렌치 코트": "Trench Coats", "트렌치/맥코트": "Trench Coats", 블레이저: "Blazers",
  "레더 재킷": "Leather Jackets", "데님 재킷": "Denim Jackets", 무스탕: "Shearling Jackets", "퍼 재킷": "Shearling Jackets",
  플리스: "Fleece Jackets", "후드 집업": "Zip Hoodies", "트레이닝 재킷": "Track Jackets", 레인코트: "Coats",
  브라: "Bra", "브라탑/캐미솔": "Bra", 팬티: "Briefs", 세트: "Lingerie", "기타 언더웨어": "Lingerie",
  "수면 잠옷": "Pyjamas", "긴소매 세트": "Pyjamas", "반소매 세트": "Pyjamas", "기타 세트": "Pyjamas", 로브: "Pyjamas",
  선글라스: "Sunglasses", 안경: "Glasses",
  "로션/에멀전": "Moisturiser", "립밤/립케어": "Lipstick", "마스크/팩": "Face Masks", 선케어: "Sunscreen",
  "스킨/토너": "Toner", "에센스/세럼/앰플": "Serum", 크림: "Face Cream", 클렌징: "Cleanser", "페이셜 패드": "Toner",
  "네일/네일용품": "Nail Polish", "립스틱/립틴트": "Lipstick", "아이라이너/마스카라": "Mascara", "쿠션/팩트": "Foundation",
  "남성 향수": "Perfume", "여성 향수": "Perfume", "유니섹스 향수": "Perfume",
  샴푸: "Shampoo", "트리트먼트/헤어팩": "Hair Care", "헤어에센스/헤어오일": "Hair Care",
  "로션/크림": "Body Lotion", 바디워시: "Body Wash", 핸드크림: "Body Lotion",
};

/** Middle-category fallback when the small name is missing or unmapped. */
const MIDDLE: Record<string, string> = {
  아우터: "Jackets", 상의: "Top", 니트웨어: "Knitwear", 바지: "Trousers", 하의: "Trousers", 원피스: "Dresses",
  스커트: "Skirts", 언더웨어: "Lingerie", 이너웨어: "Men's Underwear", 홈웨어: "Pyjamas",
  숄더백: "Shoulder Bags", 크로스백: "Crossbody Bags", 토트백: "Tote Bags", 백팩: "Backpacks",
  스니커즈: "Sneakers", 부츠: "Boots", 로퍼: "Loafers", "힐/펌프스": "Heels", 플랫슈즈: "Shoes", 구두: "Shoes",
  아이웨어: "Sunglasses", 머플러: "Scarf", "지갑/카드케이스": "Wallets", 시계: "Watches",
  귀걸이: "Earrings", 목걸이: "Necklaces", 반지: "Ring", 팔찌: "Bracelets", 볼캡: "Cap", 비니: "Beanies",
  스킨케어: "Face Cream", 메이크업: "Makeup", 프래그런스: "Perfume", 바디케어: "Body Lotion", 헤어케어: "Hair Care",
};

export function labelFor(middle: unknown, small: unknown): string | null {
  return (typeof small === "string" && SMALL[small]) || (typeof middle === "string" && MIDDLE[middle]) || null;
}

const LARGE_NAMES: Record<number, string> = {
  268100100: "여성의류", 269100100: "여성가방", 270100100: "여성슈즈", 271100100: "여성액세서리", 305100100: "여성주얼리", 310100100: "여성모자",
  272100100: "남성의류", 273100100: "남성가방", 274100100: "남성슈즈", 275100100: "남성액세서리",
};

function genderOf(large: unknown): ProductRecord["gender"] {
  if (typeof large !== "string") return null;
  if (large.startsWith("여성")) return "kadin";
  if (large.startsWith("남성")) return "erkek";
  if (large === "키즈") return "cocuk";
  return null;
}

export function requestBody(largeId: number, middleId: number, size: number, page = 1): string {
  return JSON.stringify({
    pageRequest: { page, size },
    sortType: "RECOMMENDED",
    pageType: "CATEGORY_PLP",
    facets: { categoryFacetInputs: [{ largeId, middleId }], discountFacetInputs: [{ type: "ONLY_DISCOUNT" }] },
  });
}

/**
 * One listing row → a record. Pure; null unless the shop's own sell price is
 * below its original. `leaf` is the category the row was listed under: its
 * label and gender stand in when the row's own primary category is a theme shelf.
 */
export function map29cmItem(it: any, leaf: { label: string; largeId: number } | null = null, country: CountryCode = "KR"): ProductRecord | null {
  const info = it?.itemInfo;
  const ev = it?.itemEvent?.eventProperties ?? {};
  if (!it?.itemId || !info?.productName || it.itemType !== "PRODUCT") return null;
  const was = Number(info.originalPrice);
  const now = Number(info.sellPrice);
  if (!(now > 0) || !(was > now)) return null;
  const web = String(it?.itemUrl?.webLink ?? "").split("?")[0];
  return {
    brand,
    country,
    externalId: String(it.itemId),
    name: String(info.productName).trim(),
    url: web || `https://product.29cm.co.kr/catalog/${it.itemId}`,
    imageUrl: typeof info.thumbnailUrl === "string" ? info.thumbnailUrl : null,
    price: Math.round(now * 100),
    listPrice: Math.round(was * 100),
    currency: "KRW",
    inStock: info.isSoldOut !== true,
    category: labelFor(ev.middleCategoryName, ev.smallCategoryName) ?? leaf?.label ?? null,
    maker: typeof info.brandName === "string" && info.brandName.trim() ? info.brandName.trim() : null,
    gender: genderOf(ev.largeCategoryName) ?? (leaf ? genderOf(LARGE_NAMES[leaf.largeId]) : null),
    variants: null,
    groupKey: null,
  };
}

export async function list29cm(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "KR") return [];
  const byId = new Map<string, ProductRecord>();
  for (let i = 0; i < LEAVES_29CM.length; i++) {
    const [large, middle, take, label] = LEAVES_29CM[i];
    if (i > 0) await sleep(PAUSE_MS);
    const data = await getJson<any>(API, {
      country,
      method: "POST",
      body: requestBody(large, middle, take),
      headers: { "Content-Type": "application/json", Origin: "https://www.29cm.co.kr", Referer: "https://www.29cm.co.kr/" },
      retries: 2,
    });
    if (data?.meta?.result !== "SUCCESS" || !Array.isArray(data?.data?.list)) {
      throw new Error(`29cm: category ${large}/${middle} answered ${JSON.stringify(data?.meta ?? null)}`);
    }
    for (const it of data.data.list) {
      const r = map29cmItem(it, { label, largeId: large }, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  if (all.length === 0) throw new Error("29cm: 0 discounted rows across every category");
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = list29cm;
