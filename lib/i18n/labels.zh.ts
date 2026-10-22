import type { LibLabelsPartial } from "./types";

/**
 * Simplified Chinese display names for the browse taxonomy. Same keys as
 * labels.en.ts (see its header: keys stay Turkish, subtypes are keyed
 * `type:subtype`). Taobao/Tmall/Sephora CN category wording.
 */
export const zh: LibLabelsPartial = {
  /** Shelf names, keyed by productTypes.ts type key. */
  types: {
    makyaj: "彩妆",
    parfum: "香水",
    sac: "护发",
    "cilt-bakim": "护肤",
    "kisisel-bakim": "个人护理",
    ayakkabi: "鞋履",
    canta: "包袋",
    mayo: "泳装",
    "ic-giyim": "内衣",
    elbise: "连衣裙",
    "dis-giyim": "外套",
    triko: "针织卫衣",
    ust: "上装",
    alt: "下装",
    aksesuar: "配饰",
  },
  groups: {
    giyim: "服装",
    ayakkabi: "鞋履",
    canta: "包袋",
    aksesuar: "配饰",
    kozmetik: "美妆",
  },
  /** Keyed `type:subtype` — subtype keys repeat across types (see labels.en.ts). */
  subtypes: {
    "alt:etek": "半身裙",
    "alt:sort": "短裤",
    "alt:tayt": "打底裤",
    "alt:jean": "牛仔裤",
    "alt:pantolon": "休闲裤",

    "ust:tisort": "T恤",
    "ust:gomlek": "衬衫",
    "ust:bluz": "雪纺衫",
    "ust:atlet": "背心吊带",
    "ust:tunik": "长款上衣",

    "dis-giyim:trenckot": "风衣",
    "dis-giyim:blazer": "西装外套",
    "dis-giyim:yelek": "马甲",
    "dis-giyim:mont": "大衣羽绒服",
    "dis-giyim:ceket": "夹克",

    "ayakkabi:bot": "靴子",
    "ayakkabi:topuklu": "高跟鞋",
    "ayakkabi:sneaker": "运动鞋",
    "ayakkabi:sandalet": "凉拖鞋",
    "ayakkabi:babet": "平底鞋",

    "cilt-bakim:gunes": "防晒",
    "cilt-bakim:maske": "面膜",
    "cilt-bakim:serum": "精华",
    "cilt-bakim:goz": "眼部护理",
    "cilt-bakim:dudak": "唇部护理",
    "cilt-bakim:temizleyici": "洁面",
    "cilt-bakim:nemlendirici": "乳液面霜",

    "elbise:tulum": "连体裤",
    "elbise:abiye": "礼服裙",
    "elbise:gomlek": "衬衫裙",
    "elbise:maksi": "长款",
    "elbise:midi": "中长款",
    "elbise:mini": "短款",

    "kisisel-bakim:hijyen": "卫生巾",
    "kisisel-bakim:agiz": "口腔护理",
    "kisisel-bakim:banyo": "沐浴",
    "kisisel-bakim:tiras": "剃须脱毛",
    "kisisel-bakim:mendil": "湿巾",
    "kisisel-bakim:yara": "创可贴",

    "triko:hirka": "开衫",
    "triko:sweatshirt": "卫衣",
    "triko:polo": "Polo衫",
    "triko:kazak": "毛衣",

    "ic-giyim:pijama": "睡衣",
    "ic-giyim:corap": "袜子丝袜",
    "ic-giyim:sutyen": "文胸",
    "ic-giyim:kulot": "内裤",
    "ic-giyim:atlet": "背心连体衣",

    "mayo:bikini": "比基尼",
    "mayo:mayo": "连体泳衣",
    "mayo:deniz-sortu": "沙滩裤",
    "mayo:plaj": "沙滩装",

    "canta:cuzdan": "钱包卡包",
    "canta:sirt": "双肩包",
    "canta:tote": "托特包",
    "canta:capraz": "单肩斜挎包",
    "canta:el": "手提包",
    "canta:valiz": "旅行箱包",
    "canta:canta-aksesuar": "包包配件",

    "aksesuar:gozluk": "眼镜",
    "aksesuar:sapka": "帽子",
    "aksesuar:kemer": "腰带",
    "aksesuar:sal": "围巾",
    "aksesuar:taki": "首饰",
    "aksesuar:kolye": "项链",
    "aksesuar:kupe": "耳环",
    "aksesuar:bileklik": "手链",
    "aksesuar:yuzuk": "戒指",
    "aksesuar:saat": "手表",
    "aksesuar:toka": "发饰",

    "makyaj:dudak": "唇妆",
    "makyaj:goz": "眼妆",
    "makyaj:yuz": "面部彩妆",
    "makyaj:oje": "美甲",
    "makyaj:firca": "化妆工具",
    "makyaj:temizleme": "卸妆",

    "parfum:deodorant": "止汗露",
    "parfum:edp": "浓香水",
    "parfum:edt": "淡香水",
    "parfum:vucut": "身体喷雾",
    "parfum:ev": "家居香氛",
    "parfum:set": "香水礼盒",

    "sac:boya": "染发",
    "sac:sampuan": "洗发水",
    "sac:maske": "发膜精油",
    "sac:sekillendirici": "造型",
    "sac:krem": "护发素",
  },
  /** The shelf for products no type caught (productTypes.ts UNTYPED). */
  untyped: "其他商品",
  /** Colour-filter names, keyed by colors.ts COLOR_FAMILIES key. */
  colors: {
    lacivert: "藏青",
    siyah: "黑色",
    beyaz: "白色",
    gri: "灰色",
    bej: "米色",
    kahverengi: "棕色",
    kirmizi: "红色",
    pembe: "粉色",
    mor: "紫色",
    mavi: "蓝色",
    yesil: "绿色",
    sari: "黄色",
    turuncu: "橙色",
    metalik: "金属色",
    "cok-renkli": "多色",
  },
  /** The Akıllı Arama chips for what the assistant understood (assistant.ts). Prices arrive formatted. */
  chips: {
    gender: { kadin: "女装", erkek: "男装", cocuk: "童装" },
    under: (p: string) => `${p}以下`,
    over: (p: string) => `${p}以上`,
    size: (s: string) => `尺码 ${s}`,
    sale: "打折中",
    cheapest: "最便宜",
  },
};
