import type { LibLabelsPartial } from "./types";

/**
 * Arabic (Gulf: AE/SA/KW/QA; Modern Standard Arabic) labels: shelf names, colour names, assistant chips.
 *
 * Translate from labels.en.ts (same keys; its header explains them), with the
 * Turkish source names in productTypes.ts for nuance. Every key is optional:
 * anything left out shows in English. A key that does not exist in
 * labels.en.ts fails to compile.
 *
 * Shelf names are plural and indefinite, in the wording Gulf fashion shops use
 * (Namshi, H&M, Zara in the Gulf): loanwords where the shops use them
 * ("جينز", "بليزرات", "سنيكرز"), not dictionary coinages. strings.ar.ts builds
 * "كل الفساتين" from the type and group names below, so a renamed shelf there
 * wants its definite form updated too (ALL_OF in strings.ar.ts).
 */
export const ar: LibLabelsPartial = {
  /** Shelf names, keyed by productTypes.ts type key. */
  types: {
    makyaj: "مكياج",
    parfum: "عطور",
    sac: "العناية بالشعر",
    "cilt-bakim": "العناية بالبشرة",
    "kisisel-bakim": "العناية الشخصية",
    ayakkabi: "أحذية",
    canta: "حقائب",
    mayo: "ملابس السباحة والشاطئ",
    "ic-giyim": "ملابس داخلية",
    elbise: "فساتين",
    "dis-giyim": "معاطف وجاكيتات",
    triko: "تريكو وسويت شيرت",
    ust: "بلايز",
    alt: "قطع سفلية",
    aksesuar: "إكسسوارات",
  },
  groups: {
    giyim: "ملابس",
    ayakkabi: "أحذية",
    canta: "حقائب",
    aksesuar: "إكسسوارات",
    kozmetik: "الجمال",
  },
  /** Keyed `type:subtype` — subtype keys repeat across types (see labels.en.ts). */
  subtypes: {
    "alt:etek": "تنانير",
    "alt:sort": "شورتات",
    "alt:tayt": "ليقنز وبناطيل رياضية",
    "alt:jean": "جينز",
    "alt:pantolon": "بناطيل",

    "ust:tisort": "تيشيرتات",
    "ust:gomlek": "قمصان",
    "ust:bluz": "بلوزات",
    "ust:atlet": "بلا أكمام وكروب توب",
    "ust:tunik": "تونيك",

    "dis-giyim:trenckot": "معاطف ترنش",
    "dis-giyim:blazer": "بليزرات",
    "dis-giyim:yelek": "صديريات",
    "dis-giyim:mont": "معاطف وجاكيتات منفوخة",
    "dis-giyim:ceket": "جاكيتات",

    "ayakkabi:bot": "بوت",
    "ayakkabi:topuklu": "أحذية بكعب",
    "ayakkabi:sneaker": "سنيكرز",
    "ayakkabi:sandalet": "صنادل وشباشب",
    "ayakkabi:babet": "أحذية مسطحة ولوفر",

    "cilt-bakim:gunes": "واقيات الشمس",
    "cilt-bakim:maske": "ماسكات",
    "cilt-bakim:serum": "سيروم",
    "cilt-bakim:goz": "العناية بالعين",
    "cilt-bakim:dudak": "العناية بالشفاه",
    "cilt-bakim:temizleyici": "منظفات",
    "cilt-bakim:nemlendirici": "مرطبات",

    "elbise:tulum": "جمبسوت",
    "elbise:abiye": "فساتين سهرة ومناسبات",
    "elbise:gomlek": "فساتين قميص",
    "elbise:maksi": "ماكسي",
    "elbise:midi": "ميدي",
    "elbise:mini": "ميني",

    "kisisel-bakim:hijyen": "العناية النسائية",
    "kisisel-bakim:agiz": "العناية بالفم",
    "kisisel-bakim:banyo": "الاستحمام",
    "kisisel-bakim:tiras": "الحلاقة وإزالة الشعر",
    "kisisel-bakim:mendil": "مناديل مبللة",
    "kisisel-bakim:yara": "لاصقات جروح",

    "triko:hirka": "كارديغان",
    "triko:sweatshirt": "سويت شيرت وهوديز",
    "triko:polo": "قمصان بولو",
    "triko:kazak": "كنزات",

    "ic-giyim:pijama": "بيجامات وملابس نوم",
    "ic-giyim:corap": "جوارب وكولونات",
    "ic-giyim:sutyen": "حمالات صدر",
    "ic-giyim:kulot": "سراويل داخلية وبوكسر",
    "ic-giyim:atlet": "فانيلات وبودي",

    "mayo:bikini": "بكيني",
    "mayo:mayo": "مايوهات",
    "mayo:deniz-sortu": "شورتات سباحة",
    "mayo:plaj": "ملابس الشاطئ",

    "canta:cuzdan": "محافظ وحافظات بطاقات",
    "canta:sirt": "حقائب ظهر",
    "canta:tote": "حقائب توت وتسوق",
    "canta:capraz": "حقائب كروس وكتف",
    "canta:el": "حقائب يد",
    "canta:valiz": "حقائب سفر",
    "canta:canta-aksesuar": "إكسسوارات الحقائب",

    "aksesuar:gozluk": "نظارات",
    "aksesuar:sapka": "قبعات وطواقي",
    "aksesuar:kemer": "أحزمة",
    "aksesuar:sal": "أوشحة وشالات",
    "aksesuar:taki": "مجوهرات",
    "aksesuar:kolye": "قلادات",
    "aksesuar:kupe": "أقراط",
    "aksesuar:bileklik": "أساور",
    "aksesuar:yuzuk": "خواتم",
    "aksesuar:saat": "ساعات",
    "aksesuar:toka": "إكسسوارات الشعر",

    "makyaj:dudak": "الشفاه",
    "makyaj:goz": "العيون",
    "makyaj:yuz": "الوجه",
    "makyaj:oje": "الأظافر",
    "makyaj:firca": "فرش وأدوات",
    "makyaj:temizleme": "مزيلات المكياج",

    "parfum:deodorant": "مزيلات العرق",
    "parfum:edp": "أو دو بارفان",
    "parfum:edt": "أو دو تواليت",
    "parfum:vucut": "بخاخات الجسم",
    "parfum:ev": "معطرات المنزل",
    "parfum:set": "أطقم العطور",

    "sac:boya": "صبغات الشعر",
    "sac:sampuan": "شامبو",
    "sac:maske": "ماسكات وزيوت",
    "sac:sekillendirici": "تصفيف الشعر",
    "sac:krem": "بلسم وعناية",
  },
  /** The shelf for products no type caught (productTypes.ts UNTYPED). */
  untyped: "منتجات أخرى",
  /** Colour-filter names, keyed by colors.ts COLOR_FAMILIES key. */
  colors: {
    lacivert: "كحلي",
    siyah: "أسود",
    beyaz: "أبيض",
    gri: "رمادي",
    bej: "بيج",
    kahverengi: "بني",
    kirmizi: "أحمر",
    pembe: "وردي",
    mor: "بنفسجي",
    mavi: "أزرق",
    yesil: "أخضر",
    sari: "أصفر",
    turuncu: "برتقالي",
    metalik: "معدني",
    "cok-renkli": "متعدد الألوان",
  },
  materials: {
    knit: "تريكو",
    wool: "صوف",
    cashmere: "كشمير",
    leather: "جلد",
    "faux-leather": "جلد صناعي",
    suede: "شامواه",
    linen: "كتان",
    silk: "حرير",
    satin: "ساتان",
    velvet: "مخمل",
    corduroy: "قطيفة مضلعة",
    denim: "دنيم",
    cotton: "قطن",
    fleece: "فليس",
    sequin: "ترتر",
    lace: "دانتيل",
    chiffon: "شيفون",
    tweed: "تويد",
    mesh: "شبك وتول",
  },
  /** The Akıllı Arama chips for what the assistant understood (assistant.ts). Prices arrive formatted. */
  chips: {
    gender: { kadin: "نساء", erkek: "رجال", cocuk: "أطفال" },
    under: (p: string) => `أقل من ${p}`,
    over: (p: string) => `أكثر من ${p}`,
    size: (s: string) => `المقاس ${s}`,
    sale: "مخفّض",
    cheapest: "الأرخص",
  },
};
