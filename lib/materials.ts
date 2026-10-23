/**
 * Materials — what a garment is MADE of, as a search filter (owner 2026-10-23:
 * "Red knitwear" answered with sweatshirts, sweat shorts and a bodysuit; "the
 * search doesn't detect the material").
 *
 * Two sources, because neither covers everything:
 *   - the outfit tagger's `product_tags.tags->>'material_family'` (and the finer
 *     `material`, "wool blend", "synthetic leather"), which looked at the photo
 *     and the name — ~454k rows, mostly Turkey, more markets on the way;
 *   - the product NAME, for every row the tagger has not reached ("Deri Ceket",
 *     "Linen blend trousers"), in the languages the storefronts write.
 * A row matches when either says so, unless something vetoes it: the tagger
 * calling it faux leather, or a knit request meeting a sweatshirt.
 *
 * `words` is the other direction — the shopper's request, in any of the app's
 * 17 languages, on `fold`ed text. Platform-free (no server imports): the app
 * could read it, the API and the battery do.
 */
import type { AppLang } from "./lang";
import { fold } from "./productTypes";
import { libLabel } from "./i18n/labels";

export interface Material {
  key: string;
  /** The name word that puts an explicit "Keten …" first (ranking only): [Turkey's, other markets' English]. */
  rank: [string, string];
  /** Request words (JS regex sources on folded text; see `materialsIn`). */
  words: string[];
  /** Tagger families that ARE this material. */
  families: string[];
  /** Product-name pattern (Postgres ARE on the SQL-folded name) for rows the tags do not decide. */
  name: string;
  /** A name the `name` pattern caught that is NOT this material ("suni deri"). Blocks only the name path. */
  notName?: string;
  /** Never this material, whatever the tags or name say ("Triko Sweatshirt" is not knitwear). */
  exclude?: string;
  /**
   * Tagger verdicts that rule a row out: these families, or — among this
   * material's own family rows — `material`/`subtype` text matching
   * `vetoFine`/`vetoSub` ("synthetic leather" filed as leather, a knit hoodie).
   */
  vetoFamilies?: string[];
  vetoFine?: string;
  vetoSub?: string;
  /** Our own subtypes that are this material by definition (a kazak is knitted). */
  subtypes?: string[];
  /** Our own subtypes that never are (the sweatshirt shelf is not knitwear). */
  notSubtypes?: string[];
  /** On this product type, these tagger families count too (a wool kazak is knitwear; a wool coat is not). */
  shelf?: { type: string; families: string[] };
}

// Faux materials FIRST: `materialsIn` takes the earliest-listed match and cuts
// it out, so "suni deri" is never also read as "deri".
// prettier-ignore
const FAUX_LEATHER_NAME =
  "suni deri|deri gorunumlu|yapay deri|faux[- ]leather|vegan[- ]leather|imitation leather|leather[- ](look|effect)|\\ypu\\y|polyurethane|kunstleder|lederimitat|lederoptik|simili|cuir (synthetique|vegan)|ecopelle|similpelle|eco[- ]pelle|ecopiel|polipiel|piel sintetica|cuero sintetico|pele sintetica|kunstleer|imitatieleer|konstlader|konstläder|kunstlæder|kunstskinn|tekonahka|keinonahka";

