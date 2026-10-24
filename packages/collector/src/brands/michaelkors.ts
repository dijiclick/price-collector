/**
 * Michael Kors — the Sale section of the full-price stores: US
 * (michaelkors.com), Canada (michaelkors.com/ca/en), UK (michaelkors.co.uk),
 * Switzerland (michaelkors.eu/ch/en) and Australia (michaelkors.global/au/en).
 *
 * Every MK store is Salesforce Commerce Cloud (SFRA) behind Akamai Bot Manager.
 * There is no third-party search provider and no US/EU shopping app to borrow.
 * What Akamai refuses is the REQUEST SHAPE, not the egress: a Chrome
 * User-Agent over HTTP/1.1 (Node's fetch) is "Access Denied", while the same
 * GET with a Safari User-Agent — which carries no `sec-ch-ua` client hints to
 * cross-check — is served. Verified from a GitHub runner, no proxy (probe runs
 * 38227796358, 38228253494, 38230163261, 38230306214 on 2026-10-12): 200 with
 * the full grid HTML for the US, CA, CH, AU and UK sale grids and the
 * Product-Variation JSON. The UK store is fetched through michaelkors.eu: the
 * same SFCC site (`mk_uk`, GBP) answers there, while the michaelkors.co.uk edge
 * puts runner IPs through an Akamai crypto challenge (429 `cpr_chlge`, three
 * runs in a row). Product links still point at michaelkors.co.uk. The edges
 * challenge a runner intermittently, host by host (2026-10-12 14:05: GB 429 on
 * michaelkors.eu at start=400, AU 429 on michaelkors.global at start=0, CH fine
 * on .eu in the same sweep). mk_uk, mk_ch and mk_anz answer on all three of
 * .eu/.global/.co.uk, so a refused call is retried on the sibling hosts
 * (`mirrors`) before the market fails. Since ~2026-10-14 .global and .co.uk
 * sit behind Cloudflare and serve runners, while .eu (still Akamai) answers 403
 * to every runner (GB/CH failed 13 runs in a row; probe 38865222204 on
 * 2026-10-16: .eu 403, .global/.co.uk 200 for mk_uk, mk_ch and mk_anz), so all
 * three read through .global first and .eu is the last resort. Headers must
 * be sent once each: a second `user-agent` key under different casing is
 * merged by fetch into "Chrome, Safari", which is refused.
 *
 * Feed: the storefront's own infinite-scroll endpoint, `Search-UpdateGrid`
 * (`cgid=sale`, `priceStatus=md` = marked down), which returns the tiles as
 * HTML. One tile is one style shown in one colour, with its struck-through
 * "Was" price and its "Now" price as machine-readable `content="…"` values.
 *
 * - Outlet: the US and Canadian grids also return made-for-outlet styles,
 *   labelled "Michael Kors Outlet" on the tile (US 1,238 of 1,875 on
 *   2026-10-12). Their "Was" is the outlet's reference price, not a price the
 *   full-price store charged, so they are dropped. The UK/CH/AU grids carry no
 *   outlet styles.
 * - Colour price ranges ("Now $55.99 – $159.20"): the colours of the style sell
 *   at different prices, so the tile has no single price. Those styles are
 *   resolved by one `Product-Variation` call for the tile's colour (exact
 *   price, colour stock, per-size stock), within a per-market budget; beyond it
 *   they are skipped rather than guessed.
 * - Stock: the grid only lists orderable styles, so a grid row is in stock.
 *   Per-size stock exists only for the range styles resolved above.
 * - Gender: a second pass over the same grid refined to `gender=male` marks the
 *   men's styles; everything else in an MK sale is women's.
 *
 * Time (2026-10-21): every MK host is answered by Akamai or Cloudflare depending
 * on the runner — one probe minute .eu/.es/.co.uk were Cloudflare 200 and
 * .global Akamai 429, the next .eu and .es were Akamai 403 (probes 39674470505,
 * 39675707028). Starting each of ~50 calls on a refusing host and backing off
 * pushed NL/BE/AT/IE/ES past the 300 s brand limit while GB/CH crawled in
 * 210-240 s. So the host that last answered a market is tried first (`lastGood`),
 * each call has its own timeout, and the optional colour-range calls stop at a
 * time budget; the sale grid and the (one- or two-page) men's pass always
 * finish, so a slow run never returns a partial grid.
 *
 * 2026-10-24: GB/CH/FR/AU fail roughly one run in two with 403/429, at start=0
 * or mid-walk (start=200..800). It is not a rate limit this adapter can pace
 * its way out of: the grid walk is only 5-6 requests before it fails, and once
 * a runner is refused it stays refused for minutes (AU and IT logged 15 refused
 * Product-Variation calls in a row over 2.5 min, every host). The "mirrors" do
 * not escape it either: .eu, .global, .co.uk, .fr, .de and .it all CNAME to
 * one Akamai property (prod.michaelkors.eu.edgekey.net); the `cf-ray` a probe
 * sees on a 200 comes from the origin behind Akamai, not a second edge. So a
 * refusal is Akamai's verdict on that runner's IP, and the matrix gives each
 * market its own runner — the next run usually passes. What this adapter can
 * do is never turn a refusal into bad data:
 * - A mid-walk refusal still fails the market. Returning the pages read so far
 *   would pass the collector's 50% guard (FR failed at start=800, i.e. 80%), so
 *   the sweep would mark the unread fifth sold out and the next run would fire
 *   back_in_stock pushes for all of it.
 * - A page after a full one that comes back 200 with no tiles is fetched once
 *   more, and fails the market unless it is a grid fragment (`isGridFragment`).
 *   IT returned 379 products on 2026-10-23 21:55 (899 the run before, and
 *   5 colour-range styles instead of ~45): two full pages, then a 200 with no
 *   tiles ended the walk as if the grid were done. The 50% guard caught that
 *   one; a stop at page four would have passed it.
 * - Colour-range calls stop after VARIATION_REFUSALS refusals in a row instead
 *   of spending the rest of the budget (and ~60 more refused requests) on them.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

interface Market {
  /** Storefront origin, for product links. */
  host: string;
  /** Origin the feed is fetched from (an SFCC site answers on every MK host). */
  api: string;
  /** SFCC site id + locale: `/on/demandware.store/Sites-<site>-Site/<locale>/`. */
  site: string;
  locale: string;
  /** Other hosts that serve the same SFCC site, tried in turn when `api` refuses a call. */
  mirrors?: string[];
  /** "Michael Kors Outlet" styles appear in this market's sale grid. */
  outletMixed: boolean;
}

