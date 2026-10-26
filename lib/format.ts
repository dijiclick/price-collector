import { COUNTRIES, CURRENCY_STYLE, DEFAULT_COUNTRY, type CountryCode } from "./countries";
import { LOCALE_TAG, type AppLang } from "./lang";

/**
 * The language the app is currently speaking.
 *
 * A module-level value rather than an argument threaded through `tl`,
 * `productTypeLabel` and the 45 price call sites between them — the active
 * language genuinely is one global thing, the way it is in every i18n library.
 *
 * Only the mobile app sets it, from the root layout during render, so every
 * child renders under the right one. The web is Turkish, never calls the
 * setter, and therefore has no shared mutable state across requests.
 */
let lang: AppLang = "tr";

export function setAppLang(l: AppLang): void {
  lang = l;
}

export const appLang = (): AppLang => lang;

/**
 * Format integer minor units (kuruş) as Turkish Lira: 133399 -> "₺1.333,99",
 * or "₺1,333.99" in English.
 *
 * The CURRENCY does not follow the language — these are lira whoever is
 * reading, and converting them would be inventing a price the shop is not
 * charging. Only the separators move.
 */
export function tl(minor: number): string {
  return formatMoney(minor, "TRY");
}

/**
 * How each language writes a number: group separator, decimal mark, and where
 * the percent sign goes. See formatMoney and percent.
 *
 * One table for every language, so a translator never has to touch it: the
 * words live in the per-language files, the punctuation lives here.
 *
 *   - NARROW no-break space (U+202F) for French and the Nordic/German percent
 *     sign: the typographic rule those languages print, and "no-break" so a
 *     price or "61 %" can never wrap between its digits and its sign.
 *   - Plain no-break space (U+00A0) where the group separator is a space
 *     (Swedish, Norwegian, Finnish, Portuguese) — what CLDR and every shop there
 *     prints, and again unbreakable.
 *   - Arabic uses Western digits with English separators: the Gulf shops we
 *     carry print prices that way, and Arabic-Indic digits next to a Latin
 *     currency code read as two scripts fighting.
 */
type NumberStyle = {
  group: string;
  decimal: string;
  pct: "before" | "after" | "after-space";
  /**
   * "after" writes the currency AFTER the amount ("49,95 €", "27,99 £"), the
   * way German, French, Spanish, Italian, Portuguese and Nordic shops print
   * prices — Zalando.de shows "49,95 €", never "€49,95". The symbol is still
   * the currency's; only its place is the reader's. Absent = where the currency
   * puts it (before, except "kr").
   */
  cur?: "after";
};
const NBSP = "\u00a0";
const NNBSP = "\u202f";
const NUMBER_STYLE: Record<AppLang, NumberStyle> = {
  tr: { group: ".", decimal: ",", pct: "before" },
  en: { group: ",", decimal: ".", pct: "after" },
  fr: { group: NNBSP, decimal: ",", pct: "after-space", cur: "after" },
  es: { group: ".", decimal: ",", pct: "after", cur: "after" },
  zh: { group: ",", decimal: ".", pct: "after" },
  // Japanese and Korean write numbers the English way ("1,310.00").
  ja: { group: ",", decimal: ".", pct: "after" },
  ko: { group: ",", decimal: ".", pct: "after" },
  de: { group: ".", decimal: ",", pct: "after-space", cur: "after" },
  it: { group: ".", decimal: ",", pct: "after", cur: "after" },
  pt: { group: NBSP, decimal: ",", pct: "after", cur: "after" },
  // Dutch keeps the sign in front ("€ 49,95"), like English.
  nl: { group: ".", decimal: ",", pct: "after" },
  sv: { group: NBSP, decimal: ",", pct: "after-space", cur: "after" },
  da: { group: ".", decimal: ",", pct: "after-space", cur: "after" },
  nb: { group: NBSP, decimal: ",", pct: "after-space", cur: "after" },
  fi: { group: NBSP, decimal: ",", pct: "after-space", cur: "after" },
  ar: { group: ",", decimal: ".", pct: "after" },
  "zh-Hant": { group: ",", decimal: ".", pct: "after" },
};

