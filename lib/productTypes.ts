import { appLang } from "./format";
import { GROUP_LABELS_EN, SUBTYPE_LABELS_EN, TYPE_LABELS_EN } from "./productLabels.en";

/**
 * The canonical cross-brand product taxonomy — the single vocabulary shared by
 * the collector (which classifies every product into one of these), the feed
 * filters, and search (which routes category words to a type instead of
 * substring-matching them against the product name).
 *
 * It lives in `lib/` rather than the collector because all three consumers need
 * it and the collector already imports from here (see `../../../lib/format`).
 * Keeping one table means a new synonym improves classification AND search in
 * the same edit — which matters, because brands share no vocabulary: the same
 * shelf is CEKET at Zara, Kaban at Boyner, Yelek at Koton and blazer at Guess.
 *
 * Matching runs on ASCII-folded text (see `fold`) so Turkish uppercase
 * ("ELBİSE"), Turkish lowercase ("elbise") and English names ("SLIP", "SHORT")
 * are all reachable with one set of patterns — brands mix all three.
 */

export interface ProductType {
  key: string;
  /** Turkish label shown on the filter chip. */
  label: string;
  re: RegExp;
}

/** Lowercase and strip Turkish diacritics so patterns can be plain ASCII. */
export function fold(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/̇/g, "") // combining dot from lowercasing "İ"
    .replace(/[ıî]/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/[çc]/g, "c")
    .replace(/â/g, "a")
    .replace(/û/g, "u");
}

/**
 * Classification precedence — the FIRST match wins, so the most specific rules
 * come first. This is deliberately not the display order (see
 * `PRODUCT_TYPE_ORDER`): "ruj" must be tested before "ust" would ever see it.
 */
