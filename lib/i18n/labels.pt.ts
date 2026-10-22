import type { LibLabelsPartial } from "./types";

/**
 * European Portuguese (Portugal, not Brazil) labels: shelf names, colour names, assistant chips.
 *
 * Translate from labels.en.ts (same keys; its header explains them), with the
 * Turkish source names in productTypes.ts for nuance. Every key is optional:
 * anything left out shows in English. A key that does not exist in
 * labels.en.ts fails to compile.
 *
 * Sentence case, plural, in the wording Portuguese shops use (sapatilhas,
 * fatos de banho, sabrinas, malas, champôs, maquilhagem).
 */
export const pt: LibLabelsPartial = {
  /** Shelf names, keyed by productTypes.ts type key. */
  types: {
    makyaj: "Maquilhagem",
    parfum: "Perfumes",
    sac: "Cabelo",
    "cilt-bakim": "Cuidados de pele",
    "kisisel-bakim": "Higiene pessoal",
    ayakkabi: "Sapatos",
    canta: "Malas",
    mayo: "Moda praia",
    "ic-giyim": "Roupa interior",
    elbise: "Vestidos",
    "dis-giyim": "Casacos",
    triko: "Malhas e sweatshirts",
    ust: "Tops",
    alt: "Partes de baixo",
    aksesuar: "Acessórios",
  },
  groups: {
    giyim: "Roupa",
    ayakkabi: "Sapatos",
    canta: "Malas",
    aksesuar: "Acessórios",
    kozmetik: "Beleza",
  },
  /** Keyed `type:subtype` — subtype keys repeat across types (see labels.en.ts). */
  subtypes: {
    "alt:etek": "Saias",
    "alt:sort": "Calções",
    "alt:tayt": "Leggings e joggers",
    "alt:jean": "Jeans",
    "alt:pantolon": "Calças",

    "ust:tisort": "T-shirts",
    "ust:gomlek": "Camisas",
    "ust:bluz": "Blusas",
    "ust:atlet": "Tops e crop tops",
    "ust:tunik": "Túnicas",

    "dis-giyim:trenckot": "Gabardinas",
    "dis-giyim:blazer": "Blazers",
    "dis-giyim:yelek": "Coletes",
    "dis-giyim:mont": "Casacos e acolchoados",
    "dis-giyim:ceket": "Blusões",

    "ayakkabi:bot": "Botas e botins",
    "ayakkabi:topuklu": "Sapatos de salto",
    "ayakkabi:sneaker": "Sapatilhas",
    "ayakkabi:sandalet": "Sandálias e chinelos",
    "ayakkabi:babet": "Sabrinas e mocassins",

    "cilt-bakim:gunes": "Proteção solar",
    "cilt-bakim:maske": "Máscaras",
    "cilt-bakim:serum": "Séruns",
    "cilt-bakim:goz": "Contorno de olhos",
    "cilt-bakim:dudak": "Cuidado de lábios",
    "cilt-bakim:temizleyici": "Limpeza facial",
    "cilt-bakim:nemlendirici": "Hidratantes",

    "elbise:tulum": "Macacões",
    "elbise:abiye": "Vestidos de cerimónia",
    "elbise:gomlek": "Vestidos camiseiros",
    "elbise:maksi": "Vestidos compridos",
    "elbise:midi": "Vestidos midi",
    "elbise:mini": "Vestidos curtos",

    "kisisel-bakim:hijyen": "Higiene íntima",
    "kisisel-bakim:agiz": "Higiene oral",
    "kisisel-bakim:banyo": "Banho e duche",
    "kisisel-bakim:tiras": "Barbear e depilação",
    "kisisel-bakim:mendil": "Toalhitas",
    "kisisel-bakim:yara": "Pensos rápidos",

    "triko:hirka": "Casacos de malha",
    "triko:sweatshirt": "Sweatshirts e hoodies",
    "triko:polo": "Polos",
    "triko:kazak": "Camisolas",

    "ic-giyim:pijama": "Pijamas e roupa de dormir",
    "ic-giyim:corap": "Meias e collants",
    "ic-giyim:sutyen": "Soutiens",
    "ic-giyim:kulot": "Cuecas e boxers",
    "ic-giyim:atlet": "Camisolas interiores e bodies",

    "mayo:bikini": "Biquínis",
    "mayo:mayo": "Fatos de banho",
    "mayo:deniz-sortu": "Calções de banho",
    "mayo:plaj": "Roupa de praia",

    "canta:cuzdan": "Carteiras e porta-cartões",
    "canta:sirt": "Mochilas",
    "canta:tote": "Totes e shoppers",
    "canta:capraz": "Malas a tiracolo e de ombro",
    "canta:el": "Malas de mão",
    "canta:valiz": "Malas de viagem",
    "canta:canta-aksesuar": "Acessórios para malas",

    "aksesuar:gozluk": "Óculos",
    "aksesuar:sapka": "Chapéus e gorros",
    "aksesuar:kemer": "Cintos",
    "aksesuar:sal": "Lenços e echarpes",
    "aksesuar:taki": "Joias e bijuteria",
    "aksesuar:kolye": "Colares",
    "aksesuar:kupe": "Brincos",
    "aksesuar:bileklik": "Pulseiras",
    "aksesuar:yuzuk": "Anéis",
    "aksesuar:saat": "Relógios",
    "aksesuar:toka": "Acessórios de cabelo",

    "makyaj:dudak": "Lábios",
    "makyaj:goz": "Olhos",
    "makyaj:yuz": "Rosto",
    "makyaj:oje": "Unhas",
    "makyaj:firca": "Pincéis e acessórios",
    "makyaj:temizleme": "Desmaquilhantes",

    "parfum:deodorant": "Desodorizantes",
    "parfum:edp": "Eau de parfum",
    "parfum:edt": "Eau de toilette",
    "parfum:vucut": "Brumas corporais",
    "parfum:ev": "Aromas para casa",
    "parfum:set": "Coffrets de perfume",

    "sac:boya": "Coloração",
    "sac:sampuan": "Champôs",
    "sac:maske": "Máscaras e óleos",
    "sac:sekillendirici": "Produtos de styling",
    "sac:krem": "Amaciadores e tratamentos",
  },
  /** The shelf for products no type caught (productTypes.ts UNTYPED). */
  untyped: "Outros produtos",
  /** Colour-filter names, keyed by colors.ts COLOR_FAMILIES key. */
  colors: {
    lacivert: "Azul-marinho",
    siyah: "Preto",
    beyaz: "Branco",
    gri: "Cinzento",
    bej: "Bege",
    kahverengi: "Castanho",
    kirmizi: "Vermelho",
    pembe: "Rosa",
    mor: "Roxo",
    mavi: "Azul",
    yesil: "Verde",
    sari: "Amarelo",
    turuncu: "Laranja",
    metalik: "Metalizado",
    "cok-renkli": "Multicolor",
  },
  /** The Intelligent Search chips for what the assistant understood (assistant.ts). Prices arrive formatted. */
  chips: {
    gender: { kadin: "Mulher", erkek: "Homem", cocuk: "Criança" },
    under: (p: string) => `até ${p}`,
    over: (p: string) => `acima de ${p}`,
    size: (s: string) => `Tamanho ${s}`,
    sale: "Em promoção",
    cheapest: "Mais barato",
  },
};
