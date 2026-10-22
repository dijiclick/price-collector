import type { LibLabelsPartial } from "./types";

/**
 * Korean display names for the browse taxonomy. Same keys as
 * labels.en.ts (see its header: keys stay Turkish, subtypes are keyed
 * `type:subtype`). Musinsa / Olive Young category wording.
 */
export const ko: LibLabelsPartial = {
  /** Shelf names, keyed by productTypes.ts type key. */
  types: {
    makyaj: "메이크업",
    parfum: "향수",
    sac: "헤어케어",
    "cilt-bakim": "스킨케어",
    "kisisel-bakim": "바디·생활용품",
    ayakkabi: "신발",
    canta: "가방",
    mayo: "수영복",
    "ic-giyim": "언더웨어",
    elbise: "원피스",
    "dis-giyim": "아우터",
    triko: "니트·스웨트",
    ust: "상의",
    alt: "하의",
    aksesuar: "액세서리",
  },
  groups: {
    giyim: "의류",
    ayakkabi: "신발",
    canta: "가방",
    aksesuar: "액세서리",
    kozmetik: "뷰티",
  },
  /** Keyed `type:subtype` — subtype keys repeat across types (see labels.en.ts). */
  subtypes: {
    "alt:etek": "스커트",
    "alt:sort": "쇼츠",
    "alt:tayt": "레깅스",
    "alt:jean": "청바지",
    "alt:pantolon": "팬츠",

    "ust:tisort": "티셔츠",
    "ust:gomlek": "셔츠",
    "ust:bluz": "블라우스",
    "ust:atlet": "민소매·캐미솔",
    "ust:tunik": "튜닉",

    "dis-giyim:trenckot": "트렌치코트",
    "dis-giyim:blazer": "블레이저",
    "dis-giyim:yelek": "베스트",
    "dis-giyim:mont": "코트·패딩",
    "dis-giyim:ceket": "재킷",

    "ayakkabi:bot": "부츠",
    "ayakkabi:topuklu": "힐",
    "ayakkabi:sneaker": "스니커즈",
    "ayakkabi:sandalet": "샌들",
    "ayakkabi:babet": "플랫슈즈",

    "cilt-bakim:gunes": "선케어",
    "cilt-bakim:maske": "마스크팩",
    "cilt-bakim:serum": "에센스·세럼",
    "cilt-bakim:goz": "아이케어",
    "cilt-bakim:dudak": "립케어",
    "cilt-bakim:temizleyici": "클렌저",
    "cilt-bakim:nemlendirici": "크림·로션",

    "elbise:tulum": "점프수트",
    "elbise:abiye": "드레스",
    "elbise:gomlek": "셔츠 원피스",
    "elbise:maksi": "롱 원피스",
    "elbise:midi": "미디 원피스",
    "elbise:mini": "미니 원피스",

    "kisisel-bakim:hijyen": "생리용품",
    "kisisel-bakim:agiz": "구강케어",
    "kisisel-bakim:banyo": "바디·배스",
    "kisisel-bakim:tiras": "면도·제모",
    "kisisel-bakim:mendil": "물티슈",
    "kisisel-bakim:yara": "밴드·반창고",

    "triko:hirka": "가디건",
    "triko:sweatshirt": "맨투맨",
    "triko:polo": "폴로 셔츠",
    "triko:kazak": "니트·스웨터",

    "ic-giyim:pijama": "잠옷",
    "ic-giyim:corap": "양말·스타킹",
    "ic-giyim:sutyen": "브라",
    "ic-giyim:kulot": "팬티",
    "ic-giyim:atlet": "이너웨어·바디수트",

    "mayo:bikini": "비키니",
    "mayo:mayo": "원피스 수영복",
    "mayo:deniz-sortu": "보드숏",
    "mayo:plaj": "비치웨어",

    "canta:cuzdan": "지갑·카드지갑",
    "canta:sirt": "백팩",
    "canta:tote": "토트백",
    "canta:capraz": "숄더·크로스백",
    "canta:el": "핸드백",
    "canta:valiz": "캐리어",
    "canta:canta-aksesuar": "가방 액세서리",

    "aksesuar:gozluk": "안경·선글라스",
    "aksesuar:sapka": "모자",
    "aksesuar:kemer": "벨트",
    "aksesuar:sal": "머플러·스카프",
    "aksesuar:taki": "주얼리",
    "aksesuar:kolye": "목걸이",
    "aksesuar:kupe": "귀걸이",
    "aksesuar:bileklik": "팔찌",
    "aksesuar:yuzuk": "반지",
    "aksesuar:saat": "시계",
    "aksesuar:toka": "헤어 액세서리",

    "makyaj:dudak": "립 메이크업",
    "makyaj:goz": "아이 메이크업",
    "makyaj:yuz": "베이스 메이크업",
    "makyaj:oje": "네일",
    "makyaj:firca": "메이크업 도구",
    "makyaj:temizleme": "클렌징",

    "parfum:deodorant": "데오드란트",
    "parfum:edp": "오 드 퍼퓸",
    "parfum:edt": "오 드 뚜왈렛",
    "parfum:vucut": "바디 미스트",
    "parfum:ev": "홈 프래그런스",
    "parfum:set": "향수 세트",

    "sac:boya": "염색",
    "sac:sampuan": "샴푸",
    "sac:maske": "헤어팩·오일",
    "sac:sekillendirici": "스타일링",
    "sac:krem": "린스·컨디셔너",
  },
  /** The shelf for products no type caught (productTypes.ts UNTYPED). */
  untyped: "기타 상품",
  /** Colour-filter names, keyed by colors.ts COLOR_FAMILIES key. */
  colors: {
    lacivert: "네이비",
    siyah: "블랙",
    beyaz: "화이트",
    gri: "그레이",
    bej: "베이지",
    kahverengi: "브라운",
    kirmizi: "레드",
    pembe: "핑크",
    mor: "퍼플",
    mavi: "블루",
    yesil: "그린",
    sari: "옐로우",
    turuncu: "오렌지",
    metalik: "메탈릭",
    "cok-renkli": "멀티컬러",
  },
  /** The Akıllı Arama chips for what the assistant understood (assistant.ts). Prices arrive formatted. */
  chips: {
    gender: { kadin: "여성", erkek: "남성", cocuk: "키즈" },
    under: (p: string) => `${p} 이하`,
    over: (p: string) => `${p} 이상`,
    size: (s: string) => `사이즈 ${s}`,
    sale: "할인 중",
    cheapest: "낮은 가격순",
  },
};