/** In order of preference: .eu last, it 403s runners since 2026-10-14. */
const EU_EDGES = ["https://www.michaelkors.global", "https://www.michaelkors.co.uk", "https://www.michaelkors.eu"];
const others = (api: string) => EU_EDGES.filter((h) => h !== api);

/**
 * The euro stores (2026-10-21): one SFCC site per country (mk_de, mk_fr, mk_it,
 * mk_es, mk_nl, mk_be, mk_at, mk_ie) on the same Akamai realm as CH/UK. DE/FR/
 * IT/ES have their own domains; NL/BE/AT/IE live on michaelkors.eu. Every
 * edge refuses a call now and then (michaelkors.it and .global 403'd mk_it while
 * .eu served it, same minute), so each market tries its own domain, then the
 * other EU edges. Only the local locale is served (`en_DE` falls back to
 * German), so names are in the market's language and the product type comes
 * from `categoryEu` (a word list per language) instead of the English last word.
 */
function EU_MARKETS(): Partial<Record<CountryCode, Market>> {
  const eu = "https://www.michaelkors.eu";
  const edges = [eu, ...EU_EDGES.filter((h) => h !== eu)];
  const mk = (host: string, site: string, locale: string): Market => ({
    host,
    api: host,
    site,
    locale,
    mirrors: edges.filter((h) => h !== host),
    outletMixed: false,
  });
  return {
    DE: mk("https://www.michaelkors.de", "mk_de", "de_DE"),
    FR: mk("https://www.michaelkors.fr", "mk_fr", "fr_FR"),
    IT: mk("https://www.michaelkors.it", "mk_it", "it_IT"),
    ES: mk("https://www.michaelkors.es", "mk_es", "es_ES"),
    NL: mk(eu, "mk_nl", "nl_NL"),
    BE: mk(eu, "mk_be", "nl_BE"),
    AT: mk(eu, "mk_at", "de_AT"),
    IE: mk(eu, "mk_ie", "en_IE"),
  };
}