// prettier-ignore
export const PRODUCT_TYPES: ProductType[] = [
  { key: "makyaj",     label: "Makyaj",        re: /ruj|lipstick|fondoten|foundation|maskara|mascara|allik|blush|\boje\b|nail|tirnak|manikur|eyeliner|kapatici|concealer|makyaj|makeup|parlatici|lip gloss|dudak parlat|\bfar\b|eyeshadow|goz far|pudra|powder|dudak kalem|lip liner|kas kalem|brow|likit ruj|highlight|bronzer|aydinlatici|rimel|kirpik|\blash|primer|kontur|contour|duzeltici|corrector|sunger|sponge|firca|brush|aplikator/i },
  { key: "parfum",     label: "Parfüm",        re: /parfum|perfume|\bedt\b|\bedp\b|\bkoku\b|deodorant|eau de/i },
  // `durulanmayan` (leave-in) and a BOUNDED `sac … krem` — "Saç İçin
  // Durulanmayan Bakım Kremi" says saç and krem four words apart, which
  // `sac krem` could never see. Two candidates were measured and rejected:
  // `bukle`, because bouclé is a fabric and it moved 100+ garments here, and an
  // unbounded `sac`, which matches inside "saçaklı" (fringed) and did the same.
  { key: "sac",        label: "Saç Bakımı",    re: /sampuan|shampoo|sac bak|sac krem|sac maske|kondisyoner|conditioner|sac boya|sac spray|\bhair\b|durulanmayan|\bsac\b[a-z ]{0,24}krem/i },
  // Two Turkish traps here.
  // `\bmaske` intentionally lacks a closing boundary: the language agglutinates,
  // so "Onarım Maskesi" never matched `\bmaske\b` and the product went untyped.
  // `krem` is also a COLOUR ("Krem Kadın V Yaka Elbise"), and since this rule
  // outranks the garment rules it was filing cream-coloured dresses under
  // skincare. The lookahead drops the colour reading — it is always followed by
  // what it describes — while "Nemlendirici Krem" and "El Kremi" still match.
  // Shaving sits AHEAD of skincare, and is the same shelf as the kisisel-bakim
  // rule further down — it is split out only for its position. "Tıraş Kremi" is
  // a cream, and the moment the rule below learned to read the Turkish suffix
  // it took the entire shaving aisle: 40 products, measured, including every
  // Arko and Nivea Men foam and gel.
  { key: "kisisel-bakim", label: "Kişisel Bakım", re: /tiras|shave|jilet|razor|\bagda\b|epilas/i },
  { key: "cilt-bakim", label: "Cilt Bakımı",   re: /\bkrem(?:i|ler|leri|lerinde|inde)?\b(?!\s+(?:kadin|erkek|cocuk|unisex|rengi|renk|beyaz|siyah))|\bcream\b|serum|nemlendir|moistur|temizle|cleanser|\bmaske|face mask|tonik|\btoner\b|peeling|gunes|sunscreen|\bspf\b|cilt bak|el kremi|goz krem|micellar|misel/i },
  // Drugstores are a third of the catalogue and sell far more than cosmetics.
  // Before this, 43% of Gratis, 24% of Watsons and 22% of Rossmann products
  // matched NO type at all — plasters, pads, wipes, oral care, shaving — so they
  // were unreachable by category browsing entirely. Measured on 600 products:
  // 40 rescued from having no type, 0 taken from an existing one.
  //
  // Placed after cilt-bakim deliberately: "vücut kremi" is skincare's to claim
  // first, and this only picks up what nothing else wanted.
  { key: "kisisel-bakim", label: "Kişisel Bakım", re: /hijyenik ped|\bped\b|tampon|molped|orkid|kotex|panty ?liner|islak mendil|\bmendil\b|dis macunu|dis fircasi|gargara|agiz bakim|mouthwash|toothpaste|toothbrush|dis ipi|vucut losyon|dus jeli|shower gel|\bbanyo\b|\bsabun|\bsoap\b|body lotion|body wash|tiras|shave|jilet|razor|epilas|\bagda\b|yara band|band-?aid|\bpamuk\b|kulak cubu/i },
  { key: "ayakkabi",   label: "Ayakkabı",      re: /ayakkabi|\bshoe|sneaker|\bbot\b|\bboot|topuklu|\bheel|sandalet|sandal|terlik|slipper|espadril|babet|\bflat\b|cizme|loafer|makosen/i },
  // `\bbag\b` used to be here on its own, and it quietly claimed garments:
  // folding turns the Turkish "bağ" (tie, strap) into "bag", so every "Bağ
  // detaylı gömlek" — a tie-detail SHIRT — was filed as a handbag. Mango names
  // a lot of things that way. Requiring an English compound keeps "shoulder
  // bag" working while "bağ detaylı" no longer matches anything here.
  { key: "canta",      label: "Çanta",         re: /canta|\b(?:hand|shoulder|tote|bucket|cross ?body|gym|beach|duffle|shopper|top ?handle)[ -]?bag\b|cuzdan|wallet|sirt cant|backpack|clutch|postaci|crossbody|\btote\b/i },
  { key: "mayo",       label: "Mayo & Plaj",   re: /\bmayo\b|bikini|plaj|beach|swim/i },
  // `\bklt\b` is Penti's own abbreviation for külot ("PRETTY LOLIPOP KLT., 1,
  // MERCAN"); without it a chunk of their catalogue carried no type at all.
  { key: "ic-giyim",   label: "İç Giyim",      re: /ic giyim|ic camasir|underwear|lingerie|sutyen|\bbra\b|bralet|bralette|kulot|\bklt\b|panty|panties|brief|thong|slip\b|corap|\bsock|hosiery|tights|pijama|pajama|pyjama|gecelik|nightgown|homewear|loungewear|sabahlik|jartiyer|garter|legging|soket|\bskt\b|\bsne\b|\bsn\b|\blace\b|\bmesh\b|\b\dl[iu]?\b|\bsut\b|push ?up|highwaist|high waist|\b\d{2}[a-f]\b|\b\d\d-\d\d\b/i },
  { key: "elbise",     label: "Elbise",        re: /elbise|dress|tulum|jumpsuit|salopet|romper/i },
  // `manto` and `pardosu` are Boyner's words for a coat — both were missing, so
  // "Kruvaze Manto" and "Oversize Pardösü" fell through to no type.
  { key: "dis-giyim",  label: "Dış Giyim",     re: /ceket|jacket|kaban|\bcoat|\bmont\b|manto|pardosu|trenckot|trench|palto|blazer|yelek|\bvest\b|parka|anorak|bomber|pelerin|\bcape\b/i },
  { key: "triko",      label: "Triko & Sweat", re: /kazak|sweater|pullover|jumper|hirka|cardigan|triko|\bknit|sweat|hood/i },
  // Üst before Alt: a garment word must beat a MATERIAL word. "Denim gömlek"
  // is a shirt, but `denim` sits in Alt and was winning. Measured over 480
  // products: one row moves, and it is the denim shirt. (The same trick does
  // NOT work for triko — tried, it moved 71 and broke 55, because "Moschino
  // Jeans" is a brand name that hits the Alt regex.)
  { key: "ust",        label: "Üst Giyim",     re: /tisort|t-?shirt|tshirt|\btee\b|gomlek|\bshirt|bluz|blouse|\btop\b|\bust\b|atlet|\btank|\bbody\b|bodysuit|\bcrop|halter|bustier|bustiyer|korse|corset/i },
  { key: "alt",        label: "Alt Giyim",     re: /pantolon|trouser|\bpants\b|\bpant\b|\bjean|denim|\bkot\b|etek|\bskirt|\bsort|\bshort|bermuda|\btayt\b|jogger|palazzo|chino|esofman|kapri|capri|biker|\bpnt\b/i },
  { key: "aksesuar",   label: "Aksesuar",      re: /atki|scarf|sapka|\bhat\b|\bcap\b|\bbere\b|beanie|kemer|\bbelt|taki|jewel|kolye|necklace|kupe|earring|yuzuk|\bring\b|bileklik|bilezik|bracelet|charm|gozluk|sunglass|glasses|eldiven|glove|\bsaat\b|watch|sac band|headband|\btoka\b|fular|\bsal\b|shawl|bros|brooch|piercing|anahtarlik|keychain/i },
];

