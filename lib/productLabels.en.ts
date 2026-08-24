/**
 * English display names for the browse taxonomy.
 *
 * Kept apart from `productTypes.ts` because that file is CLASSIFICATION — the
 * regexes there read Turkish product names off Turkish shops, and none of that
 * changes with the reader's language. This file is only what we call the shelf
 * once something has landed on it.
 *
 * Two things a translator should know:
 *
 * Several Turkish shelves are a pair joined with "&" ("Mont & Kaban" — two
 * distinct garments Turkish separates and English does not). Where English has
 * one word for both, it gets one word ("Coats"), not a padded translation.
 *
 * Subtype keys REPEAT across types and mean different things: `goz` under
 * makyaj is eye makeup, `goz` under cilt-bakim is eye cream, and `gomlek`
 * under elbise is a shirt dress. That is why these are keyed `type:subtype`
 * rather than by the bare key — reading them as global would silently mislabel
 * six shelves.
 *
 * Plural, because a shelf holds many. Title Case, matching the Turkish.
 */

export const TYPE_LABELS_EN: Record<string, string> = {
  makyaj: "Makeup",
  parfum: "Fragrance",
  sac: "Hair Care",
  "cilt-bakim": "Skincare",
  "kisisel-bakim": "Personal Care",
  ayakkabi: "Shoes",
  canta: "Bags",
  mayo: "Swim & Beach",
  "ic-giyim": "Lingerie & Underwear",
  elbise: "Dresses",
  "dis-giyim": "Outerwear",
  triko: "Knitwear & Sweats",
  ust: "Tops",
  alt: "Bottoms",
  aksesuar: "Accessories",
};

export const GROUP_LABELS_EN: Record<string, string> = {
  giyim: "Clothing",
  ayakkabi: "Shoes",
  canta: "Bags",
  aksesuar: "Accessories",
  kozmetik: "Beauty",
};

/** Keyed `type:subtype` — see the note above on repeated keys. */
export const SUBTYPE_LABELS_EN: Record<string, string> = {
  "alt:etek": "Skirts",
  "alt:sort": "Shorts",
  "alt:tayt": "Leggings & Joggers",
  "alt:jean": "Jeans",
  "alt:pantolon": "Trousers",

  "ust:tisort": "T-Shirts",
  "ust:gomlek": "Shirts",
  "ust:bluz": "Blouses",
  "ust:atlet": "Vests & Crop Tops",
  "ust:tunik": "Tunics",

  "dis-giyim:trenckot": "Trench Coats",
  "dis-giyim:blazer": "Blazers",
  "dis-giyim:yelek": "Gilets",
  "dis-giyim:mont": "Coats & Puffers",
  "dis-giyim:ceket": "Jackets",

  "ayakkabi:bot": "Boots",
  "ayakkabi:topuklu": "Heels",
  "ayakkabi:sneaker": "Trainers",
  "ayakkabi:sandalet": "Sandals & Sliders",
  "ayakkabi:babet": "Flats & Loafers",

  "cilt-bakim:gunes": "Sun Care",
  "cilt-bakim:maske": "Masks",
  "cilt-bakim:serum": "Serums",
  "cilt-bakim:goz": "Eye Care",
  "cilt-bakim:dudak": "Lip Care",
  "cilt-bakim:temizleyici": "Cleansers",
  "cilt-bakim:nemlendirici": "Moisturisers",

  "elbise:tulum": "Jumpsuits",
  "elbise:abiye": "Occasion & Evening",
  "elbise:gomlek": "Shirt Dresses",
  "elbise:maksi": "Maxi",
  "elbise:midi": "Midi",
  "elbise:mini": "Mini",

  "kisisel-bakim:hijyen": "Period Care",
  "kisisel-bakim:agiz": "Oral Care",
  "kisisel-bakim:banyo": "Bath & Shower",
  "kisisel-bakim:tiras": "Shaving & Hair Removal",
  "kisisel-bakim:mendil": "Wet Wipes",
  "kisisel-bakim:yara": "Plasters",

  "triko:hirka": "Cardigans",
  "triko:sweatshirt": "Sweatshirts & Hoodies",
  "triko:polo": "Polo Shirts",
  "triko:kazak": "Jumpers",

  "ic-giyim:pijama": "Pyjamas & Nightwear",
  "ic-giyim:corap": "Socks & Tights",
  "ic-giyim:sutyen": "Bras",
  "ic-giyim:kulot": "Knickers & Boxers",
  "ic-giyim:atlet": "Vests & Bodysuits",

  "mayo:bikini": "Bikinis",
  "mayo:mayo": "Swimsuits",
  "mayo:deniz-sortu": "Swim Shorts",
  "mayo:plaj": "Beachwear",

  "canta:cuzdan": "Wallets & Cardholders",
  "canta:sirt": "Backpacks",
  "canta:tote": "Totes & Shoppers",
  "canta:capraz": "Crossbody & Shoulder",
  "canta:el": "Handbags",
  "canta:valiz": "Luggage & Travel",
  "canta:canta-aksesuar": "Bag Accessories",

  "aksesuar:gozluk": "Eyewear",
  "aksesuar:sapka": "Hats & Beanies",
  "aksesuar:kemer": "Belts",
  "aksesuar:sal": "Scarves & Wraps",
  "aksesuar:taki": "Jewellery",
  "aksesuar:saat": "Watches",
  "aksesuar:toka": "Hair Accessories",

  "makyaj:dudak": "Lips",
  "makyaj:goz": "Eyes",
  "makyaj:yuz": "Face",
  "makyaj:oje": "Nails",
  "makyaj:firca": "Brushes & Tools",
  "makyaj:temizleme": "Makeup Removal",

  "parfum:deodorant": "Deodorant",
  "parfum:edp": "Eau de Parfum",
  "parfum:edt": "Eau de Toilette",
  "parfum:vucut": "Body Mist",
  "parfum:ev": "Home Fragrance",
  "parfum:set": "Fragrance Sets",

  "sac:boya": "Hair Colour",
  "sac:sampuan": "Shampoo",
  "sac:maske": "Masks & Oils",
  "sac:sekillendirici": "Styling",
  "sac:krem": "Conditioner & Care",
};