export const MK_MARKETS: Partial<Record<CountryCode, Market>> = {
  US: { host: "https://www.michaelkors.com", api: "https://www.michaelkors.com", site: "mk_us", locale: "en_US", outletMixed: true },
  CA: { host: "https://www.michaelkors.com", api: "https://www.michaelkors.com", site: "mk_ca", locale: "en_CA", outletMixed: true },
  GB: { host: "https://www.michaelkors.co.uk", api: "https://www.michaelkors.global", site: "mk_uk", locale: "en_GB", mirrors: others("https://www.michaelkors.global"), outletMixed: false },
  CH: { host: "https://www.michaelkors.eu", api: "https://www.michaelkors.global", site: "mk_ch", locale: "en_CH", mirrors: others("https://www.michaelkors.global"), outletMixed: false },
  AU: { host: "https://www.michaelkors.global", api: "https://www.michaelkors.global", site: "mk_anz", locale: "en_AU", mirrors: others("https://www.michaelkors.global"), outletMixed: false },
  ...EU_MARKETS(),
};

/** Safari carries no client hints, so Akamai has nothing to find inconsistent. */
const SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";

/** ~23 KB of HTML per tile: 200 keeps a page near 5 MB (300-tile pages hit 20 s once). */
const PAGE_SIZE = 200;
const MAX_PAGES = 10;
/** Product-Variation calls per market, for colour-range styles. */
const VARIATION_BUDGET = 40;
/** Consecutive failed Product-Variation calls after which the runner is taken as refused. */
const VARIATION_REFUSALS = 3;
/** Wait before re-reading a grid page that came back with no tiles. */
const EMPTY_RETRY_MS = 1500;
const CAP = 1500;
const PAUSE_MS = 500;
/** Past this, colour-range calls stop (the brand limit is 300 s). */
const BUDGET_MS = Number(process.env.MK_BUDGET_MS ?? 200_000);
/** Per call: a 200-tile page is ~4.5 MB; a Product-Variation answer is small. */
const GRID_TIMEOUT_MS = 45_000;
const VARIATION_TIMEOUT_MS = 20_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const base = (m: Market) => `${m.api}/on/demandware.store/Sites-${m.site}-Site/${m.locale}`;

/** Built by hand: URLSearchParams would encode nothing here, but keep the exact probed shape. */
export function gridUrl(country: CountryCode, start: number, male = false): string {
  const m = MK_MARKETS[country]!;
  const gender = male ? "&prefn2=gender&prefv2=male" : "";
  return `${base(m)}/Search-UpdateGrid?cgid=sale&prefn1=priceStatus&prefv1=md${gender}&start=${start}&sz=${PAGE_SIZE}`;
}

export function variationUrl(country: CountryCode, pid: string, colour: string): string {
  const m = MK_MARKETS[country]!;
  return `${base(m)}/Product-Variation?pid=${encodeURIComponent(pid)}&dwvar_${pid}_color=${encodeURIComponent(colour)}&quantity=1`;
}

/**
 * The URL to use on each attempt: the primary host, then each mirror, round-robin,
 * starting at host index `first` (the one that last answered this market). Pure.
 */
export function attemptUrls(url: string, country: CountryCode, attempts: number, first = 0): string[] {
  const m = MK_MARKETS[country];
  const hosts = m ? [m.api, ...(m.mirrors ?? [])] : [];
  const out: string[] = [];
  for (let i = 0; i < attempts; i++) {
    const h = hosts[(first + i) % Math.max(hosts.length, 1)];
    out.push(m && h && url.startsWith(m.api) ? h + url.slice(m.api.length) : url);
  }
  return out;
}

/** Per market: index (into `[api, ...mirrors]`) of the host that last answered. */
const lastGood = new Map<CountryCode, number>();

