import type { LibLabelsPartial } from "./types";

/**
 * Italian labels: shelf names, colour names, assistant chips.
 *
 * Translate from labels.en.ts (same keys; its header explains them), with the
 * Turkish source names in productTypes.ts for nuance. Every key is optional:
 * anything left out shows in English. A key that does not exist in
 * labels.en.ts fails to compile.
 *
 * Plural, sentence case, in the wording Italian fashion and beauty shops use
 * (Zalando, Zara, Sephora, Douglas) rather than dictionary translations.
 */
export const it: LibLabelsPartial = {
  /** Shelf names, keyed by productTypes.ts type key. */
  types: {
    makyaj: "Trucco",
    parfum: "Profumi",
    sac: "Capelli",
    "cilt-bakim": "Cura del viso",
    "kisisel-bakim": "Cura della persona",
    ayakkabi: "Scarpe",
    canta: "Borse",
    mayo: "Moda mare",
    "ic-giyim": "Intimo",
    elbise: "Vestiti",
    "dis-giyim": "Capispalla",
    triko: "Maglieria e felpe",
    ust: "Top e camicie",
    alt: "Pantaloni e gonne",
    aksesuar: "Accessori",
  },
  groups: {
    giyim: "Abbigliamento",
    ayakkabi: "Scarpe",
    canta: "Borse",
    aksesuar: "Accessori",
    kozmetik: "Beauty",
  },
  /** Keyed `type:subtype` — subtype keys repeat across types (see labels.en.ts). */
  subtypes: {
    "alt:etek": "Gonne",
    "alt:sort": "Shorts",
    "alt:tayt": "Leggings e joggers",
    "alt:jean": "Jeans",
    "alt:pantolon": "Pantaloni",

    "ust:tisort": "T-shirt",
    "ust:gomlek": "Camicie",
    "ust:bluz": "Bluse",
    "ust:atlet": "Canotte e crop top",
    "ust:tunik": "Tuniche",

    "dis-giyim:trenckot": "Trench",
    "dis-giyim:blazer": "Blazer",
    "dis-giyim:yelek": "Gilet",
    "dis-giyim:mont": "Cappotti e piumini",
    "dis-giyim:ceket": "Giacche",

    "ayakkabi:bot": "Stivali e stivaletti",
    "ayakkabi:topuklu": "Scarpe con tacco",
    "ayakkabi:sneaker": "Sneakers",
    "ayakkabi:sandalet": "Sandali e ciabatte",
    "ayakkabi:babet": "Ballerine e mocassini",

    "cilt-bakim:gunes": "Solari",
    "cilt-bakim:maske": "Maschere viso",
    "cilt-bakim:serum": "Sieri",
    "cilt-bakim:goz": "Contorno occhi",
    "cilt-bakim:dudak": "Cura delle labbra",
    "cilt-bakim:temizleyici": "Detergenti",
    "cilt-bakim:nemlendirici": "Idratanti",

    "elbise:tulum": "Tute intere",
    "elbise:abiye": "Abiti da cerimonia",
    "elbise:gomlek": "Abiti chemisier",
    "elbise:maksi": "Vestiti lunghi",
    "elbise:midi": "Vestiti midi",
    "elbise:mini": "Vestiti corti",

    "kisisel-bakim:hijyen": "Igiene intima",
    "kisisel-bakim:agiz": "Igiene orale",
    "kisisel-bakim:banyo": "Bagno e doccia",
    "kisisel-bakim:tiras": "Rasatura e depilazione",
    "kisisel-bakim:mendil": "Salviette umidificate",
    "kisisel-bakim:yara": "Cerotti",

    "triko:hirka": "Cardigan",
    "triko:sweatshirt": "Felpe",
    "triko:polo": "Polo",
    "triko:kazak": "Maglioni",

    "ic-giyim:pijama": "Pigiami e camicie da notte",
    "ic-giyim:corap": "Calze e collant",
    "ic-giyim:sutyen": "Reggiseni",
    "ic-giyim:kulot": "Slip e boxer",
    "ic-giyim:atlet": "Canottiere e body",

    "mayo:bikini": "Bikini",
    "mayo:mayo": "Costumi interi",
    "mayo:deniz-sortu": "Boxer da mare",
    "mayo:plaj": "Copricostumi",

    "canta:cuzdan": "Portafogli e portacarte",
    "canta:sirt": "Zaini",
    "canta:tote": "Tote e shopper",
    "canta:capraz": "Borse a tracolla e a spalla",
    "canta:el": "Borse a mano",
    "canta:valiz": "Valigie e viaggio",
    "canta:canta-aksesuar": "Accessori per borse",

    "aksesuar:gozluk": "Occhiali",
    "aksesuar:sapka": "Cappelli e berretti",
    "aksesuar:kemer": "Cinture",
    "aksesuar:sal": "Sciarpe e foulard",
    "aksesuar:taki": "Gioielli",
    "aksesuar:kolye": "Collane",
    "aksesuar:kupe": "Orecchini",
    "aksesuar:bileklik": "Bracciali",
    "aksesuar:yuzuk": "Anelli",
    "aksesuar:saat": "Orologi",
    "aksesuar:toka": "Accessori per capelli",

    "makyaj:dudak": "Labbra",
    "makyaj:goz": "Occhi",
    "makyaj:yuz": "Viso",
    "makyaj:oje": "Unghie",
    "makyaj:firca": "Pennelli e accessori",
    "makyaj:temizleme": "Struccanti",

    "parfum:deodorant": "Deodoranti",
    "parfum:edp": "Eau de parfum",
    "parfum:edt": "Eau de toilette",
    "parfum:vucut": "Body mist",
    "parfum:ev": "Profumi per la casa",
    "parfum:set": "Cofanetti profumo",

    "sac:boya": "Colorazione",
    "sac:sampuan": "Shampoo",
    "sac:maske": "Maschere e oli",
    "sac:sekillendirici": "Styling",
    "sac:krem": "Balsami e trattamenti",
  },
  /** The shelf for products no type caught (productTypes.ts UNTYPED). */
  untyped: "Altri prodotti",
  /** Colour-filter names, keyed by colors.ts COLOR_FAMILIES key. */
  colors: {
    lacivert: "Blu navy",
    siyah: "Nero",
    beyaz: "Bianco",
    gri: "Grigio",
    bej: "Beige",
    kahverengi: "Marrone",
    kirmizi: "Rosso",
    pembe: "Rosa",
    mor: "Viola",
    mavi: "Blu",
    yesil: "Verde",
    sari: "Giallo",
    turuncu: "Arancione",
    metalik: "Metallizzato",
    "cok-renkli": "Multicolore",
  },
  materials: {
    knit: "Maglieria",
    wool: "Lana",
    cashmere: "Cashmere",
    leather: "Pelle",
    "faux-leather": "Ecopelle",
    suede: "Camoscio",
    linen: "Lino",
    silk: "Seta",
    satin: "Raso",
    velvet: "Velluto",
    corduroy: "Velluto a coste",
    denim: "Denim",
    cotton: "Cotone",
    fleece: "Pile",
    sequin: "Paillettes",
    lace: "Pizzo",
    chiffon: "Chiffon",
    tweed: "Tweed",
    mesh: "Rete e tulle",
  },
  /** The Akıllı Arama chips for what the assistant understood (assistant.ts). Prices arrive formatted. */
  chips: {
    gender: { kadin: "Donna", erkek: "Uomo", cocuk: "Bambini" },
    under: (p: string) => `meno di ${p}`,
    over: (p: string) => `più di ${p}`,
    size: (s: string) => `Taglia ${s}`,
    sale: "In offerta",
    cheapest: "Più economici",
  },
};