// prettier-ignore
export const MATERIALS: Material[] = [
  {
    key: "faux-leather",
    rank: ["suni", "faux"],
    words: ["suni deri", "deri gorunumlu", "yapay deri", "faux leather", "vegan leather", "pu leather", "imitation leather", "simili ?cuir", "cuir vegan", "kunstleder", "ecopelle", "similpelle", "ecopiel", "polipiel", "piel sintetica", "cuero sintetico", "pele sintetica", "couro sintetico", "kunstleer", "imitatieleer", "konstläder", "konstlader", "kunstlæder", "kunstskinn", "tekonahka", "keinonahka", "جلد صناعي", "人造皮", "仿皮", "人造革", "pu皮", "フェイクレザー", "合皮", "合成皮革", "인조가죽", "인조 가죽", "페이크 ?레더"],
    families: ["faux-leather"],
    name: FAUX_LEATHER_NAME,
  },
  {
    key: "corduroy",
    rank: ["fitilli", "corduroy"],
    words: ["fitilli kadife", "kadife fitilli", "corduroy", "velours cotele", "velours côtelé", "cordsamt", "cord", "pana", "velluto a coste", "veludo cotele", "bombazina", "ribfluweel", "manchesterbyxor", "fløjl", "vakosametti", "كوردروي", "灯芯绒", "燈芯絨", "コーデュロイ", "코듀로이"],
    families: ["corduroy"],
    name: "fitilli kadife|kadife fitilli|corduroy|\\ycord\\y|cordhose|cordjacke|cordrock|velours c[oô]tel[eé]|\\ypana\\y|velluto a coste|bombazina|veludo cotel[eê]|ribfluweel|manchesterbyx|vakosametti",
  },
  {
    key: "knit",
    rank: ["triko", "knit"],
    words: ["triko\\w*", "orgu\\w*", "knit\\w*", "tricot\\w*", "maille", "strick\\w*", "de punto", "punto", "malha", "tricotado", "maglia", "maglieria", "gebreid\\w*", "breigoed", "stickad\\w*", "stickat", "strik", "strikket", "strikk\\w*", "neule\\w*", "neulottu", "محبوك", "تريكو", "针织\\S*", "針織\\S*", "ニット", "니트"],
    families: ["knit"],
    name: "\\y(triko|orgu|knit|knitted|knitwear|tricot|maille|strick|punto|malha|maglia|maglieria|gebreid|breigoed|stickad|stickat|strikket|strikk|neule|crochet|tig isi)",
    exclude: "sweat|hoodie|kapuson|esofman|jogger|\\ypolar|fleece|\\ytayt|legging",
    vetoFamilies: ["fleece", "jersey"],
    vetoSub: "sweat|hoodie|jogger|track",
    subtypes: ["kazak", "hirka"],
    notSubtypes: ["sweatshirt"],
    shelf: { type: "triko", families: ["wool", "cashmere"] },
  },
  {
    key: "cashmere",
    rank: ["kaşmir", "cashmere"],
    words: ["kasmir\\w*", "cashmere", "cachemire", "kaschmir", "cachemira", "caxemira", "kasjmier", "kashmir", "كشمير", "羊绒", "羊絨", "开司米", "カシミ[ヤア]", "캐시미어"],
    families: ["cashmere"],
    name: "kasmir|cashmere|cachemire|kaschmir|cachemira|caxemira|kasjmier|kashmir",
  },
  {
    key: "wool",
    rank: ["yün", "wool"],
    words: ["yun", "yunlu", "yunden", "kase", "wool\\w*", "merino", "laine", "wolle", "woll\\w*", "lana", "lã", "wol", "wollen", "ull", "ullen", "uld", "villa\\w*", "alpaca", "alpaka", "mohair", "tiftik", "صوف", "羊毛", "ウール", "울", "양모", "울소재"],
    families: ["wool", "cashmere"],
    name: "\\y(yun(lu|den)?\\y|kase\\y|wool|merino|laine|wolle|woll|schurwoll|lana\\y|lã\\y|wol\\y|wollen|ull(\\y|blandning|troja|rock|kappa|kåpe|genser)|uld(\\y|frakke|bland)|villa|alpa[ck]a|mohair|tiftik)",
    notName: "lana del|\\yvillage|yun gorunum|wool[- ](look|effect)",
  },
  {
    key: "leather",
    rank: ["deri", "leather"],
    words: ["deri", "derisi", "deriden", "leather", "cuir", "leder\\w*", "pelle", "piel", "cuero", "couro", "pele", "nahka\\w*", "lader", "läder", "læder", "lær", "skinn", "جلد", "جلد طبيعي", "皮革", "真皮", "皮衣", "皮夹克", "皮夾克", "本革", "革製", "革靴", "レザー", "가죽", "레더"],
    families: ["leather"],
    name: "\\y(deri(si|den|li)?\\y|leather|cuir\\y|leder|pelle\\y|piel\\y|cuero|couro|nahka|läder|lader|læder|lær\\y|skinn(?!y))",
    notName: FAUX_LEATHER_NAME + "|\\yfaux\\y|\\yvegan\\y|imitation|\\ysynthetic|derin|cilt",
    vetoFamilies: ["faux-leather"],
    vetoFine: "synthetic|faux|vegan|imitation|\\ypu\\y",
  },
  {
    key: "suede",
    rank: ["süet", "suede"],
    words: ["suet\\w*", "suede", "daim", "wildleder", "ante", "camoscio", "camurca", "camurça", "suède", "ruskind", "semsket", "mokkanahka", "nubuk", "nubuck", "شامواه", "سويد", "麂皮", "绒面革", "スエード", "스웨이드"],
    families: ["suede", "faux-suede"],
    name: "\\y(suet|suede|suède|daim|wildleder|ante\\y|camoscio|camurça|camurca|ruskind|semsket|mokkanahka|nubuk|nubuck)",
  },
  {
    key: "linen",
    rank: ["keten", "linen"],
    words: ["keten\\w*", "linen", "lin", "leinen", "lino", "linho", "linnen", "pellava\\w*", "hør", "كتان", "亚麻", "亞麻", "棉麻", "リネン", "린넨", "리넨"],
    families: ["linen"],
    name: "\\y(keten|linen|lin\\y|leinen|lino\\y|linho|linnen|pellava|hør\\y)",
    notName: "keten gorunum|linen[- ](look|effect)|leinenoptik|(aspect|effet) lin\\y",
  },
  {
    key: "silk",
    rank: ["ipek", "silk"],
    words: ["ipek", "ipekli", "silk", "soie", "seide", "seta", "seda", "zijde", "zijden", "siden", "silke", "silkki\\w*", "حرير", "丝绸", "絲綢", "真丝", "真絲", "シルク", "실크"],
    families: ["silk"],
    name: "\\y(ipek(?!si)|silk(?!y)|soie\\y|seide\\y|seta\\y|seda\\y|zijde|siden\\y|silke\\y|silkki)",
    notName: "silk(y|[- ]?(touch|effect|look|finish))|seidig|soyeux",
  },
  {
    key: "satin",
    rank: ["saten", "satin"],
    words: ["saten\\w*", "satin\\w*", "satén", "raso", "cetim", "satijn", "satiini", "ساتان", "缎面", "緞面", "缎", "緞", "サテン", "새틴"],
    families: ["satin"],
    name: "\\y(saten|satin|satén|raso\\y|cetim|satijn|satiini)",
  },
  {
    key: "velvet",
    rank: ["kadife", "velvet"],
    words: ["kadife\\w*", "velvet", "velours", "velour", "samt", "terciopelo", "velluto", "veludo", "fluweel", "sammet", "fløjl", "floyel", "fløyel", "sametti", "مخمل", "丝绒", "絲絨", "天鹅绒", "天鵝絨", "ベルベット", "ベロア", "벨벳"],
    families: ["velvet"],
    name: "\\y(kadife|velvet|velours?\\y|terciopelo|velluto\\y|veludo\\y|fluweel|sammet|fløyel|sametti)",
    notName: "fitilli|corduroy|c[oô]tel[eé]|a coste|ribfluweel|vakosametti",
  },
  {
    key: "denim",
    rank: ["denim", "denim"],
    words: ["denim", "kot", "دنيم", "牛仔", "デニム", "데님"],
    families: ["denim"],
    subtypes: ["jean"],
    name: "\\y(denim|jeans?\\y|kot\\y|vaquer|spijker|farkku|farkut|cowboybukser)",
  },
  {
    key: "cotton",
    rank: ["pamuk", "cotton"],
    words: ["pamuk\\w*", "cotton", "coton", "baumwoll\\w*", "algodon", "algodón", "cotone", "algodao", "algodão", "katoen", "katoenen", "bomull", "bomuld", "puuvilla\\w*", "قطن", "纯棉", "純棉", "全棉", "棉质", "棉質", "コットン", "綿", "코튼", "면"],
    families: ["cotton"],
    name: "\\y(pamuk|cotton|coton\\y|baumwoll|algod[oó]n|cotone\\y|algod[aã]o|katoen|bomull|bomuld|puuvilla)",
  },
  {
    key: "fleece",
    rank: ["polar", "fleece"],
    words: ["polar", "fleece", "polaire", "forro polar", "فليس", "抓绒", "摇粒绒", "搖粒絨", "フリース", "플리스"],
    families: ["fleece"],
    name: "\\y(polar\\y|fleece|polaire|forro polar)",
  },
  {
    key: "sequin",
    rank: ["payet", "sequin"],
    words: ["payet\\w*", "sequin\\w*", "paillette\\w*", "pailletten", "lentejuela\\w*", "lantejoula\\w*", "paljett\\w*", "pailletter", "ترتر", "亮片", "スパンコール", "스팽글", "시퀸"],
    families: ["sequin"],
    name: "\\y(payet|sequin|paillette|pailletten|lentejuela|lantejoula|paljett|pailletter)",
  },
  {
    key: "lace",
    rank: ["dantel", "lace"],
    words: ["dantel\\w*", "lace(?![- ]?up)", "dentelle", "spitze", "encaje", "pizzo", "renda", "kant", "spets", "pitsi\\w*", "دانتيل", "蕾丝", "蕾絲", "レース", "레이스"],
    families: ["lace"],
    name: "\\y(dantel|lace\\y|dentelle|spitze|encaje|pizzo|renda\\y|kant\\y|spets|pitsi)",
    notName: "lace[- ]?up|laced|shoelace|\\ylaces\\y|lacing",
  },
  {
    key: "chiffon",
    rank: ["şifon", "chiffon"],
    words: ["sifon\\w*", "chiffon", "mousseline", "gasa", "شيفون", "雪纺", "雪紡", "シフォン", "시폰"],
    families: ["chiffon"],
    name: "\\y(sifon|chiffon|mousseline|gasa\\y)",
  },
  {
    key: "tweed",
    rank: ["tüvit", "tweed"],
    words: ["tweed", "tuvit", "tvid", "boucle", "bouclé", "تويد", "粗花呢", "ツイード", "트위드"],
    families: ["tweed"],
    name: "\\y(tweed|tuvit|tvid|boucl[eé])",
  },
  {
    key: "mesh",
    rank: ["file", "mesh"],
    words: ["file", "mesh", "tul", "tulle", "resille", "résille", "netz\\w*", "rete", "rede", "tule", "tyll", "verkko\\w*", "شبك", "网纱", "網紗", "网眼", "網眼", "メッシュ", "チュール", "메쉬", "메시"],
    families: ["mesh", "tulle"],
    name: "\\y(file\\y|mesh|tul\\y|tulle|r[eé]sille|netz|rete\\y|tyll)",
  },
];