async function fetchText(url: string, country: CountryCode, xhr = false): Promise<string> {
  const headers: Record<string, string> = {
    // Same key casing as http.ts, so these replace its defaults instead of joining them.
    "User-Agent": SAFARI_UA,
    "Accept-Language": `en-${country},en;q=0.9`,
    Accept: xhr ? "application/json, text/javascript, */*; q=0.01" : "*/*",
  };
  if (xhr) headers["X-Requested-With"] = "XMLHttpRequest";
  const hostCount = 1 + (MK_MARKETS[country]?.mirrors?.length ?? 0);
  const first = lastGood.get(country) ?? 0;
  const urls = attemptUrls(url, country, hostCount > 1 ? 4 : 3, first);
  let lastErr: unknown;
  for (let attempt = 0; attempt < urls.length; attempt++) {
    try {
      const text = await getText(urls[attempt], { country, headers, timeoutMs: xhr ? VARIATION_TIMEOUT_MS : GRID_TIMEOUT_MS });
      lastGood.set(country, (first + attempt) % hostCount);
      return text;
    } catch (err) {
      lastErr = err;
      // An edge's 429 challenge: back off, and move to the next host if there is one.
      if (attempt < urls.length - 1) await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    // Accented letters in the euro stores' names ("&agrave;", "&ecirc;", "&szlig;").
    .replace(/&([A-Za-z])(acute|grave|circ|uml|tilde|cedil|ring);/g, (_, l: string, k: string) =>
      (l + ({ acute: "\u0301", grave: "\u0300", circ: "\u0302", uml: "\u0308", tilde: "\u0303", cedil: "\u0327", ring: "\u030a" } as Record<string, string>)[k]).normalize("NFC"),
    )
    .replace(/&szlig;/g, "ß")
    .replace(/&euro;/g, "€")
    .replace(/&pound;/g, "£")
    .replace(/&eacute;/g, "é")
    .replace(/&egrave;/g, "è")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const num = (x: unknown): number | null => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_, a, c) => a + c.toUpperCase());

export interface Tile {
  pid: string;
  name: string;
  /** Path + query of the tile's PDP link, already decoded. */
  href: string;
  colour: string | null;
  colourName: string | null;
  colours: string[];
  brandLine: string | null;
  images: string[];
  list: number | null;
  /** Every "Now" value on the tile: one, or two for a colour-price range. */
  sales: number[];
  range: boolean;
}

/** Split a grid response into its tiles and read each one. Pure. */
export function parseGrid(html: string): Tile[] {
  const out: Tile[] = [];
  const parts = html.split('data-tile-product-id="').slice(1);
  for (const part of parts) {
    const pid = part.slice(0, part.indexOf('"'));
    const end = part.indexOf("<article");
    const t = end >= 0 ? part.slice(0, end) : part;
    if (!pid || pid === "null") continue;
    const link = /class="link back-to-product-anchor-js" href="([^"]+)"[^>]*>([^<]+)</.exec(t);
    if (!link) continue;
    const href = decodeEntities(link[1]);
    const colour = /_color=([A-Za-z0-9]+)/.exec(href)?.[1] ?? null;
    const brandLine = /class="product-brand">\s*<a[^>]*>([^<]+)</.exec(t)?.[1]?.trim() ?? null;
    const swatches = [...t.matchAll(/aria-label="Select Colou?r (.+?) for [^"]*"[^>]*?href="([^"]+)"/g)].map((m) => ({
      name: titleCase(decodeEntities(m[1]).trim()),
      code: /_color=([A-Za-z0-9]+)/.exec(decodeEntities(m[2]))?.[1] ?? null,
    }));
    const colours = [...new Set(swatches.map((s) => s.name))];
    const imgBlock = t.slice(0, t.indexOf('class="tile-body"') >= 0 ? t.indexOf('class="tile-body"') : t.length);
    const images = [...imgBlock.matchAll(/class="[^"]*tile-image[^"]*"\s+src="(https:\/\/[^"]+)"/g)].map((m) =>
      m[1].replace("/ECOM_Image_Medium/", "/ECOM_Image_Large/"),
    );
    const list = num(/content="([\d.]+)" data-automation="plp-list-price-value"/.exec(t)?.[1]);
    const sales = [...t.matchAll(/content="([\d.]+)" data-automation="plp-sale-price-value"/g)]
      .map((m) => num(m[1]))
      .filter((n): n is number => n != null);
    // A range tile prints its single "Was" as bare text, without a content attribute.
    const bareWas = /class="list">\s*<span class="sr-only">Was<\/span>\s*([^<]+)</.exec(t)?.[1];
    out.push({
      pid,
      name: decodeEntities(link[2]).replace(/\s+/g, " ").trim(),
      href,
      colour,
      colourName: swatches.find((s) => s.code === colour)?.name ?? null,
      colours,
      brandLine,
      images,
      list: list ?? (bareWas ? num(decodeEntities(bareWas).replace(/[^\d.,]/g, "").replace(/,/g, "")) : null),
      sales,
      range: /class="range-separator/.test(t) || sales.length > 1,
    });
  }
  return out;
}

