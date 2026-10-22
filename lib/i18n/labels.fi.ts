import type { LibLabelsPartial } from "./types";

/**
 * Finnish labels: shelf names, colour names, assistant chips.
 *
 * Translated from labels.en.ts (same keys; its header explains them), with the
 * Turkish source names in productTypes.ts for nuance. Plural, sentence case,
 * in the wording Finnish fashion retail uses (Zalando, Lindex, KappAhl). Every
 * key is optional: anything left out shows in English. A key that does not
 * exist in labels.en.ts fails to compile.
 */
export const fi: LibLabelsPartial = {
  /** Shelf names, keyed by productTypes.ts type key. */
  types: {
    makyaj: "Meikit",
    parfum: "Tuoksut",
    sac: "Hiustenhoito",
    "cilt-bakim": "Ihonhoito",
    "kisisel-bakim": "Hygienia",
    ayakkabi: "Kengät",
    canta: "Laukut",
    mayo: "Uima- ja rantavaatteet",
    "ic-giyim": "Alusvaatteet",
    elbise: "Mekot",
    "dis-giyim": "Takit",
    triko: "Neuleet ja colleget",
    ust: "Yläosat",
    alt: "Alaosat",
    aksesuar: "Asusteet",
  },
  groups: {
    giyim: "Vaatteet",
    ayakkabi: "Kengät",
    canta: "Laukut",
    aksesuar: "Asusteet",
    kozmetik: "Kauneus",
  },
  /** Keyed `type:subtype` — subtype keys repeat across types (see labels.en.ts). */
  subtypes: {
    "alt:etek": "Hameet",
    "alt:sort": "Shortsit",
    "alt:tayt": "Leggingsit ja collegehousut",
    "alt:jean": "Farkut",
    "alt:pantolon": "Housut",

    "ust:tisort": "T-paidat",
    "ust:gomlek": "Kauluspaidat",
    "ust:bluz": "Puserot",
    "ust:atlet": "Topit ja croptopit",
    "ust:tunik": "Tunikat",

    "dis-giyim:trenckot": "Trenssitakit",
    "dis-giyim:blazer": "Bleiserit",
    "dis-giyim:yelek": "Liivit",
    "dis-giyim:mont": "Talvi- ja toppatakit",
    "dis-giyim:ceket": "Kevyet takit",

    "ayakkabi:bot": "Saappaat ja nilkkurit",
    "ayakkabi:topuklu": "Korkokengät",
    "ayakkabi:sneaker": "Tennarit",
    "ayakkabi:sandalet": "Sandaalit ja sandaletit",
    "ayakkabi:babet": "Ballerinat ja loaferit",

    "cilt-bakim:gunes": "Aurinkosuojat",
    "cilt-bakim:maske": "Kasvonaamiot",
    "cilt-bakim:serum": "Seerumit",
    "cilt-bakim:goz": "Silmänympärysvoiteet",
    "cilt-bakim:dudak": "Huulten hoito",
    "cilt-bakim:temizleyici": "Puhdistustuotteet",
    "cilt-bakim:nemlendirici": "Kosteusvoiteet",

    "elbise:tulum": "Haalarit",
    "elbise:abiye": "Juhlamekot",
    "elbise:gomlek": "Paitamekot",
    "elbise:maksi": "Maksimekot",
    "elbise:midi": "Midimekot",
    "elbise:mini": "Minimekot",

    "kisisel-bakim:hijyen": "Kuukautissuojat",
    "kisisel-bakim:agiz": "Suunhoito",
    "kisisel-bakim:banyo": "Kylpy ja suihku",
    "kisisel-bakim:tiras": "Parranajo ja karvanpoisto",
    "kisisel-bakim:mendil": "Kosteuspyyhkeet",
    "kisisel-bakim:yara": "Laastarit",

    "triko:hirka": "Neuletakit",
    "triko:sweatshirt": "Collegepaidat ja hupparit",
    "triko:polo": "Pikeepaidat",
    "triko:kazak": "Neulepuserot",

    "ic-giyim:pijama": "Pyjamat ja yöasut",
    "ic-giyim:corap": "Sukat ja sukkahousut",
    "ic-giyim:sutyen": "Rintaliivit",
    "ic-giyim:kulot": "Alushousut ja bokserit",
    "ic-giyim:atlet": "Aluspaidat ja bodyt",

    "mayo:bikini": "Bikinit",
    "mayo:mayo": "Uimapuvut",
    "mayo:deniz-sortu": "Uimashortsit",
    "mayo:plaj": "Rantavaatteet",

    "canta:cuzdan": "Lompakot ja korttikotelot",
    "canta:sirt": "Reput",
    "canta:tote": "Tote- ja ostoslaukut",
    "canta:capraz": "Olka- ja crossbody-laukut",
    "canta:el": "Käsilaukut",
    "canta:valiz": "Matkalaukut",
    "canta:canta-aksesuar": "Laukkutarvikkeet",

    "aksesuar:gozluk": "Aurinkolasit",
    "aksesuar:sapka": "Hatut ja pipot",
    "aksesuar:kemer": "Vyöt",
    "aksesuar:sal": "Huivit",
    "aksesuar:taki": "Korut",
    "aksesuar:kolye": "Kaulakorut",
    "aksesuar:kupe": "Korvakorut",
    "aksesuar:bileklik": "Rannekorut",
    "aksesuar:yuzuk": "Sormukset",
    "aksesuar:saat": "Kellot",
    "aksesuar:toka": "Hiusasusteet",

    "makyaj:dudak": "Huulet",
    "makyaj:goz": "Silmät",
    "makyaj:yuz": "Kasvot",
    "makyaj:oje": "Kynnet",
    "makyaj:firca": "Siveltimet ja välineet",
    "makyaj:temizleme": "Meikinpoisto",

    "parfum:deodorant": "Deodorantit",
    "parfum:edp": "Eau de Parfum",
    "parfum:edt": "Eau de Toilette",
    "parfum:vucut": "Vartalosuihkeet",
    "parfum:ev": "Kodintuoksut",
    "parfum:set": "Tuoksulahjapakkaukset",

    "sac:boya": "Hiusvärit",
    "sac:sampuan": "Shampoot",
    "sac:maske": "Hiusnaamiot ja -öljyt",
    "sac:sekillendirici": "Muotoilutuotteet",
    "sac:krem": "Hoitoaineet",
  },
  /** The shelf for products no type caught (productTypes.ts UNTYPED). */
  untyped: "Muut tuotteet",
  /** Colour-filter names, keyed by colors.ts COLOR_FAMILIES key. */
  colors: {
    lacivert: "Tummansininen",
    siyah: "Musta",
    beyaz: "Valkoinen",
    gri: "Harmaa",
    bej: "Beige",
    kahverengi: "Ruskea",
    kirmizi: "Punainen",
    pembe: "Vaaleanpunainen",
    mor: "Violetti",
    mavi: "Sininen",
    yesil: "Vihreä",
    sari: "Keltainen",
    turuncu: "Oranssi",
    metalik: "Metallinen",
    "cok-renkli": "Monivärinen",
  },
  /** The Akıllı Arama chips for what the assistant understood (assistant.ts). Prices arrive formatted. */
  chips: {
    gender: { kadin: "Naiset", erkek: "Miehet", cocuk: "Lapset" },
    under: (p: string) => `alle ${p}`,
    over: (p: string) => `yli ${p}`,
    size: (s: string) => `Koko ${s}`,
    sale: "Alennuksessa",
    cheapest: "Halvimmat",
  },
};
