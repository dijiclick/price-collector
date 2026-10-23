import type { LibLabelsPartial } from "./types";

/**
 * Traditional Chinese (Hong Kong) labels: shelf names, colour names, assistant chips.
 *
 * Translated from labels.en.ts (same keys; its header explains them), with the
 * Turkish source names in productTypes.ts for nuance. Hong Kong retail wording
 * (恤衫, 半截裙, 大褸, 乾濕褸, 波鞋, 手袋, 背囊, 銀包, 頸鏈, 頸巾, 胸圍, 比堅尼,
 * 啡色), not a character conversion of labels.zh.ts. Every key is optional:
 * anything left out shows in English. A key that does not exist in
 * labels.en.ts fails to compile.
 */
export const zhHant: LibLabelsPartial = {
  /** Shelf names, keyed by productTypes.ts type key. */
  types: {
    makyaj: "化妝品",
    parfum: "香水",
    sac: "護髮",
    "cilt-bakim": "護膚",
    "kisisel-bakim": "個人護理",
    ayakkabi: "鞋履",
    canta: "手袋",
    mayo: "泳衣及沙灘裝",
    "ic-giyim": "內衣",
    elbise: "連身裙",
    "dis-giyim": "外套",
    triko: "針織衫及衛衣",
    ust: "上衣",
    alt: "下裝",
    aksesuar: "配飾",
  },
  groups: {
    giyim: "服裝",
    ayakkabi: "鞋履",
    canta: "手袋",
    aksesuar: "配飾",
    kozmetik: "美容",
  },
  /** Keyed `type:subtype` — subtype keys repeat across types (see labels.en.ts). */
  subtypes: {
    "alt:etek": "半截裙",
    "alt:sort": "短褲",
    "alt:tayt": "緊身褲及運動褲",
    "alt:jean": "牛仔褲",
    "alt:pantolon": "長褲",

    "ust:tisort": "T恤",
    "ust:gomlek": "恤衫",
    "ust:bluz": "女裝上衣",
    "ust:atlet": "背心及短身上衣",
    "ust:tunik": "長身上衣",

    "dis-giyim:trenckot": "乾濕褸",
    "dis-giyim:blazer": "西裝外套",
    "dis-giyim:yelek": "背心外套",
    "dis-giyim:mont": "大褸及羽絨",
    "dis-giyim:ceket": "外套",

    "ayakkabi:bot": "靴",
    "ayakkabi:topuklu": "高跟鞋",
    "ayakkabi:sneaker": "波鞋",
    "ayakkabi:sandalet": "涼鞋及拖鞋",
    "ayakkabi:babet": "平底鞋及樂福鞋",

    "cilt-bakim:gunes": "防曬",
    "cilt-bakim:maske": "面膜",
    "cilt-bakim:serum": "精華",
    "cilt-bakim:goz": "眼部護理",
    "cilt-bakim:dudak": "唇部護理",
    "cilt-bakim:temizleyici": "潔面",
    "cilt-bakim:nemlendirici": "保濕",

    "elbise:tulum": "連身褲",
    "elbise:abiye": "晚裝及禮服",
    "elbise:gomlek": "恤衫裙",
    "elbise:maksi": "長裙",
    "elbise:midi": "中長裙",
    "elbise:mini": "短裙",

    "kisisel-bakim:hijyen": "衛生巾",
    "kisisel-bakim:agiz": "口腔護理",
    "kisisel-bakim:banyo": "沐浴",
    "kisisel-bakim:tiras": "剃鬚及脫毛",
    "kisisel-bakim:mendil": "濕紙巾",
    "kisisel-bakim:yara": "膠布",

    "triko:hirka": "開襟衫",
    "triko:sweatshirt": "衛衣及連帽衛衣",
    "triko:polo": "Polo恤",
    "triko:kazak": "毛衣",

    "ic-giyim:pijama": "睡衣",
    "ic-giyim:corap": "襪及絲襪",
    "ic-giyim:sutyen": "胸圍",
    "ic-giyim:kulot": "內褲",
    "ic-giyim:atlet": "背心及連身衣",

    "mayo:bikini": "比堅尼",
    "mayo:mayo": "連身泳衣",
    "mayo:deniz-sortu": "泳褲",
    "mayo:plaj": "沙灘裝",

    "canta:cuzdan": "銀包及卡套",
    "canta:sirt": "背囊",
    "canta:tote": "Tote袋",
    "canta:capraz": "斜揹袋及肩袋",
    "canta:el": "手挽袋",
    "canta:valiz": "行李箱及旅行袋",
    "canta:canta-aksesuar": "手袋配件",

    "aksesuar:gozluk": "眼鏡",
    "aksesuar:sapka": "帽",
    "aksesuar:kemer": "皮帶",
    "aksesuar:sal": "頸巾及披肩",
    "aksesuar:taki": "首飾",
    "aksesuar:kolye": "頸鏈",
    "aksesuar:kupe": "耳環",
    "aksesuar:bileklik": "手鏈",
    "aksesuar:yuzuk": "戒指",
    "aksesuar:saat": "手錶",
    "aksesuar:toka": "髮飾",

    "makyaj:dudak": "唇部",
    "makyaj:goz": "眼部",
    "makyaj:yuz": "面部",
    "makyaj:oje": "指甲油",
    "makyaj:firca": "化妝掃及工具",
    "makyaj:temizleme": "卸妝",

    "parfum:deodorant": "止汗劑",
    "parfum:edp": "淡香精",
    "parfum:edt": "淡香水",
    "parfum:vucut": "身體香氛噴霧",
    "parfum:ev": "家居香氛",
    "parfum:set": "香水禮盒",

    "sac:boya": "染髮",
    "sac:sampuan": "洗髮水",
    "sac:maske": "髮膜及護髮油",
    "sac:sekillendirici": "造型",
    "sac:krem": "護髮素及護理",
  },
  /** The shelf for products no type caught (productTypes.ts UNTYPED). */
  untyped: "其他商品",
  /** Colour-filter names, keyed by colors.ts COLOR_FAMILIES key. */
  colors: {
    lacivert: "海軍藍",
    siyah: "黑色",
    beyaz: "白色",
    gri: "灰色",
    bej: "米色",
    kahverengi: "啡色",
    kirmizi: "紅色",
    pembe: "粉紅色",
    mor: "紫色",
    mavi: "藍色",
    yesil: "綠色",
    sari: "黃色",
    turuncu: "橙色",
    metalik: "金屬色",
    "cok-renkli": "多色",
  },
  materials: {
    knit: "針織",
    wool: "羊毛",
    cashmere: "羊絨",
    leather: "皮革",
    "faux-leather": "人造皮革",
    suede: "麂皮",
    linen: "亞麻",
    silk: "真絲",
    satin: "緞面",
    velvet: "絲絨",
    corduroy: "燈芯絨",
    denim: "牛仔",
    cotton: "棉",
    fleece: "抓絨",
    sequin: "亮片",
    lace: "蕾絲",
    chiffon: "雪紡",
    tweed: "粗花呢",
    mesh: "網紗",
  },
  /** The Akıllı Arama chips for what the assistant understood (assistant.ts). Prices arrive formatted. */
  chips: {
    gender: { kadin: "女裝", erkek: "男裝", cocuk: "童裝" },
    under: (p: string) => `${p} 以下`,
    over: (p: string) => `${p} 以上`,
    size: (s: string) => `${s} 碼`,
    sale: "減價中",
    cheapest: "最低價",
  },
};