/**
 * Product type from a German/French/Italian/Spanish/Dutch MK name, in English
 * ("Henkeltasche Emilia Small …" → "Bag"). First match wins, so wallets come
 * before bags (Brieftasche) and watches before jewellery. Pure.
 */
const EU_TYPES: [RegExp, string][] = [
  [/portemonnaie|geldb[öo]rse|brieftasche|kartenetui|portefeuille|porte-cartes|porte-monnaie|cartera|billetera|monedero|tarjetero|portafoglio|portacarte|portamonete|portemonnee|pasjeshouder|wallet/, "Wallet"],
  [/smartwatch|\buhr\b|uhren|montre|reloj|orologio|horloge/, "Watch"],
  [/rucksack|sac à dos|mochila|zaino|rugzak|backpack/, "Backpack"],
  [/tasche|\bsacs?\b|bolso|borsa|\btas\b|shopper|\btote\b|clutch|crossbody|pochette|satchel|\bhobo\b|bandouli[èe]re|bandolera|tracolla|riñonera|marsupio|banane|cabas/, "Bag"],
  [/sneaker|basket|zapatilla|turnschuh/, "Sneaker"],
  [/stiefel|stiefelette|\bbottes?\b|bottine|\bbotas?\b|botín|botines|stivale|stivaletto|tronchetto|laars|enkellaars/, "Boot"],
  [/sandal|spartiate|espadrille|alpargata|pantolette|\bmule|ciabatta|slipper|zueco|clog|tongs?\b|chancla/, "Sandal"],
  [/pumps?\b|escarpin|salón|décolleté|\bhakken|tacón/, "Pump"],
  [/loafer|mokassin|mocassin|mocasín|instapper/, "Loafer"],
  [/ballerin|bailarina|\bbabies\b|chaussure plate|\bflats?\b|merceditas/, "Flat"],
  [/combinaison|overall|jumpsuit|mono\b|tuta\b/, "Jumpsuit"],
  [/kleid|\brobe\b|vestido|vestito|\babito\b|\bjurk/, "Dress"],
  [/mantel|manteau|abrigo|cappotto|\bjas\b|parka|trench|daunen|doudoune|plumífero|piumino/, "Coat"],
  [/jacke|blouson|\bveste\b|chaqueta|cazadora|giacca|giubbotto|\bjack\b|blazer|americana/, "Jacket"],
  [/pullover|strick|\bpull\b|jersey|maglione|maglia|\btrui\b|cardigan|sweatshirt|sweat|hoodie|felpa|sudadera/, "Sweater"],
  [/bluse|blouse|blusa|hemd|chemise|camisa|chemisier|camicia|overhemd|t-shirt|\btop\b|tee-shirt|camiseta|polo|\bhaut\b|débardeur|tanktop|canotta|bodysuit|\bbody\b|corsage|bustier/, "Top"],
  [/\brock\b|\bjupe\b|falda|gonna|\brok\b/, "Skirt"],
  [/\bhose\b|pantalon|pantalón|pantaloni|broek|\bjeans?\b|vaqueros?\b|legging|shorts?\b|bermuda/, "Pants"],
  [/halskette|\bkette\b|collier|\bcollar\b|collana|ketting|anhänger|pendentif|colgante|ciondolo|hanger/, "Necklace"],
  [/armband|armreif|bracelet|pulsera|brazalete|bracciale/, "Bracelet"],
  [/ohrring|ohrstecker|boucles? d.oreilles|\bcréoles|pendientes|orecchini|oorbel|oorknop/, "Earrings"],
  [/\bring\b|\bbague|anillo|anello/, "Ring"],
  [/sonnenbrille|lunettes|gafas|occhiali|zonnebril/, "Sunglasses"],
  [/schal|écharpe|foulard|bufanda|pañuelo|sciarpa|sjaal/, "Scarf"],
  [/mütze|bonnet|gorro|berretto|cappello|\bhut\b|chapeau|sombrero|\bmuts\b|\bpet\b|\bcap\b|\bbob\b|cagoule|balaclava|passamontagna|pasamontañas|fischerhut|bucket/, "Hat"],
  [/handschuh|\bgants\b|guantes|guanti|handschoen/, "Gloves"],
  [/gürtel|ceinture|cinturón|cintura|\briem\b/, "Belt"],
  [/schlüssel|porte-clés|llavero|portachiavi|sleutelhanger|taschenanhänger|charm/, "Keychain"],
];