/** Classify a product into a canonical type key, or null if nothing matches. */
export function classifyType(category: string | null | undefined, name: string): string | null {
  const text = fold(`${category ?? ""} ${name ?? ""}`);
  for (const t of PRODUCT_TYPES) if (t.re.test(text)) return t.key;
  return null;
}

/**
 * Which type a single search word names, or null. Anchored: the word must BE a
 * category word, not merely contain one — otherwise "botanical" would resolve to
 * footwear via `\bbot\b`, which is the bug this whole mechanism exists to kill.
 */
/**
 * Singular forms to try for a word, most-literal first.
 *
 * `typeForWord` anchors its patterns, so the word has to match a vocabulary
 * entry WHOLE — which meant every plural missed. Measured against the live API:
 * "shoe" returned 7,400 products and "shoes" returned 1; "elbise" 7,085 and
 * "elbiseler" 0. Turkish plurals mattered most, being the language the app is
 * actually used in.
 *
 * Turkish marks plural with -lar/-ler by vowel harmony, so both are stripped.
 * English -s/-es covers the loanwords the vocabulary already carries (shoes,
 * dresses, jackets). Length floors keep short words intact — "bag" must not be
 * reduced to "ba", and "sac" (hair) must survive as itself.
 */
export function singularCandidates(w: string): string[] {
  const out = [w];
  // Turkish first: -lar/-ler are unambiguous plural markers here.
  if (/(lar|ler)$/.test(w) && w.length > 5) out.push(w.slice(0, -3));
  // English -es before -s, so "dresses" yields "dress" and not "dresse".
  if (/(s|x|z|ch|sh)es$/.test(w) && w.length > 4) out.push(w.slice(0, -2));
  if (/s$/.test(w) && w.length > 3) out.push(w.slice(0, -1));
  return out;
}