export const MATERIAL_KEYS = new Set(MATERIALS.map((m) => m.key));
export const materialSpec = (key: string): Material | undefined => MATERIALS.find((m) => m.key === key);

/** Han, kana and hangul are written without spaces (or with particles glued on): no word edges. */
const NO_EDGES = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Arabic}]/u;
const compiled = MATERIALS.map((m) => ({
  key: m.key,
  re: new RegExp(
    m.words.map((w) => (NO_EDGES.test(w) ? `(?:${w})` : `(?<![\\p{L}\\p{N}])(?:${w})(?![\\p{L}\\p{N}])`)).join("|"),
    "gu",
  ),
}));

/**
 * The materials a request names, and the request with those words cut out —
 * what is left is read as usual ("kırmızı triko" → knit + "kırmızı"). Faux
 * leather is cut before leather and corduroy before velvet (table order), so a
 * phrase is read once, as its own material.
 */
export function materialsIn(text: string): { keys: string[]; rest: string } {
  let rest = fold(text ?? "").normalize("NFC");
  const keys: string[] = [];
  for (const { key, re } of compiled) {
    re.lastIndex = 0;
    if (!re.test(rest)) continue;
    re.lastIndex = 0;
    rest = rest.replace(re, " ");
    if (!keys.includes(key)) keys.push(key);
  }
  return { keys, rest: rest.replace(/\s+/g, " ").trim() };
}