export function categoryEu(name: string): string | null {
  const n = name.toLowerCase();
  for (const [re, type] of EU_TYPES) if (re.test(n)) return type;
  return null;
}

/** The product type MK's names end with ("… Crossbody Bag", "… Kitten Mule"); non-English stores use `categoryEu`. */
function categoryOf(name: string, country?: CountryCode): string | null {
  const locale = country ? MK_MARKETS[country]?.locale : undefined;
  if (locale && !locale.startsWith("en_")) return categoryEu(name);
  const last = name.replace(/[^A-Za-z\s-]/g, " ").trim().split(/\s+/).pop();
  return last && last.length > 2 ? last[0].toUpperCase() + last.slice(1) : null;
}

const productUrl = (m: Market, href: string) =>
  `${m.host}${href.replace(/([?&])astc=true&?/, "$1").replace(/&?priceStatusType=md/, "").replace(/\?$/, "")}`;

/** Map one single-price tile to a record (null = not a real markdown, or outlet). Pure. */
export function mapTile(tile: Tile, country: CountryCode, men: Set<string>): ProductRecord | null {
  const m = MK_MARKETS[country];
  if (!m) return null;
  if (m.outletMixed && /outlet/i.test(tile.brandLine ?? "")) return null;
  if (tile.range || tile.sales.length !== 1 || tile.list == null) return null;
  const sale = tile.sales[0];
  if (!(sale < tile.list)) return null;
  return {
    brand: "michaelkors",
    country,
    externalId: tile.pid,
    name: tile.name,
    url: productUrl(m, tile.href),
    imageUrl: tile.images[0] ?? null,
    images: cleanGallery(tile.images, tile.images[0] ?? null),
    price: toMinor(sale),
    listPrice: toMinor(tile.list),
    currency: COUNTRIES[country].currency,
    inStock: true,
    category: categoryOf(tile.name, country),
    gender: men.has(tile.pid) ? "erkek" : "kadin",
    variants: null,
    groupKey: null,
    colorName: tile.colourName,
  };
}

/** Resolve a colour-range tile from its Product-Variation JSON. Pure. */
export function mapVariation(tile: Tile, json: any, country: CountryCode, men: Set<string>): ProductRecord | null {
  const m = MK_MARKETS[country];
  const p = json?.product;
  if (!m || !p) return null;
  if (m.outletMixed && /outlet/i.test(tile.brandLine ?? "")) return null;
  const sale = num(p.price?.sales?.value);
  const list = num(p.price?.list?.value);
  if (sale == null || list == null || !(sale < list)) return null;
  const currency = COUNTRIES[country].currency;
  if (p.price?.sales?.currency && p.price.sales.currency !== currency) return null;
  const attrs: any[] = Array.isArray(p.variationAttributes) ? p.variationAttributes : [];
  const sizeAttr = attrs.find((a) => a?.id === "size");
  const sizes: SizeVariant[] = (sizeAttr?.values ?? [])
    .filter((v: any) => v?.displayValue || v?.id)
    .map((v: any) => ({
      label: String(v.displayValue ?? v.id).trim(),
      availability: v.inStock === false || v.selectable === false ? "out_of_stock" : "in_stock",
    }));
  const colourAttr = attrs.find((a) => a?.id === "color");
  const sel = (colourAttr?.values ?? []).find((v: any) => v?.selected) ?? (colourAttr?.values ?? []).find((v: any) => v?.id === tile.colour);
  const colourName = sel?.displayValue ? titleCase(String(sel.displayValue)) : tile.colourName;
  const photos: string[] = (p.images?.large ?? []).map((i: any) => i?.url).filter((u: any) => typeof u === "string");
  const gallery = photos.length ? photos : tile.images;
  const inStock = sizes.length ? sizes.some((s) => s.availability !== "out_of_stock") : p.available !== false;
  return {
    brand: "michaelkors",
    country,
    externalId: tile.pid,
    name: tile.name,
    url: productUrl(m, tile.href),
    imageUrl: gallery[0] ?? null,
    images: cleanGallery(gallery, gallery[0] ?? null),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency,
    inStock,
    category: categoryOf(tile.name, country),
    gender: men.has(tile.pid) ? "erkek" : "kadin",
    variants: sizes.length ? { colors: colourName ? [colourName] : [], sizes } : null,
    groupKey: null,
    colorName: colourName,
  };
}