/**
 * Words that route a SEARCH to a shelf but must NOT classify a product name.
 *
 * "bag" forced this split. Folding turns the Turkish "bağ" (tie, strap) into
 * "bag", so as a classifier it claimed every "Bağ detaylı gömlek" — a shirt —
 * as a handbag. As a SEARCH word it is unambiguous, because typeForWord only
 * ever sees one word at a time and anchors it end to end. One regex could not
 * serve both jobs, so the search-only half lives here.
 */
const SEARCH_ALIASES: Record<string, string> = { bag: "canta" };

export function typeForWord(word: string): string | null {
  const w = fold(word).trim();
  if (w.length < 2) return null;
  // Exact form first, so nothing that already matched changes meaning; a
  // de-pluralised guess only ever runs when the literal word matched nothing.
  for (const cand of singularCandidates(w)) {
    const alias = SEARCH_ALIASES[cand];
    if (alias) return alias;
    for (const t of PRODUCT_TYPES) {
      // Re-anchor the alternation so it must consume the entire word.
      const anchored = new RegExp(`^(?:${t.re.source})$`, "i");
      if (anchored.test(cand)) return t.key;
    }
  }
  return null;
}

export const PRODUCT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  PRODUCT_TYPES.map((t) => [t.key, t.label]),
);

/**
 * Canonical chip order — types are shown in this sequence when present. Kept
 * explicit and separate from `PRODUCT_TYPES` because that array is ordered by
 * classification precedence, which puts cosmetics first and reads oddly in a
 * fashion filter bar.
 */
export const PRODUCT_TYPE_ORDER = [
  "elbise", "ust", "alt", "dis-giyim", "triko", "ic-giyim", "mayo",
  "ayakkabi", "canta", "aksesuar", "makyaj", "cilt-bakim", "kisisel-bakim", "parfum", "sac",
];

/**
 * What a shelf is called, in the language in force.
 *
 * English falls back to the Turkish label rather than the raw key, so a type
 * added without an English name shows "Triko" — recognisable — instead of
 * "triko" reading as a bug.
 */
export const productTypeLabel = (key: string): string =>
  (appLang() === "en" ? TYPE_LABELS_EN[key] : undefined) ?? PRODUCT_TYPE_LABELS[key] ?? key;

export const productGroupLabel = (key: string): string =>
  (appLang() === "en" ? GROUP_LABELS_EN[key] : undefined) ??
  PRODUCT_GROUPS.find((g) => g.key === key)?.label ??
  key;

/**
 * Two-level browse taxonomy: a handful of groups over the flat type list.
 *
 * The 14 types are what the collector actually classifies, and they are a flat
 * set — fine as filter chips, poor as a browse tree, which is why the app had
 * no category screen. These groups add the missing top level WITHOUT inventing
 * data: every member below is a real type with real products behind it.
 *
 * A third level (Elbise → Midi, Abiye) is deliberately absent. It would need
 * classification the collector does not do, and a category that returns nothing
 * is worse than one that does not exist.
 */
export interface ProductGroup {
  key: string;
  label: string;
  types: string[];
}

export const PRODUCT_GROUPS: ProductGroup[] = [
  { key: "giyim", label: "Giyim", types: ["elbise", "ust", "alt", "dis-giyim", "triko", "ic-giyim", "mayo"] },
  { key: "ayakkabi", label: "Ayakkabı", types: ["ayakkabi"] },
  { key: "canta", label: "Çanta", types: ["canta"] },
  { key: "aksesuar", label: "Aksesuar", types: ["aksesuar"] },
  { key: "kozmetik", label: "Kozmetik", types: ["makyaj", "cilt-bakim", "kisisel-bakim", "parfum", "sac"] },
];

