/**
 * Dutch (NL/BE) product words → an English product type the classifier
 * (lib/productTypes.ts, Turkish/English) can file. Used by the Benelux
 * adapters, whose feeds name things in Dutch ("Donkerblauwe jeansshort",
 * "dames enkellaarsjes"). Dutch compounds put the head noun LAST, so most
 * patterns match a word ending (`…laarsjes`, `…broek`); more specific heads
 * come first (zwembroek before broek, boxershort before short, T-shirt before
 * shirt). Returns null when nothing matches — the caller then leaves
 * `category` to whatever the feed says.
 */
const TABLE: [RegExp, string][] = [
  [/zwembroek|zwemshort|badpak|bikini|badmode/, "Swimwear"],
  [/boxershort|boxer\b|slip(s|je)?\b|onderbroek|ondergoed|string\b|lingerie/, "Underwear"],
  [/\bbh\b|beha\b|bralette/, "Bra"],
  [/pyjama|nachthemd|nachtjapon|badjas|ochtendjas/, "Pyjamas"],
  [/sok(ken|jes)?\b|kousen|panty('s)?\b/, "Socks"],
  [/veterschoen|instapper|loafer|mocassin/, "Loafers"],
  [/sneaker|gympen/, "Sneakers"],
  [/laars|laarzen|laarsjes|boots?\b|chelsea/, "Boots"],
  [/pantoffel|sloffen|slof\b/, "Slippers"],
  [/sandaal|sandalen|sandaaltjes/, "Sandals"],
  [/slippers?\b|teenslipper/, "Flip flops"],
  [/pumps?\b|hakken|ballerina/, "Pumps"],
  [/schoen(en|tjes)?\b/, "Shoes"],
  [/rugzak|rugtas/, "Backpack"],
  [/portemonnee|portefeuille|pasjeshouder/, "Wallet"],
  [/(hand|schouder|heup|cross-?body|shopper|strand)?tas(sen|je)?\b/, "Bag"],
  [/riem(en)?\b|ceintuur/, "Belt"],
  [/sjaal|omslagdoek/, "Scarf"],
  [/muts(en)?\b|beanie/, "Beanie"],
  [/\bpet(ten)?\b|cap\b/, "Cap"],
  [/handschoen|wanten/, "Gloves"],
  [/zonnebril/, "Sunglasses"],
  [/horloge/, "Watch"],
  [/oorbel|oorknop|creolen/, "Earrings"],
  [/ketting|collier|hanger\b/, "Necklace"],
  [/armband/, "Bracelet"],
  [/\bring(en)?\b/, "Ring"],
  [/jumpsuit|playsuit|overall/, "Jumpsuit"],
  [/jurk(en|je)?\b|dress/, "Dress"],
  [/rok(ken|je)?\b|skirt/, "Skirt"],
  [/legging/, "Leggings"],
  [/jogg?ingbroek|sweatpants|joggers?\b/, "Joggers"],
  [/jeansshort|short(s)?\b|bermuda/, "Shorts"],
  [/jeans|spijkerbroek|denim\b/, "Jeans"],
  [/broek(en|je)?\b|pantalon|chino|cargo/, "Trousers"],
  [/blazer|colbert/, "Blazer"],
  [/gilet|bodywarmer/, "Gilet"],
  [/parka|mantel|trenchcoat|jas(sen|je)?\b|jack(et)?\b|anorak|windjack/, "Jacket"],
  [/hoodie|hoody/, "Hoodie"],
  [/vest(je)?\b|cardigan/, "Cardigan"],
  [/trui|sweater|pullover|sweatshirt|coltrui/, "Sweater"],
  [/t-?shirt|tee\b/, "T-shirt"],
  [/polo/, "Polo"],
  [/blouse|tuniek/, "Blouse"],
  [/overhemd|hemd\b|shirt/, "Shirt"],
  [/top(je)?\b|singlet|hemdje|tanktop|body\b/, "Top"],
  [/pak\b|kostuum/, "Suit"],
];

export function nlType(...texts: (string | null | undefined)[]): string | null {
  for (const raw of texts) {
    const t = String(raw ?? "").toLowerCase();
    if (!t) continue;
    for (const [re, type] of TABLE) if (re.test(t)) return type;
  }
  return null;
}

/** "dames"/"heren"/"jongens"/"meisjes"/"kinderen"/"baby" (also French) in a title or section → our gender. Kids first. */
export function nlGender(...texts: (string | null | undefined)[]): "kadin" | "erkek" | "cocuk" | null {
  const t = texts.map((x) => String(x ?? "").toLowerCase()).join(" ");
  if (/\b(jongens|meisjes|kinder(en)?|kids|baby|tiener|enfant|fille|garçon|garcon|junior)\b/.test(t)) return "cocuk";
  if (/\b(dames|vrouwen|women|femme)\b/.test(t)) return "kadin";
  if (/\b(heren|mannen|men|homme)\b/.test(t)) return "erkek";
  return null;
}