/** The material's name in the reader's language (chips). */
export const materialLabel = (key: string, lang: AppLang = "tr"): string =>
  libLabel(lang, (d) => (d.materials as Record<string, string> | undefined)?.[key]) ?? key;

/**
 * The materials as one SQL condition (any-of) on `table`'s rows — the search
 * (lib/db.ts) and the Stilist alarm check (packages/collector) share it.
 * `push` adds a parameter and returns its placeholder.
 *
 * Each material is read from the outfit tagger's verdict OR the product name —
 * the tagger has reached most of Turkey and little of the rest, and a name that
 * says "Deri Ceket" needs no photo. A tagger verdict against it (faux leather,
 * a fleece, a hoodie) rules the row out either way.
 *
 * The tagger is asked by FAMILY (idx_product_tags_material_family); its finer
 * `material` text is read only inside the family's own rows, to veto. Matching
 * that text everywhere ("\\yleather" in `material`) added 18k rows, 14k of them
 * "faux leather" — measured 2026-10-23.
 *
 * `narrow`: a shelf, brand or maker already leaves a few thousand rows, and a
 * lookup per row by product_tags' key is cheapest (0.3–0.9 s on the Turkish
 * catalogue). With nothing else narrowing ("deri" alone: every Turkish row) the
 * family's ids are hashed once instead — left to itself the planner picked the
 * per-row form there and took 13–21 s; hashed, 4–7 s.
 */