/** Group separator and decimal mark for a language. Turkish for anything unknown. */
const SEPARATORS = (l: AppLang): NumberStyle => NUMBER_STYLE[l] ?? NUMBER_STYLE.tr;

/**
 * A number with its currency's symbol, on the side the READER's language puts
 * it. Before: a multi-letter code needs air ("AED 1.200,00"), a glyph does not
 * ("₺1.310,00"). After: always a no-break space ("49,95 €", "1 200 kr"), so the
 * sign can never wrap onto its own line.
 */
function withSymbol(number: string, code: string, l: AppLang): string {
  const style = CURRENCY_STYLE[code] ?? { symbol: code, symbolBefore: true };
  const before = style.symbolBefore && SEPARATORS(l).cur !== "after";
  if (before) return `${style.symbol}${style.symbol.length > 1 ? " " : ""}${number}`;
  return `${number}${style.symbolBefore ? NBSP : " "}${style.symbol}`;
}

/**
 * Integer minor units → a printed price, in the currency the shop charges.
 *
 * TWO INDEPENDENT AXES, and keeping them apart is the whole design:
 *
 *   - the SYMBOL follows the CURRENCY. £27.99 is pounds whoever is reading, and
 *     converting it would invent a price the shop is not charging.
 *   - the SEPARATORS follow the READER's LANGUAGE. ₺1.310,00 in Turkish,
 *     ₺1,310.00 in English — the rule `tl()` documented, preserved exactly, so
 *     no existing screen changes when it migrates. A Turkish speaker shopping
 *     the UK therefore sees £27,99, which is how they read every other number
 *     in the app.
 *
 * Separators are assembled by hand rather than via `Intl.NumberFormat`'s
 * currency mode: Hermes does not reliably ship the ICU data (see `trUpper`),
 * so a locale-aware path looks right in Node tests and can silently degrade on
 * device. `toLocaleString` for plain grouping is what `tl()` already relied on,
 * but doing it manually makes the output identical on every engine.
 *
 * An unknown currency prints as its own code — a row written by a market whose
 * adapter shipped ahead of this table must never render as "undefined50,00".
 */
/** Currencies printed without decimals (stored ×100 all the same). */
const ZERO_DECIMAL = new Set(["JPY", "KRW"]);

export function formatMoney(
  minor: number,
  currency?: string | null,
  l: AppLang = lang,
): string {
  const code = currency || "TRY";
  const { group, decimal } = SEPARATORS(l);

  const neg = minor < 0;
  const abs = Math.round(Math.abs(minor));
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, group);
  // Yen and won have no minor unit: stored ×100 like every currency, printed
  // whole (¥5.990 / ₩39.000, never ¥5.990,00).
  const number = ZERO_DECIMAL.has(code) ? grouped : `${grouped}${decimal}${cents}`;
  const body = withSymbol(number, code, l);
  return neg ? `-${body}` : body;
}

/**
 * The market the app is currently shopping.
 *
 * A module-level value for exactly the reason `lang` above is one: the active
 * market genuinely is one global thing, and threading it through the 46 price
 * call sites would be noise at every one of them. Set from the root layout
 * during render, before any child renders, beside `setAppLang`.
 *
 * The web never calls the setter and stays Turkish, so there is no shared
 * mutable state across requests there either.
 */
let market: CountryCode = DEFAULT_COUNTRY;

export function setAppCountry(c: CountryCode): void {
  market = c;
}

export const appCountry = (): CountryCode => market;
export const appCurrency = (): string => COUNTRIES[market].currency;

