/**
 * Colour families — the vocabulary behind the feed's colour filter.
 *
 * Brands name colours freely ("Koyu devetüyü", "Kirli beyaz", "HÂKİ", "Maroon",
 * "Donuk Mavi") and half of them leave the field empty and put the colour in the
 * product name instead ("Beyaz Kadın … T-Shirt", Penti's "…, 500 SİYAH"). A
 * filter needs a small fixed set, so every product is mapped once, at write
 * time, to one family here and stored as `products.color_family`.
 *
 * Patterns run on `fold`ed text (Turkish diacritics stripped, lowercase) and
 * cover Turkish plus the languages the international storefronts use (EN, FR,
 * DE, ES, IT). The EARLIEST colour word in the text wins: "Koyu mavi/beyaz" is
 * blue, and a name's colour comes before the garment ("Beyaz Kadın Gömlek").
 * Order inside the table only breaks ties at the same position — so the
 * specific words (lacivert, bordo, ekru) sit before the general ones.
 *
 * Plain JS-compatible TS with no app imports: the collector, the API and the
 * app all read it.
 */
import { fold } from "./productTypes";

export interface ColorFamily {
  key: string;
  tr: string;
  en: string;
  /** Swatch colour for the filter chip. */
  hex: string;
  re: RegExp;
}

// prettier-ignore
export const COLOR_FAMILIES: ColorFamily[] = [
  { key: "lacivert",   tr: "Lacivert",    en: "Navy",        hex: "#1f2a44", re: /lacivert|denizci|\bnavy|\bmarine\b|\bmarino\b|dunkelblau|bleu marine|\bblu notte/ },
  { key: "siyah",      tr: "Siyah",       en: "Black",       hex: "#111111", re: /siyah|\bblack|\bnoir|schwarz|\bnegro|\bnero\b|\bzwart|\bsvart/ },
  { key: "beyaz",      tr: "Beyaz",       en: "White",       hex: "#ffffff", re: /beyaz|ekru|\becru|\bkrem\b|\bcream|\bivory|fildisi|off[ -]?white|\bwhite|\bblanc|\bweiss|\bweiß|\bblanco|\bbianco|\bwit\b|\bvit\b|\bhvit|\bhvid/ },
  { key: "gri",        tr: "Gri",         en: "Grey",        hex: "#9a9a9a", re: /\bgri\b|antrasit|anthracite|fume\b|\bgrey|\bgray|charcoal|\bgris\b|\bgrau\b|\bgrigio|\bgrijs|\bgra\b/ },
  { key: "bej",        tr: "Bej",         en: "Beige",       hex: "#d9c3a5", re: /\bbej\b|\bbeige|camel|devetuyu|\bten\b|\bnude\b|\bkum\b|\bsand|\btaupe|vizon|\bstone\b|\bkhaki beige|\btan\b/ },
  { key: "kahverengi", tr: "Kahverengi",  en: "Brown",       hex: "#7a4e2d", re: /kahve|\bbrown|\bmarron|\bbraun|\bmarrone|\bbruin|\bbrun\b|\btaba\b|tarcin|cikolata|chocolate|cognac|konyak|\bmocha/ },
  { key: "kirmizi",    tr: "Kırmızı",     en: "Red",         hex: "#c0262d", re: /kirmizi|\bred\b|\brouge|\brot\b|\brojo|\brosso|\brood\b|\broed|bordo|burgundy|bordeaux|maroon|visne|\bcherry|\bwine\b/ },
  { key: "pembe",      tr: "Pembe",       en: "Pink",        hex: "#f2a7c3", re: /pembe|\bpink|\brose\b|\brosa\b|\broze\b|fusya|fuchsia|pudra|\bblush\b|\bgul\b|magenta/ },
  { key: "mor",        tr: "Mor",         en: "Purple",      hex: "#7b4ea3", re: /\bmor\b|\bpurple|\bviolet|\bviola\b|\blila|\blilac|lavanta|lavender|\bmurdum|eflatun|\bmorado|\bplum\b|\bpaars|\blilla/ },
  { key: "mavi",       tr: "Mavi",        en: "Blue",        hex: "#3d7fd1", re: /\bmavi|\bblue|\bbleu|\bblau|\bazul|\bblu\b|\bblauw|\bbla\b|indigo|\bdenim|\bkot\b|\bsky\b|\bcobalt/ },
  { key: "yesil",      tr: "Yeşil",       en: "Green",       hex: "#3f8a4f", re: /yesil|\bgreen|\bvert\b|\bgrun|\bgrün|\bverde|\bgroen|\bgron|haki|khaki|olive|zeytin|\bmint|\bnane|turkuaz|turquoise|\bteal|petrol|\bsage|\bkaki/ },
  { key: "sari",       tr: "Sarı",        en: "Yellow",      hex: "#efc93a", re: /\bsari\b|yellow|\bjaune|\bgelb|amarillo|\bgiallo|\bgeel|hardal|mustard|\blime\b|limon/ },
  { key: "turuncu",    tr: "Turuncu",     en: "Orange",      hex: "#ee7a2f", re: /turuncu|\borange|\bnaranja|\barancio|\boranje|mercan|\bcoral|kiremit|terracotta|terrakotta|somon|salmon|\brust\b|\bpas\b/ },
  { key: "metalik",    tr: "Metalik",     en: "Metallic",    hex: "#c9b26b", re: /\baltin|\bgold|\bdore|\bdoré|\bdorado|\boro\b|gumus|\bsilver|\bargent|\bsilber|\bplata\b|\bargento|metalik|metallic|\bbronz|\bbronze|\bcopper|\bbakir/ },
  { key: "cok-renkli", tr: "Çok renkli",  en: "Multicolour", hex: "linear", re: /cok renkli|\bmulti|\bmix\b|rengarenk|\bprint\b|desenli|cizgili|striped|ekose|\bcheck/ },
];