/**
 * Is this response the Search-UpdateGrid fragment (possibly with no tiles), as
 * opposed to a whole HTML document (an edge or error page served as 200) or an
 * empty body? The grid action renders `search/productGrid` with no page
 * decorator, so a real answer never carries `<html>`/`<!DOCTYPE>`. Pure.
 */
export function isGridFragment(html: string): boolean {
  if (html.includes('data-tile-product-id="')) return true;
  const head = html.slice(0, 4000);
  return head.trim().length > 0 && !/<!doctype|<html[\s>]|<body[\s>]/i.test(head);
}

/** Walk the sale grid; `male` collects only the ids. */
export async function crawlGrid(country: CountryCode, male: boolean, emptyRetryMs = EMPTY_RETRY_MS): Promise<Tile[]> {
  const tiles: Tile[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await sleep(PAUSE_MS);
    const url = gridUrl(country, page * PAGE_SIZE, male);
    let html = await fetchText(url, country);
    let got = parseGrid(html);
    if (page > 0 && !got.length) {
      // After a full page: the exact end (the total is a multiple of PAGE_SIZE),
      // or a 200 that is not the grid. Ending here on the latter is a partial
      // walk that looks complete, so read it again and insist on a fragment.
      await sleep(emptyRetryMs);
      html = await fetchText(url, country);
      got = parseGrid(html);
      if (!got.length && !isGridFragment(html)) {
        throw new Error(`michaelkors/${country}: start=${page * PAGE_SIZE} answered 200 without a grid (${html.length} B) — not ending the walk there`);
      }
    }
    tiles.push(...got);
    if (got.length < PAGE_SIZE) break;
  }
  return tiles;
}

export async function listMichaelKors(country: CountryCode): Promise<ProductRecord[]> {
  if (!MK_MARKETS[country]) return [];
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const tiles = await crawlGrid(country, false);
  if (!tiles.length) throw new Error(`michaelkors/${country}: sale grid returned no tiles`);
  let men = new Set<string>();
  try {
    men = new Set((await crawlGrid(country, true)).map((t) => t.pid));
  } catch (err) {
    console.warn(`michaelkors/${country}: men's pass failed, gender defaults to women — ${String(err)}`);
  }

  const byId = new Map<string, ProductRecord>();
  const ranges: Tile[] = [];
  for (const tile of tiles) {
    if (byId.has(tile.pid)) continue;
    if (tile.range) {
      ranges.push(tile);
      continue;
    }
    const r = mapTile(tile, country, men);
    if (r) byId.set(r.externalId, r);
  }

  const m = MK_MARKETS[country]!;
  const toResolve = ranges.filter((t) => t.colour && !(m.outletMixed && /outlet/i.test(t.brandLine ?? "")) && !byId.has(t.pid));
  let calls = 0;
  let refusals = 0;
  for (const tile of toResolve) {
    if (calls >= VARIATION_BUDGET || byId.size >= CAP || elapsed() > BUDGET_MS) break;
    if (refusals >= VARIATION_REFUSALS) {
      console.warn(`michaelkors/${country}: ${refusals} variation calls refused in a row, skipping the rest`);
      break;
    }
    calls++;
    await sleep(PAUSE_MS);
    try {
      const json = JSON.parse(await fetchText(variationUrl(country, tile.pid, tile.colour!), country, true));
      refusals = 0;
      const r = mapVariation(tile, json, country, men);
      if (r) byId.set(r.externalId, r);
    } catch (err) {
      refusals++;
      console.warn(`michaelkors/${country}: variation ${tile.pid} failed — ${String(err)}`);
    }
  }
  if (toResolve.length > calls) {
    console.log(
      `michaelkors/${country}: ${toResolve.length - calls} colour-range styles skipped (budget ${VARIATION_BUDGET} calls / ${BUDGET_MS / 1000} s, at ${Math.round(elapsed() / 1000)} s)`,
    );
  }

  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