/**
 * A price on screen.
 *
 * `cur` is the row's OWN currency and always wins — pass `deal.currency`
 * wherever a Deal is at hand. A tracked list can legitimately hold rows from two
 * markets (someone who moved, or who switched country to look around), and
 * printing them all in the active currency would be inventing prices. Where
 * there is no row — a target-price input, a savings total, an insight — the
 * active market's currency is the honest answer.
 */
export function money(minor: number, cur?: string | null): string {
  return formatMoney(minor, cur ?? COUNTRIES[market].currency);
}

/**
 * A price with the minor units dropped: "₺1.500", not "₺1.500,00".
 *
 * For chips and sentences, where two decimal places are noise and cost the width
 * a filter chip does not have. This is what the old `fmtTl` produced ("2.000 TL")
 * — with a currency SYMBOL now, rather than a Turkish word appended to every
 * amount in every language.
 */
export function moneyRound(minor: number, cur?: string | null, l: AppLang = lang): string {
  const code = cur || COUNTRIES[market].currency;
  return withSymbol(numberRound(minor, l), code, l);
}

/**
 * A price range with ONE symbol, on the reader's side: "₺500–1.500",
 * "500–1.500 €". Repeating the symbol reads as two prices; putting a trailing
 * one in the middle ("500 €–1.500") reads as a typo.
 */
export function moneyRange(lo: number, hi: number, cur?: string | null, l: AppLang = lang): string {
  const code = cur || COUNTRIES[market].currency;
  return withSymbol(`${numberRound(lo, l)}–${numberRound(hi, l)}`, code, l);
}