export function materialSql(
  keys: string[],
  push: (v: unknown) => string,
  o: { table: string; narrow: boolean },
): string {
  const t = o.table;
  const tagged = (cond: string) => o.narrow
    ? `EXISTS (SELECT 1 FROM product_tags WHERE product_tags.product_id = ${t}.id AND (${cond}))`
    : `${t}.id IN (SELECT product_id FROM product_tags WHERE ${cond})`;
  const fam = (list: string[]) => `tags->>'material_family' = ANY(${push(list)}::text[])`;
  // lib/db.ts SQL_FOLD: lowercase + Turkish letters to ASCII.
  const name = `lower(translate(${t}.name, 'ÇĞİÖŞÜIÂÎÛçğıöşüâîû', 'cgiosuiaiucgiosuaiu'))`;
  const any = keys.map(materialSpec).filter((m): m is Material => !!m).map((m) => {
    const hit = [tagged(fam(m.families))];
    if (m.shelf) hit.push(`(${t}.product_type = ${push(m.shelf.type)} AND ${tagged(fam(m.shelf.families))})`);
    hit.push(`(${name} ~ ${push(m.name)}${m.notName ? ` AND NOT ${name} ~ ${push(m.notName)}` : ""})`);
    if (m.subtypes) hit.push(`${t}.product_subtype = ANY(${push(m.subtypes)}::text[])`);
    const within = [
      m.vetoFine ? `(tags->>'material') ~* ${push(m.vetoFine)}` : "",
      m.vetoSub ? `(tags->>'subtype') ~* ${push(m.vetoSub)}` : "",
    ].filter(Boolean);
    const veto = [
      m.vetoFamilies ? fam(m.vetoFamilies) : "",
      within.length ? `(${fam(m.families)} AND (${within.join(" OR ")}))` : "",
    ].filter(Boolean);
    const not = [
      m.exclude ? `NOT ${name} ~ ${push(m.exclude)}` : "",
      m.notSubtypes ? `(${t}.product_subtype IS NULL OR ${t}.product_subtype <> ALL(${push(m.notSubtypes)}::text[]))` : "",
      veto.length ? `NOT ${tagged(veto.join(" OR "))}` : "",
    ].filter(Boolean);
    return `((${hit.join(" OR ")})${not.map((x) => ` AND ${x}`).join("")})`;
  });
  return any.length ? `(${any.join(" OR ")})` : "";
}