/** Cosmetics names are full of colour-ish words that are not the product's colour. */
const NO_NAME_FALLBACK = new Set(["makyaj", "cilt-bakim", "kisisel-bakim", "parfum", "sac"]);

function earliest(text: string): string | null {
  let best: { key: string; at: number } | null = null;
  for (const f of COLOR_FAMILIES) {
    const m = f.re.exec(text);
    if (m && (!best || m.index < best.at)) best = { key: f.key, at: m.index };
  }
  return best?.key ?? null;
}

/**
 * Every colour family the product is sold in — what the colour filter matches
 * against (`products.color_families`, any-of).
 *
 *   - the brand's colour field ("Kirli beyaz") and its list of colours (Koton,
 *     Massimo Dutti, Pull&Bear, Stradivarius list every colour on one row), so a
 *     product offered in black and beige answers both filters;
 *   - only when neither names one, the product name — for garments, shoes, bags
 *     and accessories, not cosmetics (a lipstick's "Rose" is a shade name).
 */
export function colorFamilies(
  colorName: string | null | undefined,
  variantColors: readonly unknown[] | null | undefined,
  name: string | null | undefined,
  type?: string | null,
): string[] {
  const out = new Set<string>();
  const field = colorName ? earliest(fold(colorName)) : null;
  if (field) out.add(field);
  for (const c of variantColors ?? []) {
    const label = typeof c === "string" ? c : (c as { label?: unknown; name?: unknown })?.label ?? (c as { name?: unknown })?.name;
    const f = typeof label === "string" ? earliest(fold(label)) : null;
    if (f) out.add(f);
  }
  if (out.size === 0 && !(type && NO_NAME_FALLBACK.has(type)) && name) {
    const f = earliest(fold(name));
    if (f) out.add(f);
  }
  return [...out];
}

export const colorLabel = (key: string, lang: "tr" | "en" = "tr"): string =>
  COLOR_FAMILIES.find((c) => c.key === key)?.[lang] ?? key;