/** The grouped whole-unit number alone — the second half of a "₺500–1.500" range. */
export function numberRound(minor: number, l: AppLang = lang): string {
  const { group } = SEPARATORS(l);
  return String(Math.round(minor / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, group);
}

/** Just the symbol, for a price INPUT where the number is the user's to type. */
export function currencySymbol(cur?: string | null): string {
  const code = cur || COUNTRIES[market].currency;
  return (CURRENCY_STYLE[code] ?? { symbol: code }).symbol;
}

/** The price-bucket edges of the active market, in minor units. */
export const priceBuckets = (): readonly [number, number] => COUNTRIES[market].buckets;

/** Locale tag for dates. Follows the LANGUAGE, not the market — a date is words. */
export const dateLocale = (): string => LOCALE_TAG[lang];

/**
 * A percentage, written the way the reader's language writes it.
 *
 * Turkish puts the sign BEFORE the number ("%61"), English after it ("61%").
 * `off` marks a discount with a leading minus: "−%61" / "−61%". The minus is
 * U+2212, not a hyphen — the glyph every discount pill in the app has always
 * used, so Turkish output is byte-for-byte what the screens hardcoded before.
 */
export function percent(n: number, opts: { off?: boolean } = {}, l: AppLang = lang): string {
  // Turkish leads with the sign; French, German and the Nordic languages put a
  // narrow no-break space before it ("61 %"); the rest write "61%".
  const pos = SEPARATORS(l).pct;
  const body = pos === "before" ? `%${n}` : pos === "after-space" ? `${n}${NNBSP}%` : `${n}%`;
  return opts.off ? `−${body}` : body;
}

/** Plain grouped integer: 3037 -> "3.037" / "3,037". Counts, not money. `l` for server copy. */
export const nf = (n: number, l: AppLang = lang): string => {
  // By hand, like formatMoney: Hermes may lack the ICU data for fr/es/zh, and
  // `toLocaleString` would then quietly print the wrong separators on device.
  if (!Number.isInteger(n)) return n.toLocaleString(LOCALE_TAG[l] ?? LOCALE_TAG.tr);
  const { group } = SEPARATORS(l);
  const body = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return n < 0 ? `-${body}` : body;
};

export const BRAND_LABELS: Record<string, string> = {
  zara: "Zara",
  guess: "Guess",
  penti: "Penti",
  sephora: "Sephora",
  hm: "H&M",
  gratis: "Gratis",
  mango: "Mango",
  watsons: "Watsons",
  pandora: "Pandora",
  massimodutti: "Massimo Dutti",
  pullandbear: "Pull&Bear",
  bershka: "Bershka",
  stradivarius: "Stradivarius",
  oysho: "Oysho",
  koton: "Koton",
  rossmann: "Rossmann",
  boyner: "Boyner",
  beymen: "Beymen",
  lefties: "Lefties",
  vakko: "Vakko",
  vakkorama: "Vakkorama",
  nike: "Nike",
  newbalance: "New Balance",
  puma: "Puma",
  superstep: "SuperStep",
  modanisa: "Modanisa",
  network: "Network",
  ipekyol: "İpekyol",
  twist: "Twist",
  lacoste: "Lacoste",
  pierrecardin: "Pierre Cardin",
  derimod: "Derimod",
  asics: "ASICS",
  benefit: "Benefit",
  kohls: "Kohl's",
  patagonia: "Patagonia",
  ralphlauren: "Ralph Lauren",
  kendrascott: "Kendra Scott",
  toryburch: "Tory Burch",
  dsw: "DSW",
  anntaylor: "Ann Taylor",
  lanebryant: "Lane Bryant",
  pacsun: "PacSun",
  birkenstock: "Birkenstock",
  torrid: "Torrid",
  express: "Express",
  marcjacobs: "Marc Jacobs",
  cos: "COS",
  joefresh: "Joe Fresh",
  sportchek: "Sport Chek",
  marks: "Mark's",
  sportinglife: "Sporting Life",
  ssense: "SSENSE",
  casio: "Casio",
  atasay: "Atasay",
  zenpirlanta: "Zen Pırlanta",
  saatvesaat: "Saat&Saat",
  altinbas: "Altınbaş",
  machka: "Machka",
  adl: "ADL",
  wcollection: "W Collection",
  jimmykey: "Jimmy Key",
  loft: "LOFT",
  dilvin: "Dilvin",
  quzu: "QUZU",
  nisantasishoes: "Nişantaşı Shoes",
  lesbenjamins: "Les Benjamins",
  underarmour: "Under Armour",
  timberland: "Timberland",
  marksandspencer: "Marks & Spencer",
  victoriassecret: "Victoria's Secret",
  lcw: "LC Waikiki",
  defacto: "DeFacto",
  mavi: "Mavi",
  colins: "Colin's",
  mudo: "Mudo",
  rarebeauty: "Rare Beauty",
  aloyoga: "Alo Yoga",
  princesspolly: "Princess Polly",
  stevemadden: "Steve Madden",
  macys: "Macy's",
  zappos: "Zappos",
  altitudesports: "Altitude Sports",
  jcrew: "J.Crew",
  madewell: "Madewell",
  crocs: "Crocs",
  levis: "Levi's",
  calvinklein: "Calvin Klein",
  tommyhilfiger: "Tommy Hilfiger",
  michaelkors: "Michael Kors",
  columbia: "Columbia",
  coachoutlet: "Coach Outlet",
  katespadeoutlet: "Kate Spade Outlet",
  nordstromrack: "Nordstrom Rack",
  adidas: "adidas",
  swarovski: "Swarovski",
  urbanoutfitters: "Urban Outfitters",
  freepeople: "Free People",
  anthropologie: "Anthropologie",
  ugg: "UGG",
  vans: "Vans",
  gapfactory: "Gap Factory",
  brfactory: "Banana Republic Factory",
  gymshark: "Gymshark",
  whitefox: "White Fox",
  dolcevita: "Dolce Vita",
  psychobunny: "Psycho Bunny",
  herschel: "Herschel",
  forever21: "Forever 21",
  vincecamuto: "Vince Camuto",
  windsor: "Windsor",
  kyliecosmetics: "Kylie Cosmetics",
  brownsshoes: "Browns Shoes",
  glossier: "Glossier",
  ardene: "Ardene",
  lasenza: "La Senza",
  knix: "Knix",
  reitmans: "Reitmans",
  suzyshier: "Suzy Shier",
  laura: "Laura",
  ohpolly: "Oh Polly",
  kookai: "KOOKAÏ",
  dissh: "DISSH",
  mimco: "MIMCO",
  peppermayo: "Peppermayo",
  beginningboutique: "Beginning Boutique",
  decjuba: "Decjuba",
  universalstore: "Universal Store",
  seafolly: "Seafolly",
  "pe-nation": "P.E Nation",
  forevernew: "Forever New",
  countryroad: "Country Road",
  lornajane: "Lorna Jane",
  dagi: "Dagi",
  gap: "GAP",
  uspoloassn: "U.S. Polo Assn.",
  cacharel: "Cacharel",
  converse: "Converse",
  gant: "GANT",
  maccosmetics: "M·A·C",
  bobbibrown: "Bobbi Brown",
  flormar: "Flormar",
  fashfed: "FashFed",
  sportive: "Sportive",
  oldnavy: "Old Navy",
  bananarepublic: "Banana Republic",
  athleta: "Athleta",
  abercrombie: "Abercrombie & Fitch",
  hollister: "Hollister",
  ulta: "Ulta Beauty",
  skims: "SKIMS",
  fashionnova: "Fashion Nova",
  aldo: "ALDO",
  on: "On",
  roots: "Roots",
  lavieenrose: "La Vie en Rose",
  aritzia: "Aritzia",
  lululemon: "lululemon",
  boots: "Boots",
  uniqlo: "UNIQLO",
  faces: "FACES",
  garage: "Garage",
  dynamite: "Dynamite",
  theiconic: "THE ICONIC",
  glassons: "Glassons",
  hellomolly: "Hello Molly",
  meshki: "MESHKI",
  adorebeauty: "Adore Beauty",
  zalando: "Zalando",
  douglas: "Douglas",
  cubus: "Cubus",
  bikbok: "Bik Bok",
  lindex: "Lindex",
  nelly: "Nelly",
  lyko: "Lyko",
  aivi: "AIVI",
  styli: "Styli",
  centrepoint: "Centrepoint",
  maxfashion: "Max",
  splash: "Splash",
  ounass: "Ounass",
  flo: "FLO",
  instreet: "In Street",
  lumberjack: "Lumberjack",
  kinetix: "Kinetix",
  reebok: "Reebok",
  kiko: "KIKO Milano",
  skechers: "Skechers",
  sneaksup: "Sneaks Up",
  arket: "ARKET",
  stories: "& Other Stories",
  weekday: "Weekday",
  topshop: "Topshop",
  newlook: "New Look",
  asos: "ASOS",
  next: "Next",
  reiss: "Reiss",
  riverisland: "River Island",
  jdsports: "JD Sports",
  cottonon: "Cotton On",
  showpo: "Showpo",
  sportsgirl: "Sportsgirl",
  "jd-sports": "JD Sports",
  dosenbach: "Dosenbach",
  ochsnershoes: "Ochsner Shoes",
  ochsnersport: "Ochsner Sport",
  snipes: "SNIPES",
  chicoree: "Chicorée",
  "c-and-a": "C&A",
  manor: "Manor",
  aboutyou: "About You",
  impo: "Impo",
  only: "ONLY",
  veromoda: "VERO MODA",
  kappahl: "KappAhl",
  vita: "Vita",
  xxl: "XXL",
  blivakker: "Blivakker",
  ginatricot: "Gina Tricot",
  "na-kd": "NA-KD",
  ellos: "Ellos",
  fredrikoglouisa: "Fredrik & Louisa",
  gullfunn: "Gullfunn",
  bathandbodyworks: "Bath & Body Works",
  americaneagle: "American Eagle",
  goldenscent: "Golden Scent",
  vperfumes: "VPerfumes",
  bloomingdales: "Bloomingdale's",
  damas: "Damas",
  ajmal: "Ajmal",
  nahdi: "Nahdi",
  calzedonia: "Calzedonia",
  intimissimi: "Intimissimi",
  falconeri: "Falconeri",
  desa: "Desa",
  elifstil: "Elifstil",
  noteshop: "Note Cosmetics",
  pumpsup: "Pumps Up",
  pelininayakkabilari: "Pelinin Ayakkabıları",
  lutvelizade: "Lutvelizade",
  coral: "Coral",
  yargici: "Yargıcı",
  hotic: "Hotiç",
  suwen: "Suwen",
  haydigiy: "HaydiGiy",
  boohoo: "boohoo",
  prettylittlething: "PrettyLittleThing",
  whistles: "Whistles",
  hobbs: "Hobbs",
};

export const brandLabel = (b: string) => BRAND_LABELS[b] ?? b;

/**
 * The brand line on a card: the real brand when a multi-brand store sells it
 * (owner 2026-10-26: "write Gucci, not Beymen or Boyner"), else the store. The
 * store still names itself on the product page's "open on …" button.
 */
export function dealBrandLabel(d: { brand: string; maker?: string | null }): string {
  return d.maker?.trim() || brandLabel(d.brand);
}

/**
 * Short label for the tight brand rail (56px), where long names like
 * "Massimo Dutti" get mid-word ellipsis-cut and read badly. Falls back to
 * the full label everywhere it isn't overridden.
 */
const BRAND_SHORT: Record<string, string> = {
  massimodutti: "M. Dutti",
  stradivarius: "Stradi",
  pullandbear: "Pull&Bear",
};

export const brandShort = (b: string) => BRAND_SHORT[b] ?? brandLabel(b);

/**
 * Uppercase for Turkish, where dotted and dotless i are separate letters:
 * i→İ and ı→I. Plain `toUpperCase()` renders "bana ait" as "BANA AIT" and
 * "eşik" as "EŞIK", which reads as a typo to every Turkish speaker — and CSS
 * `textTransform: "uppercase"` has the same flaw, so every small-caps label in
 * the app was wrong.
 *
 * The two letters are remapped BEFORE `toUpperCase()` rather than delegating to
 * `toLocaleUpperCase("tr-TR")`, because Hermes does not reliably ship the ICU
 * data that locale-aware casing needs — it would silently fall back to the
 * broken mapping on device while looking correct in Node tests. Every other
 * Turkish letter (ç ğ ö ş ü) uppercases correctly without help.
 */
export function trUpper(s: string): string {
  // Only in Turkish. Applied to any other language it produces "NOTİFİCATİONS", which is
  // the same class of typo in the other direction — the dotted capital is a
  // Turkish letter, not a decoration.
  if (lang !== "tr") return s.toUpperCase();
  return s.replace(/i/g, "İ").replace(/ı/g, "I").toUpperCase();
}

/**
 * Retailer product names usually end in the vendor's own article code —
 * "… Örgü Sweatshirt M4WL-SWT-1927", "… Kadın Sweatshirt 75PAIG05". It means
 * nothing to a shopper and it is what makes a product title spill onto a third
 * line, so drop it for display. The raw name is still what we match and search
 * on; this is presentation only.
 *
 * Deliberately conservative: the trailing token must be all-caps/digits/dashes,
 * at least five characters, and contain a digit — so "Sweatshirt", "XL" and
 * "Pull&Bear" survive, and anything ambiguous is left alone.
 */
export function productTitle(name: string): string {
  const trimmed = name.trim();
  const stripped = trimmed.replace(/\s+[A-Z0-9][A-Z0-9./-]{4,}$/, (m) =>
    /\d/.test(m) ? "" : m,
  );
  // Never hand back an empty or near-empty title.
  return stripped.trim().length >= 3 ? stripped.trim() : trimmed;
}
