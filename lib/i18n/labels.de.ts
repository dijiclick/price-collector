import type { LibLabelsPartial } from "./types";

/**
 * German labels: shelf names, colour names, assistant chips.
 *
 * Translate from labels.en.ts (same keys; its header explains them), with the
 * Turkish source names in productTypes.ts for nuance. Every key is optional:
 * anything left out shows in English. A key that does not exist in
 * labels.en.ts fails to compile.
 *
 * Shelf names are plural nouns in the wording German shops use (Zalando,
 * H&M, About You, Douglas for beauty) — "Jacken & Mäntel", "Teint", "Shopper".
 */
export const de: LibLabelsPartial = {
  /** Shelf names, keyed by productTypes.ts type key. */
  types: {
    makyaj: "Make-up",
    parfum: "Düfte",
    sac: "Haarpflege",
    "cilt-bakim": "Hautpflege",
    "kisisel-bakim": "Körperpflege",
    ayakkabi: "Schuhe",
    canta: "Taschen",
    mayo: "Bademode",
    "ic-giyim": "Dessous & Wäsche",
    elbise: "Kleider",
    "dis-giyim": "Jacken & Mäntel",
    triko: "Strick & Sweats",
    ust: "Oberteile",
    alt: "Hosen & Röcke",
    aksesuar: "Accessoires",
  },
  groups: {
    giyim: "Bekleidung",
    ayakkabi: "Schuhe",
    canta: "Taschen",
    aksesuar: "Accessoires",
    kozmetik: "Beauty",
  },
  /** Keyed `type:subtype` — subtype keys repeat across types (see labels.en.ts). */
  subtypes: {
    "alt:etek": "Röcke",
    "alt:sort": "Shorts",
    "alt:tayt": "Leggings & Jogginghosen",
    "alt:jean": "Jeans",
    "alt:pantolon": "Hosen",

    "ust:tisort": "T-Shirts",
    "ust:gomlek": "Hemden",
    "ust:bluz": "Blusen",
    "ust:atlet": "Tops & Croptops",
    "ust:tunik": "Tuniken",

    "dis-giyim:trenckot": "Trenchcoats",
    "dis-giyim:blazer": "Blazer",
    "dis-giyim:yelek": "Westen",
    "dis-giyim:mont": "Mäntel & Steppjacken",
    "dis-giyim:ceket": "Jacken",

    "ayakkabi:bot": "Stiefel & Stiefeletten",
    "ayakkabi:topuklu": "High Heels",
    "ayakkabi:sneaker": "Sneaker",
    "ayakkabi:sandalet": "Sandalen & Pantoletten",
    "ayakkabi:babet": "Ballerinas & Loafer",

    "cilt-bakim:gunes": "Sonnenschutz",
    "cilt-bakim:maske": "Masken",
    "cilt-bakim:serum": "Seren",
    "cilt-bakim:goz": "Augenpflege",
    "cilt-bakim:dudak": "Lippenpflege",
    "cilt-bakim:temizleyici": "Reinigung",
    "cilt-bakim:nemlendirici": "Feuchtigkeitspflege",

    "elbise:tulum": "Jumpsuits",
    "elbise:abiye": "Fest- & Abendkleider",
    "elbise:gomlek": "Hemdblusenkleider",
    "elbise:maksi": "Maxikleider",
    "elbise:midi": "Midikleider",
    "elbise:mini": "Minikleider",

    "kisisel-bakim:hijyen": "Damenhygiene",
    "kisisel-bakim:agiz": "Mundpflege",
    "kisisel-bakim:banyo": "Bad & Dusche",
    "kisisel-bakim:tiras": "Rasur & Haarentfernung",
    "kisisel-bakim:mendil": "Feuchttücher",
    "kisisel-bakim:yara": "Pflaster",

    "triko:hirka": "Strickjacken",
    "triko:sweatshirt": "Sweatshirts & Hoodies",
    "triko:polo": "Poloshirts",
    "triko:kazak": "Pullover",

    "ic-giyim:pijama": "Schlafanzüge & Nachtwäsche",
    "ic-giyim:corap": "Socken & Strumpfhosen",
    "ic-giyim:sutyen": "BHs",
    "ic-giyim:kulot": "Slips & Boxershorts",
    "ic-giyim:atlet": "Unterhemden & Bodys",

    "mayo:bikini": "Bikinis",
    "mayo:mayo": "Badeanzüge",
    "mayo:deniz-sortu": "Badeshorts",
    "mayo:plaj": "Strandmode",

    "canta:cuzdan": "Geldbörsen & Kartenetuis",
    "canta:sirt": "Rucksäcke",
    "canta:tote": "Shopper",
    "canta:capraz": "Umhänge- & Schultertaschen",
    "canta:el": "Handtaschen",
    "canta:valiz": "Koffer & Reisegepäck",
    "canta:canta-aksesuar": "Taschenzubehör",

    "aksesuar:gozluk": "Brillen & Sonnenbrillen",
    "aksesuar:sapka": "Hüte & Mützen",
    "aksesuar:kemer": "Gürtel",
    "aksesuar:sal": "Schals & Tücher",
    "aksesuar:taki": "Schmuck",
    "aksesuar:kolye": "Halsketten",
    "aksesuar:kupe": "Ohrringe",
    "aksesuar:bileklik": "Armbänder",
    "aksesuar:yuzuk": "Ringe",
    "aksesuar:saat": "Uhren",
    "aksesuar:toka": "Haarschmuck",

    "makyaj:dudak": "Lippen",
    "makyaj:goz": "Augen",
    "makyaj:yuz": "Teint",
    "makyaj:oje": "Nägel",
    "makyaj:firca": "Pinsel & Tools",
    "makyaj:temizleme": "Abschminken",

    "parfum:deodorant": "Deodorants",
    "parfum:edp": "Eau de Parfum",
    "parfum:edt": "Eau de Toilette",
    "parfum:vucut": "Body Mists",
    "parfum:ev": "Raumdüfte",
    "parfum:set": "Duftsets",

    "sac:boya": "Haarfarben",
    "sac:sampuan": "Shampoos",
    "sac:maske": "Masken & Öle",
    "sac:sekillendirici": "Styling",
    "sac:krem": "Spülungen & Pflege",
  },
  /** The shelf for products no type caught (productTypes.ts UNTYPED). */
  untyped: "Weitere Produkte",
  /** Colour-filter names, keyed by colors.ts COLOR_FAMILIES key. */
  colors: {
    lacivert: "Dunkelblau",
    siyah: "Schwarz",
    beyaz: "Weiß",
    gri: "Grau",
    bej: "Beige",
    kahverengi: "Braun",
    kirmizi: "Rot",
    pembe: "Rosa",
    mor: "Lila",
    mavi: "Blau",
    yesil: "Grün",
    sari: "Gelb",
    turuncu: "Orange",
    metalik: "Metallic",
    "cok-renkli": "Mehrfarbig",
  },
  /** The Akıllı Arama chips for what the assistant understood (assistant.ts). Prices arrive formatted. */
  chips: {
    gender: { kadin: "Damen", erkek: "Herren", cocuk: "Kinder" },
    under: (p: string) => `unter ${p}`,
    over: (p: string) => `über ${p}`,
    size: (s: string) => `Größe ${s}`,
    sale: "Im Sale",
    cheapest: "Günstigste",
  },
};