/** Every type covered by a group — guards against a new type going unbrowsable. */
export const GROUPED_TYPES = new Set(PRODUCT_GROUPS.flatMap((g) => g.types));

/**
 * Every literal word the type vocabulary knows, for spell-correction.
 *
 * Pulled from the same regexes that do the matching, so the two cannot drift —
 * a synonym added to a pattern becomes correctable in the same edit. Only plain
 * alphabetic alternatives are taken: anything with regex machinery in it
 * (`\bedt\b`, `sac bak`) is either an abbreviation too short to correct
 * safely or a multi-word phrase this never sees, since correction runs per token.
 */
export const TYPE_VOCABULARY: string[] = Array.from(
  new Set(
    PRODUCT_TYPES.flatMap((t) =>
      t.re.source
        .split("|")
        .map((alt) => alt.replace(/\\b|\\y/g, "").trim())
        .filter((alt) => /^[a-z]{4,}$/.test(alt)),
    ).concat(Object.keys(SEARCH_ALIASES)),
  ),
);

/**
 * Second level, under the types that are too big to browse.
 *
 * NOT derived from the brands' own `category` field, which cannot carry a
 * taxonomy: measured across 14 brands it holds 279 distinct strings that are
 * mostly sub-brand names (Beymen files products under "Divarese", Boyner under
 * "People By Fabrika"), marketing labels ("%60'YE VARAN INDIRIM", "Yeni",
 * "Tümünü gör"), price bands ("990 TL ve altı") — and for Zara, Penti, Guess
 * and Sephora it is null entirely. Four of fourteen brands emit nothing at all.
 *
 * So subtypes come from the product NAME, the same source that already
 * classifies types at 98.1% coverage. Every word below was chosen from measured
 * frequency, not guessed — 3.000 live names per type, all 14 brands:
 *
 *   dis-giyim  99%   mayo       99%   alt        98%   cilt-bakim 98%
 *   sac        98%   ust        95%   aksesuar   95%   ayakkabi   93%
 *   makyaj     90%   parfum     87%   triko      82%   ic-giyim   65%
 *   elbise     59%   canta      53%
 *
 * The low three are honest limits of the source, not gaps to paper over: past
 * "Kadın Deri Çanta" and "Siyah Kadın Elbise" the names carry no further
 * attribute. They keep their level because the part that DOES classify is the
 * part shoppers ask for — cüzdan vs sırt çantası, mini vs abiye — and every
 * type list leads with a "Tümü" row, so nothing is unreachable.
 *
 * Only rows with a live count are shown, so a subtype that a season empties out
 * (deniz şortu in winter) disappears rather than leading to a blank feed.
 *
 * ORDER IS PRECEDENCE, most specific first. "Denim etek" is a skirt, not a
 * jean, so `etek` must be tested before `jean`; "denim pantolon" is a jean, so
 * `jean` must come before `pantolon`. Likewise `tisort` before `gomlek`: "shirt"
 * sits inside "t-shirt" with a word boundary between, so a tee reads as a shirt
 * to anything that tests gömlek first.
 */
export interface ProductSubtype {
  key: string;
  label: string;
  re: RegExp;
}

