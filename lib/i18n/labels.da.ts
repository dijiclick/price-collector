import type { LibLabelsPartial } from "./types";

/**
 * Danish labels: shelf names, colour names, assistant chips.
 *
 * Translate from labels.en.ts (same keys; its header explains them), with the
 * Turkish source names in productTypes.ts for nuance. Every key is optional:
 * anything left out shows in English. A key that does not exist in
 * labels.en.ts fails to compile.
 *
 * Plural and sentence case, in the wording Danish fashion and beauty shops
 * use on their shelves (Dame/Herre/Børn, "Overdele", "Accessories").
 */
export const da: LibLabelsPartial = {
  types: {
    makyaj: "Makeup",
    parfum: "Parfume",
    sac: "Hårpleje",
    "cilt-bakim": "Hudpleje",
    "kisisel-bakim": "Personlig pleje",
    ayakkabi: "Sko",
    canta: "Tasker",
    mayo: "Badetøj",
    "ic-giyim": "Undertøj & lingeri",
    elbise: "Kjoler",
    "dis-giyim": "Overtøj",
    triko: "Strik & sweatshirts",
    ust: "Overdele",
    alt: "Underdele",
    aksesuar: "Accessories",
  },
  groups: {
    giyim: "Tøj",
    ayakkabi: "Sko",
    canta: "Tasker",
    aksesuar: "Accessories",
    kozmetik: "Skønhed",
  },
  subtypes: {
    "alt:etek": "Nederdele",
    "alt:sort": "Shorts",
    "alt:tayt": "Leggings & joggingbukser",
    "alt:jean": "Jeans",
    "alt:pantolon": "Bukser",

    "ust:tisort": "T-shirts",
    "ust:gomlek": "Skjorter",
    "ust:bluz": "Bluser",
    "ust:atlet": "Tanktoppe & croptoppe",
    "ust:tunik": "Tunikaer",

    "dis-giyim:trenckot": "Trenchcoats",
    "dis-giyim:blazer": "Blazere",
    "dis-giyim:yelek": "Veste",
    "dis-giyim:mont": "Frakker & dynejakker",
    "dis-giyim:ceket": "Jakker",

    "ayakkabi:bot": "Støvler",
    "ayakkabi:topuklu": "Højhælede sko",
    "ayakkabi:sneaker": "Sneakers",
    "ayakkabi:sandalet": "Sandaler & badesandaler",
    "ayakkabi:babet": "Ballerinaer & loafers",

    "cilt-bakim:gunes": "Solpleje",
    "cilt-bakim:maske": "Masker",
    "cilt-bakim:serum": "Serummer",
    "cilt-bakim:goz": "Øjenpleje",
    "cilt-bakim:dudak": "Læbepleje",
    "cilt-bakim:temizleyici": "Ansigtsrens",
    "cilt-bakim:nemlendirici": "Fugtighedscremer",

    "elbise:tulum": "Jumpsuits",
    "elbise:abiye": "Festkjoler",
    "elbise:gomlek": "Skjortekjoler",
    "elbise:maksi": "Maxi",
    "elbise:midi": "Midi",
    "elbise:mini": "Mini",

    "kisisel-bakim:hijyen": "Menstruation",
    "kisisel-bakim:agiz": "Mundpleje",
    "kisisel-bakim:banyo": "Bad & bruser",
    "kisisel-bakim:tiras": "Barbering & hårfjerning",
    "kisisel-bakim:mendil": "Vådservietter",
    "kisisel-bakim:yara": "Plastre",

    "triko:hirka": "Cardigans",
    "triko:sweatshirt": "Sweatshirts & hættetrøjer",
    "triko:polo": "Poloshirts",
    "triko:kazak": "Sweatere",

    "ic-giyim:pijama": "Nattøj & pyjamas",
    "ic-giyim:corap": "Strømper & strømpebukser",
    "ic-giyim:sutyen": "Bh'er",
    "ic-giyim:kulot": "Trusser & boxershorts",
    "ic-giyim:atlet": "Undertrøjer & bodyer",

    "mayo:bikini": "Bikinier",
    "mayo:mayo": "Badedragter",
    "mayo:deniz-sortu": "Badeshorts",
    "mayo:plaj": "Strandtøj",

    "canta:cuzdan": "Punge & kortholdere",
    "canta:sirt": "Rygsække",
    "canta:tote": "Shoppere & totes",
    "canta:capraz": "Crossbody & skuldertasker",
    "canta:el": "Håndtasker",
    "canta:valiz": "Kufferter & rejse",
    "canta:canta-aksesuar": "Tilbehør til tasker",

    "aksesuar:gozluk": "Solbriller & briller",
    "aksesuar:sapka": "Hatte & huer",
    "aksesuar:kemer": "Bælter",
    "aksesuar:sal": "Tørklæder",
    "aksesuar:taki": "Smykker",
    "aksesuar:kolye": "Halskæder",
    "aksesuar:kupe": "Øreringe",
    "aksesuar:bileklik": "Armbånd",
    "aksesuar:yuzuk": "Ringe",
    "aksesuar:saat": "Ure",
    "aksesuar:toka": "Hårtilbehør",

    "makyaj:dudak": "Læber",
    "makyaj:goz": "Øjne",
    "makyaj:yuz": "Ansigt",
    "makyaj:oje": "Negle",
    "makyaj:firca": "Pensler & værktøjer",
    "makyaj:temizleme": "Makeupfjerner",

    "parfum:deodorant": "Deodorant",
    "parfum:edp": "Eau de Parfum",
    "parfum:edt": "Eau de Toilette",
    "parfum:vucut": "Bodymist",
    "parfum:ev": "Boligduft",
    "parfum:set": "Parfumesæt",

    "sac:boya": "Hårfarve",
    "sac:sampuan": "Shampoo",
    "sac:maske": "Hårkure & olier",
    "sac:sekillendirici": "Styling",
    "sac:krem": "Balsam & pleje",
  },
  untyped: "Andre produkter",
  colors: {
    lacivert: "Marineblå",
    siyah: "Sort",
    beyaz: "Hvid",
    gri: "Grå",
    bej: "Beige",
    kahverengi: "Brun",
    kirmizi: "Rød",
    pembe: "Lyserød",
    mor: "Lilla",
    mavi: "Blå",
    yesil: "Grøn",
    sari: "Gul",
    turuncu: "Orange",
    metalik: "Metallic",
    "cok-renkli": "Flerfarvet",
  },
  chips: {
    gender: { kadin: "Dame", erkek: "Herre", cocuk: "Børn" },
    under: (p: string) => `under ${p}`,
    over: (p: string) => `over ${p}`,
    size: (s: string) => `Str. ${s}`,
    sale: "På udsalg",
    cheapest: "Billigste",
  },
};