export const PRODUCT_SUBTYPES: Record<string, ProductSubtype[]> = {
  alt: [
    { key: "etek", label: "Etek", re: /ete[kg]|\bskirt/ },
    { key: "sort", label: "Şort", re: /\bsort|short|bermuda|kapri|capri/ },
    { key: "tayt", label: "Tayt & Eşofman", re: /\btayt|legging|esofman|jogger|sweatpant/ },
    { key: "jean", label: "Jean", re: /\bjean|denim|\bkot\b/ },
    { key: "pantolon", label: "Pantolon", re: /pantolon|trouser|\bpants\b|palazzo|chino/ },
  ],
  ust: [
    { key: "tisort", label: "Tişört", re: /tisort|t-?shirt|\btee\b/ },
    { key: "gomlek", label: "Gömlek", re: /gomle[kg]|(?<!t-)\bshirt\b|chemise/ },
    { key: "bluz", label: "Bluz", re: /bluz|blouse/ },
    { key: "atlet", label: "Atlet & Crop", re: /atlet|\bcrop|\bbody\b|kolsuz|halter|bustiyer/ },
    { key: "tunik", label: "Tunik", re: /tunik|tunic/ },
  ],
  "dis-giyim": [
    { key: "trenckot", label: "Trençkot", re: /trenckot|trench|pardosu/ },
    { key: "blazer", label: "Blazer", re: /blazer/ },
    { key: "yelek", label: "Yelek", re: /yele[kg]|\bvest\b/ },
    { key: "mont", label: "Mont & Kaban", re: /\bmont\b|kaban|palto|manto|parka|anorak|puffer|sisme/ },
    { key: "ceket", label: "Ceket", re: /ceket|jacket|bomber/ },
  ],
  ayakkabi: [
    { key: "bot", label: "Bot & Çizme", re: /\bbot(u|lar|lari)?\b|\bboot|cizme/ },
    { key: "topuklu", label: "Topuklu", re: /topuklu|\bheel|stiletto/ },
    { key: "sneaker", label: "Sneaker", re: /sneaker|spor ayakkabi|\btrainer/ },
    { key: "sandalet", label: "Sandalet & Terlik", re: /sandalet|sandal|terlik|slipper|\bmule\b/ },
    { key: "babet", label: "Babet & Loafer", re: /babet|loafer|makosen|\bflat\b|espadril/ },
  ],
  "cilt-bakim": [
    { key: "gunes", label: "Güneş Ürünleri", re: /gunes|\bspf|sunscreen|sun care|bronzlas/ },
    { key: "maske", label: "Maske", re: /maske|\bmask\b/ },
    { key: "serum", label: "Serum", re: /serum|ampul|essence/ },
    { key: "goz", label: "Göz Bakımı", re: /goz cevresi|eye (cream|contour|care)|goz kremi/ },
    { key: "dudak", label: "Dudak Bakımı", re: /dudak bakim|lip balm|lip care|\blip (gluta|butter)/ },
    { key: "temizleyici", label: "Temizleyici", re: /temizle|cleanser|micellar|misel|tonik|toner|peeling|yikama|arindirici/ },
    { key: "nemlendirici", label: "Nemlendirici", re: /nemlendir|moistur|\bkrem|cream|losyon|lotion/ },
  ],
  elbise: [
    // Tulum is a different garment that the brands file under dresses; it leads
    // so "Mini Tulum" is not counted as a mini dress.
    { key: "tulum", label: "Tulum", re: /tulum|jumpsuit|salopet|playsuit/ },
    { key: "abiye", label: "Abiye & Gece", re: /abiye|gece elbise|kokteyl|cocktail|payetli|davet/ },
    { key: "gomlek", label: "Gömlek Elbise", re: /gomle[kg] elbise|shirt dress/ },
    // Length is what Turkish retail facets dresses by, and it is the one
    // attribute the names carry consistently.
    { key: "maksi", label: "Maksi", re: /maksi|maxi|uzun elbise/ },
    { key: "midi", label: "Midi", re: /\bmidi/ },
    { key: "mini", label: "Mini", re: /\bmini|kisa elbise/ },
  ],
  "kisisel-bakim": [
    { key: "hijyen", label: "Hijyenik Ped", re: /hijyenik ped|\bped\b|tampon|molped|orkid|kotex|panty ?liner/ },
    { key: "agiz", label: "Ağız Bakımı", re: /dis macunu|dis fircasi|gargara|agiz bakim|mouthwash|toothpaste|toothbrush|dis ipi/ },
    { key: "banyo", label: "Duş & Banyo", re: /dus jeli|shower gel|\bbanyo\b|\bsabun|\bsoap\b|body wash|vucut losyon|body lotion/ },
    { key: "tiras", label: "Tıraş & Ağda", re: /tiras|shave|jilet|razor|epilas|\bagda\b/ },
    { key: "mendil", label: "Islak Mendil", re: /islak mendil|wet wipe|\bmendil\b/ },
    { key: "yara", label: "Yara Bandı", re: /yara band|band-?aid|plaster/ },
  ],
  triko: [
    { key: "hirka", label: "Hırka", re: /hirka|cardigan/ },
    { key: "sweatshirt", label: "Sweatshirt & Hoodie", re: /sweatshirt|\bsweat\b|hoodie|kapuson/ },
    { key: "polo", label: "Polo", re: /\bpolo/ },
    { key: "kazak", label: "Kazak & Süveter", re: /kazak|suveter|sweater|pullover|balikci|jumper/ },
  ],
  "ic-giyim": [
    { key: "pijama", label: "Pijama & Gecelik", re: /pijama|gecelik|sabahlik|uyku|pyjama|nightwear|bornoz/ },
    { key: "corap", label: "Çorap", re: /corap|\bsock|kulotlu corap|patik|\bskt\b|soket/ },
    { key: "sutyen", label: "Sütyen", re: /sutyen|\bbra\b|bralet|bralette|bustiyer|push up|triangle|balconette/ },
    { key: "kulot", label: "Külot & Boxer", re: /kulot|\bslip\b|boxer|thong|string|brief|tanga|\bklt\b|brazilian|highleg/ },
    { key: "atlet", label: "Atlet & Body", re: /atlet|\bbody\b|fanila|singlet/ },
  ],
  mayo: [
    { key: "bikini", label: "Bikini", re: /bikini/ },
    { key: "mayo", label: "Mayo", re: /\bmayo|swimsuit|maillot/ },
    { key: "deniz-sortu", label: "Deniz Şortu", re: /deniz sortu|swim short|board short|\bsort\b/ },
    { key: "plaj", label: "Plaj Giyim", re: /\bplaj|pareo|kaftan|beach/ },
  ],
  canta: [
    { key: "cuzdan", label: "Cüzdan & Kartlık", re: /cuzdan|wallet|kartlik|card holder|\bpouch/ },
    { key: "sirt", label: "Sırt Çantası", re: /sirt canta|backpack|rucksack/ },
    { key: "tote", label: "Tote & Alışveriş", re: /\btote|alisveris canta|shopper|shopping bag/ },
    { key: "capraz", label: "Çapraz & Omuz", re: /capraz|omuz canta|crossbody|cross body|shoulder bag|baget/ },
    { key: "el", label: "El Çantası", re: /el canta|clutch|abiye canta|bucket|\bmini canta/ },
    { key: "valiz", label: "Valiz & Seyahat", re: /valiz|seyahat|luggage|suitcase|duffel|laptop canta/ },
    { key: "canta-aksesuar", label: "Çanta Aksesuarı", re: /canta aksesuar|canta askisi|canta askı|bag charm/ },
  ],
  aksesuar: [
    { key: "gozluk", label: "Gözlük", re: /gozlu[kg]|sunglass|eyewear/ },
    { key: "sapka", label: "Şapka & Bere", re: /sapka|\bbere\b|kasket|beanie|\bcap\b|fedora|bucket hat/ },
    { key: "kemer", label: "Kemer", re: /kemer|\bbelt/ },
    { key: "sal", label: "Şal & Atkı", re: /\bsal\b|sali\b|fular|atki|esarp|bandana|scarf|eldiven/ },
    { key: "taki", label: "Takı", re: /kupe|kolye|bileklik|bilezik|yuzu[kg]|\bring\b|charm|zincir|earring|necklace|bracelet|anahtarlik|brosc?|piercing|halhal/ },
    { key: "saat", label: "Saat", re: /\bsaat|\bwatch\b/ },
    { key: "toka", label: "Toka & Saç Aksesuarı", re: /\btoka|sac bandi|bandana|hair (clip|tie|pin)|\bbone\b/ },
  ],
  makyaj: [
    // The earlier 40% reading came from testing only a handful of words. Split
    // by the part of the face the product is for — which is how the shelf is
    // shopped — and the names do carry it.
    { key: "dudak", label: "Dudak", re: /\bruj|lipstick|\blip\b|lipgloss|dudak|gloss|\bbalm/ },
    { key: "goz", label: "Göz", re: /maskara|mascara|eyeliner|dipliner|\bfar[i]?\b|\bkas\b|eyeshadow|kirpik|\bgoz\b|goz far|\beye/ },
    { key: "yuz", label: "Yüz", re: /fondoten|foundation|pudra|powder|kapatici|concealer|allik|blush|aydinlatici|highlight|bronzer|kontur|contour|\bbb krem|\bcc krem|primer|makyaj baz|sabitleyici|setting (spray|mist)|\bbaz\b/ },
    { key: "oje", label: "Oje & Tırnak", re: /\boje|nail|tirnak/ },
    { key: "firca", label: "Fırça & Aksesuar", re: /firca|brush|sunger|aplikator|makyaj cantasi|paleti|palette/ },
    { key: "temizleme", label: "Makyaj Temizleme", re: /makyaj temizle|makeup remover|temizleme suyu/ },
  ],
  parfum: [
    { key: "deodorant", label: "Deodorant", re: /deodorant|\bdeo\b|roll-?on|antiperspirant/ },
    { key: "edp", label: "Eau de Parfum", re: /\bedp\b|eau de parfum|parfum spray|extrait/ },
    { key: "edt", label: "Eau de Toilette", re: /\bedt\b|eau de toilette|kolonya|cologne|eau de cologne/ },
    { key: "vucut", label: "Vücut Spreyi", re: /vucut sprey|body (spray|mist)|\bmist\b/ },
    { key: "ev", label: "Ev Kokusu", re: /koku yayici|difuzor|diffuser|oda kokusu|room spray/ },
    { key: "set", label: "Parfüm Seti", re: /\bset\b|\bseti\b|\bkofre/ },
  ],
  sac: [
    { key: "boya", label: "Saç Boyası", re: /boyasi|sac boya|hair colou?r|koleston|palette|\bton\b/ },
    { key: "sampuan", label: "Şampuan", re: /sampuan|shampoo/ },
    { key: "maske", label: "Maske & Bakım Yağı", re: /maske|\bmask\b|sac yagi|hair oil|\bserum|ampul/ },
    { key: "sekillendirici", label: "Şekillendirici", re: /jole|\bwax\b|sprey|kopu[kg]|mousse|sekillendir|\bspray/ },
    // Last: "saç kremi" is the conditioner, but "krem" also appears inside
    // several styling and colour names above.
    { key: "krem", label: "Saç Kremi & Bakım", re: /\bkrem|conditioner|bakim/ },
  ],
};

/**
 * The subtype for a product name within its type, or null.
 *
 * Substring matching is safe here in a way it is not for types: the candidate
 * set is already narrowed to one shelf, so "bot" cannot reach "Botanical
 * Repair" shampoo — that product is cilt-bakim or sac, and never tested against
 * footwear words.
 */
export function subtypeForName(type: string | null | undefined, name: string): string | null {
  if (!type) return null;
  const subs = PRODUCT_SUBTYPES[type];
  if (!subs) return null;
  const n = fold(name);
  for (const s of subs) if (s.re.test(n)) return s.key;
  return null;
}

export const subtypeLabel = (type: string, key: string): string =>
  // `type:key`, because subtype keys repeat: makyaj/goz is eye makeup and
  // cilt-bakim/goz is eye cream. See productLabels.en.ts.
  (appLang() === "en" ? SUBTYPE_LABELS_EN[`${type}:${key}`] : undefined) ??
  PRODUCT_SUBTYPES[type]?.find((s) => s.key === key)?.label ??
  key;
