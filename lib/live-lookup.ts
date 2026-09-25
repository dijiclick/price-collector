import { ProxyAgent, type Dispatcher } from "undici";
import { BRANDS } from "./brands";
import { classifyType } from "./productTypes";
import { countryFromUrl } from "./scan-url";
import {
  DEFAULT_COUNTRY as DEFAULT_MARKET,
  currencyFor,
  type CountryCode,
} from "./countries";

/**
 * Fetch ONE product straight from a brand, for a URL the catalogue does not
 * already hold.
 *
 * The collector deliberately crawls only discounted items for beymen, boyner
 * and mango — that is what keeps the 90-minute cycle inside its timeout, and it
 * is why those brands store barely any full-price stock. But a product someone
 * wants to TRACK is by definition not discounted yet, so "paste a link, follow
 * it, get told when it drops" failed on exactly the products the feature exists
 * for.
 *
 * Rather than crawl three full catalogues nightly, resolve on demand: the one
 * product a person actually asked for gets fetched and inserted, then the
 * ordinary run re-prices it like any other row. Cost is one request per miss,
 * paid only when someone cares.
 *
 * This lives here rather than reusing the collector's adapters because the
 * collector's http layer carries undici's ProxyAgent and its retry/backoff
 * machinery, none of which belongs in a serverless request path.
 *
 * Deliberately NOT marked `server-only`: the collector needs the same lookup to
 * re-price these products (see the note in the resolve route), and it runs as a
 * plain node script, not inside Next.
 */

export interface LiveProduct {
  brand: string;
  externalId: string;
  name: string;
  url: string;
  imageUrl: string | null;
  /** Minor units (kuruş), as everywhere else. */
  price: number;
  listPrice: number | null;
  inStock: boolean;
  category: string | null;
  type: string | null;
  gender: string | null;
  colorName: string | null;
  /**
   * Which market this was quoted from, and in what. Optional: every resolver
   * that predates multi-country is reading a Turkish storefront, and the writer
   * defaults to TR/TRY — which is the literal `'TRY'` it used to hardcode.
   */
  country?: CountryCode;
  currency?: string;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Mango's orchestrator sits behind Akamai, which answers GitHub Actions but
 * returns 403 to Vercel's datacenter egress — verified in production, not
 * assumed. So the lookup goes out through the same residential proxy the
 * collector already knows about when one is configured.
 *
 * Unset is a supported state: the request simply goes direct, which is what the
 * collector does today and what works for brands that do not block. The agent
 * is built once — a ProxyAgent per request leaks sockets in a warm lambda.
 */
/**
 * Which country a brand's shop serves, and therefore which exit the request
 * should leave from. A Turkish shop answered from a German IP is the request
 * most likely to be challenged, priced differently, or served another locale.
 * Every brand here is Turkish today; the map exists so adding a market is a
 * line rather than a refactor.
 */
const BRAND_COUNTRY: Record<string, string> = {};
export const DEFAULT_COUNTRY = "tr";

/**
 * Which exit a request for `brand` should leave from.
 *
 * `country` is the MARKET being read, when the caller knows it — a pasted
 * `zara.com/uk/en/…` is a British storefront and answering it from a Turkish IP
 * is the request most likely to be challenged or priced differently. A brand
 * pinned in `BRAND_COUNTRY` still wins: some shops only answer one exit
 * whatever url you ask for, and that is a property of the shop.
 */
export const countryFor = (brand: string | undefined, country?: CountryLike): string =>
  (brand && BRAND_COUNTRY[brand]) || (country ? String(country).toLowerCase() : DEFAULT_COUNTRY);

/** Accepts either an ISO code ("GB") or an already-lowercased exit ("gb"). */
type CountryLike = string;

/**
 * DataImpulse selects the exit country through the USERNAME, not the host:
 * `user__cr.tr:pass@gw.dataimpulse.com:823`. So one credential serves every
 * market and the country is appended per request.
 *
 * A base url that already carries `__cr.` is left exactly as given — an
 * explicitly targeted credential is a deliberate choice, not something to
 * rewrite. A proxy with no username (an open or ip-authenticated gateway) is
 * passed through untouched for the same reason.
 */
export function proxyUrlFor(base: string | undefined, country: string): string | undefined {
  if (!base) return undefined;
  let u: URL;
  try { u = new URL(base); } catch { return undefined; }
  if (!u.username || u.username.includes("__cr.")) return base;
  u.username = `${u.username}__cr.${country.toLowerCase()}`;
  return u.toString();
}

/**
 * One agent per country, built once. A ProxyAgent per request leaks sockets in
 * a warm lambda, and the countries are a closed set.
 */
const agents = new Map<string, ProxyAgent | undefined>();
function dispatcher(country: string): Dispatcher | undefined {
  if (!agents.has(country)) {
    const url = proxyUrlFor(process.env.DATAIMPULSE_PROXY, country);
    agents.set(country, url ? new ProxyAgent(url) : undefined);
  }
  return agents.get(country);
}

/** True when a proxy is configured — useful for explaining a 403 to the caller. */
export function usingProxy(): boolean {
  return !!process.env.DATAIMPULSE_PROXY;
}

const toMinor = (major: number) => Math.round(major * 100);

/**
 * A miss and an upstream refusal are different failures and must not look the
 * same: "we do not stock this" is a dead end, "the brand would not answer us"
 * is worth retrying. The reason is logged rather than swallowed — this ran for
 * a full deploy returning a silent null before anyone could see why.
 */
async function json<T>(url: string, headers: Record<string, string>, country: string): Promise<T | null> {
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  try {
    const r = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(country),
    });
    if (!r.ok) {
      console.warn(`live-lookup: ${host} refused with HTTP ${r.status}${usingProxy() ? ` (via ${country} proxy)` : " (direct egress)"}`);
      return null;
    }
    return (await r.json()) as T;
  } catch (err) {
    console.warn(`live-lookup: ${host} unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * GraphQL needs POST, which `json()` above cannot do. Same proxy, same timeout,
 * same rule about telling a refusal apart from a miss.
 */
async function postJson<T>(url: string, body: unknown, country: string): Promise<T | null> {
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(country),
    });
    if (!r.ok) {
      console.warn(`live-lookup: ${host} refused with HTTP ${r.status}${usingProxy() ? ` (via ${country} proxy)` : " (direct egress)"}`);
      return null;
    }
    return (await r.json()) as T;
  } catch (err) {
    console.warn(`live-lookup: ${host} unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/* ---------------------------------------------------------------- rossmann */

const ROSSMANN_GQL = "https://www.rossmann.com.tr/graphql";
const ROSSMANN_SITE = "https://www.rossmann.com.tr";

/**
 * Resolve a scanned EAN against Rossmann's catalogue.
 *
 * Magento exposes `barcode` as a filterable attribute, so this is an exact
 * match rather than a full-text `search:` that happens to hit — verified
 * 2026-08-22: `4305615826950` returns exactly one product either way, but
 * `search:` can also return neighbours and there is no way to tell which row
 * actually carries the code.
 *
 * The filter takes `match`, not `eq`; `eq` is rejected outright with
 * `Field "eq" is not defined by type "FilterMatchTypeInput"`.
 */
const ROSSMANN_FIELDS = `sku barcode name url_key stock_status small_image { url }
    crm_price special_price ross_60_price cmp_100_price cmp_50_price cmp_20_price
    price_range { minimum_price { regular_price { value } final_price { value } } }`;

/** One Rossmann GraphQL item, priced the way the collector prices it. */
function mapRossmann(p: any): LiveProduct | null {
  if (!p?.sku || !p.url_key) return null;
  const min = p.price_range?.minimum_price ?? {};
  const regular: number | undefined = min.regular_price?.value;
  const final: number | undefined = min.final_price?.value ?? regular;
  if (typeof final !== "number" || final <= 0) return null;
  // Campaign columns undercut `final` when a promotion is running; the first
  // that does, in the collector's order (crm, direct markdown, basket
  // threshold), is what the shelf actually charges.
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  const special = n(p.ross_60_price) || n(p.special_price);
  const cmp = n(p.cmp_100_price) || n(p.cmp_50_price) || n(p.cmp_20_price);
  const campaign = [n(p.crm_price), special, cmp].find((c) => c > 0 && c < final);
  const price = campaign ?? final;
  const listPrice = campaign ? final : typeof regular === "number" && regular > final ? regular : null;

  return {
    brand: "rossmann",
    externalId: String(p.sku),
    name: String(p.name ?? ""),
    url: `${ROSSMANN_SITE}/${p.url_key}`,
    imageUrl: p.small_image?.url ?? null,
    price: toMinor(price),
    listPrice: listPrice != null && listPrice > price ? toMinor(listPrice) : null,
    inStock: p.stock_status === "IN_STOCK",
    category: null,
    type: null,
    gender: null,
    colorName: null,
  };
}

async function rossmannByBarcode(barcode: string): Promise<LiveProduct | null> {
  const query = `{ products(filter: { barcode: { match: ${JSON.stringify(barcode)} } }, pageSize: 5) {
      items { ${ROSSMANN_FIELDS} } } }`;

  const res = await postJson<any>(ROSSMANN_GQL, { query }, countryFor("rossmann"));
  const items: any[] = res?.data?.products?.items ?? [];
  // `match` is a LIKE, so a short code could bring back neighbours. Only the row
  // whose own barcode equals what was scanned is the product in the user's hand.
  const p = items.find((x) => String(x?.barcode ?? "").replace(/\D/g, "") === barcode) ?? null;
  return mapRossmann(p);
}

/* ------------------------------------------------------------------ beymen */

const BEYMEN_BARCODE = "https://www.beymen.com/mobile2/mbProduct/productdetailfrombarcode";

/**
 * Resolve a scanned Beymen tag.
 *
 * Beymen is 51% of the catalogue and publishes no barcode ANYWHERE on the web —
 * the earlier audit checked and correctly found nothing, which capped scan
 * coverage at 20.7%. Their Android app tells a different story: it ships an
 * in-store scanner, so a barcode path had to exist. Pulling endpoint strings out
 * of `com.mobisoft.beymen` 3.37.0 found this one, and it needs no key, no token
 * and no app headers.
 *
 * Confirmed end to end 2026-08-23: `…/api/mbProduct/stock?productId=2048339`
 * reports `VariantBarcode: "049486321"` for size XS, and that barcode comes back
 * here as the same product. Note the codes are per SIZE, which is right — a
 * shopper scans the tag of the garment in their hand, not a product-level code.
 *
 * Nothing is collected for Beymen: the barcode is absent from the listing AND
 * from the mobile product endpoint, appearing only in the per-product stock
 * call. Resolving live costs one request when someone actually scans, instead of
 * 43,000 requests a sweep to store codes nobody may ever scan.
 */
async function beymenByBarcode(barcode: string): Promise<LiveProduct | null> {
  const res = await json<any>(
    `${BEYMEN_BARCODE}?barcode=${encodeURIComponent(barcode)}`,
    { Accept: "application/json", "User-Agent": "okhttp/4.12.0" },
    countryFor("beymen"),
  );
  // A miss is a 200 with Success:false ("Bu barkoda ait ürün bulunamadı"), not
  // an HTTP error, so the status alone would read every miss as a hit.
  if (!res?.Success) return null;
  const r = res.Result;
  if (!r?.ID || !r.DisplayName) return null;

  const price = Number(r.PromotedOrActualPrice ?? r.ActualPriceToShowOnScreen);
  if (!Number.isFinite(price) || price <= 0) return null;
  const struck = Number(r.StrikeThroughPriceToShowOnScreen);
  const listPrice = r.IsStrikeThroughPriceExists && Number.isFinite(struck) && struck > price ? struck : null;

  return {
    brand: "beymen",
    externalId: String(r.ID),
    name: String(r.DisplayName),
    url: String(r.ShareUrl ?? `https://www.beymen.com/tr/p_${r.ID}`),
    imageUrl: r.FirstProductImageURL ?? null,
    price: toMinor(price),
    listPrice: listPrice == null ? null : toMinor(listPrice),
    inStock: r.IsOutOfStock !== true,
    // The collector puts the designer label in `category` for beymen, not in the
    // brand — keep the two paths writing the same shape.
    category: r.BrandName ?? null,
    type: null,
    gender: r.Pgen === "K" ? "kadin" : r.Pgen === "E" ? "erkek" : null,
    colorName: null,
  };
}

/* ----------------------------------------------------------------- watsons */

const WATSONS_API = "https://api.watsons.com.tr/api/v2/wtctr-spa";
const WATSONS_SITE = "https://www.watsons.com.tr";

/**
 * Resolve a scanned Watsons EAN.
 *
 * Their app ships a BarcodeScannerViewModel but no dedicated barcode endpoint —
 * the scanner just puts the digits through the ordinary product search, and that
 * works: EAN `8803348040248` returns exactly one product, `BP_1376284`. This is
 * the same SAP Commerce search the collector already calls, so nothing new is
 * being reached for.
 *
 * Guarded like Rossmann's: search is fuzzy by nature, so only a single decisive
 * result is accepted. Several results means the code was treated as loose text
 * and any one of them could be the wrong product.
 */
async function watsonsByBarcode(barcode: string): Promise<LiveProduct | null> {
  const url = `${WATSONS_API}/search?fields=FULL&searchType=PRODUCT`
    + `&query=${encodeURIComponent(barcode)}&currentPage=0&pageSize=5`;
  const res = await json<any>(url, {
    Accept: "application/json",
    Origin: WATSONS_SITE,
    Referer: `${WATSONS_SITE}/`,
  }, countryFor("watsons"));

  const items: any[] = res?.products ?? [];
  if (items.length !== 1) return null;
  const p = items[0];
  const price = Number(p?.price?.value);
  if (!p?.code || !p.name || !Number.isFinite(price) || price <= 0) return null;

  const was = Number(p?.strikeThroughPrice?.value ?? p?.wasPrice?.value);
  const img = (p.images ?? []).find((i: any) => i?.imageType === "PRIMARY") ?? (p.images ?? [])[0];

  return {
    brand: "watsons",
    externalId: String(p.code),
    name: String(p.name),
    url: p.url ? `${WATSONS_SITE}${p.url}` : WATSONS_SITE,
    imageUrl: img?.url ? `${WATSONS_SITE}${img.url}` : null,
    price: toMinor(price),
    listPrice: Number.isFinite(was) && was > price ? toMinor(was) : null,
    inStock: p?.stock?.stockLevelStatus !== "outOfStock",
    category: null,
    type: null,
    gender: null,
    colorName: null,
  };
}

/**
 * Brands that can turn a scanned tag into a product without a url.
 *
 * Deliberately short. A barcode carries no brand, so every entry here is tried
 * in turn — each one is a live request on a cache miss, and the list is ordered
 * so the cheapest, most reliable answer comes first. Adding a brand means
 * proving its catalogue is queryable BY CODE: Boyner's listing API, which the
 * collector already calls, returns nothing for a barcode on any of six
 * parameter names, so it is not here despite publishing EANs.
 */
const BARCODE_RESOLVERS: Record<string, (code: string) => Promise<LiveProduct | null>> = {
  // Beymen first: it is over half the catalogue, so it is the likeliest hit and
  // trying it first keeps the common case to a single request.
  beymen: beymenByBarcode,
  rossmann: rossmannByBarcode,
  watsons: watsonsByBarcode,
  // Penti's own urls carry no article number, so a Penti tag that is not in the
  // catalogue has no other route at all — the url-matching fallback in
  // findProductByBarcode cannot help it.
  penti: pentiByBarcode,
};

export function barcodeBrands(): string[] {
  return Object.keys(BARCODE_RESOLVERS);
}

/**
 * Ask every brand that can answer for a scanned code, and return the cheapest
 * that does.
 *
 * Parallel, and cheapest-wins, for one reason each.
 *
 * **Cheapest**, because `findProductByBarcode` already resolves that way when
 * several shops carry one EAN, and the two paths answering the same scan
 * differently is indefensible — a code we happen to hold returns the best price,
 * the same code fetched live returned whichever resolver was declared first.
 * Rossmann, Watsons and Gratis are all drugstores with overlapping catalogues,
 * so this is a real case, not a hypothetical.
 *
 * **Parallel**, because sequential made a MISS cost the sum of every brand —
 * measured at 1.66s against ~0.7s for the slowest single lookup — and a miss is
 * the common case for the brands nobody stocks. Stopping at the first hit saved
 * requests but could not pick the best one anyway.
 */
export async function lookupLiveByBarcode(barcode: string): Promise<LiveProduct | null> {
  const digits = (barcode ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 14) return null;

  // A brand being down must not end the search, so each settles independently.
  const settled = await Promise.all(
    Object.values(BARCODE_RESOLVERS).map((resolve) =>
      resolve(digits).catch(() => null),
    ),
  );
  const hits = settled.filter((p): p is LiveProduct => !!p && p.price > 0);
  if (hits.length === 0) return null;
  // In stock beats cheap — a price you cannot pay is not a better price. Same
  // rule, same order, as the SQL in findProductByBarcode.
  hits.sort((a, b) => Number(b.inStock) - Number(a.inStock) || a.price - b.price);
  return hits[0];
}


/* -------------------------------------------------------------------- penti */

const PENTI_API = "https://www.penti.com/pentiwebservices/v2/penti";

/**
 * Penti by barcode, for the product our catalogue does not hold.
 *
 * The point of a live resolver is the thing a shopper actually wants to do:
 * scan something that is NOT on sale, and ask to be told when it drops or when
 * their size comes back. The collector only ever holds a slice of a shop, so
 * without this a perfectly real product answers "not found".
 *
 * Penti's search is fuzzy — querying an EAN returns a dozen neighbours from the
 * same family (`…955512`, `…955567` came back for `…955550`). Only the row
 * whose own `ean` equals the scan is the garment in the user's hand; anything
 * else would put a different SIZE or colour on screen, which is worse than a
 * miss because nothing in the UI could show it was wrong. Same rule as
 * rossmannByBarcode.
 */
async function pentiByBarcode(barcode: string): Promise<LiveProduct | null> {
  const url =
    `${PENTI_API}/products/search?query=${encodeURIComponent(barcode)}` +
    `&pageSize=50&fields=FULL&lang=tr&curr=TRY`;
  const res = await json<any>(url, { Accept: "application/json", "User-Agent": UA }, countryFor("penti"));
  const items: any[] = res?.products ?? [];
  const p = items.find((x) => String(x?.ean ?? "").replace(/\D/g, "") === barcode);
  if (!p) return null;

  const value = p.price?.value;
  if (typeof value !== "number" || value <= 0) return null;
  const prev = p.price?.previousPrice?.value;

  const img = p.images?.find((i: any) => i.imageType === "PRIMARY") ?? p.images?.[0];
  const imageUrl = img?.url
    ? (img.url.startsWith("http") ? img.url : `https://www.penti.com${img.url}`)
        .replace("{0}", "500").replace("{1}", "650")
    : null;

  const name = String(p.name ?? "");
  return {
    brand: "penti",
    externalId: String(p.code ?? ""),
    name,
    url: p.url ? `https://www.penti.com/tr${p.url}` : "https://www.penti.com/tr",
    imageUrl,
    price: toMinor(value),
    listPrice: typeof prev === "number" && prev > value ? toMinor(prev) : null,
    inStock: p.stock?.stockLevelStatus !== "outOfStock",
    category: p.categoryName ?? null,
    type: classifyType(name, p.categoryName ?? null),
    gender: null,
    colorName: null,
  };
}

/* ------------------------------------------------------------------- mango */

const MANGO_ORCH = "https://online-orchestrator.mango.com";
// The orchestrator sits behind Akamai and rejects bare requests.
const MANGO_HEADERS = {
  Accept: "application/json",
  "User-Agent": UA,
  "Accept-Language": "tr-TR",
  Origin: "https://shop.mango.com",
  Referer: "https://shop.mango.com/",
};

/**
 * A Mango PDP url carries everything needed:
 *   /tr/tr/p/erkek/pantolon/rahat/<slug>/37044406/03/00
 *                                        ^id     ^colour
 * The gender segment is the first path part after /p/.
 */
export function parseMangoUrl(url: string): { id: string; colorId: string; gender: string | null } | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  // Turkish sections arrive percent-encoded (`kad%C4%B1n` = "kadın"), so the
  // gender test never matched a real Turkish url until the path was decoded.
  try { path = decodeURIComponent(path); } catch { /* keep the raw path */ }
  // Colour codes are not always digits: `/37084447/OR/00`, `/TS/`, `/TN/`. A
  // digits-only pattern dropped them and priced the first colour instead.
  const m = path.match(/\/p\/([^/]+)\/.*?\/(\d{6,9})(?:\/([0-9A-Za-z]{2,3})(?=\/|$))?/);
  if (!m) return null;
  const section = m[1].toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/ç/g, "c");
  const gender =
    section === "kadin" || section === "women" ? "kadin"
    : section === "erkek" || section === "men" ? "erkek"
    : /cocuk|kids|teen/.test(section) ? "cocuk"
    : null;
  return { id: m[2], colorId: m[3] ?? "", gender };
}

async function mango(url: string): Promise<LiveProduct | null> {
  const parsed = parseMangoUrl(url);
  if (!parsed) return null;
  /**
   * The url's own market, not a hardcoded TR.
   *
   * Mango's orchestrator takes `countryIso` and answers with that market's
   * price — verified for all nine probed countries. Asking it for TR while the
   * shopper pasted `/gb/en/` returned a lira price for a British product, which
   * is a wrong number that looks entirely right.
   */
  const country = countryFromUrl(url) ?? DEFAULT_MARKET;
  const languageIso = country === "TR" ? "tr" : "en";
  const [prices, detail] = await Promise.all([
    json<Record<string, { price?: number; crossedOutPrice?: number; type?: string }>>(
      `${MANGO_ORCH}/v3/prices/products?channelId=shop&countryIso=${country}&productId=${parsed.id}`,
      MANGO_HEADERS,
      countryFor("mango", country),
    ),
    json<any>(
      `${MANGO_ORCH}/v4/products?channelId=shop&countryIso=${country}&languageIso=${languageIso}&productId=${parsed.id}`,
      MANGO_HEADERS,
      countryFor("mango", country),
    ),
  ]);
  if (!prices) return null;

  // Prices are keyed by colour id. Prefer the colour in the url, else the first.
  const key = parsed.colorId && prices[parsed.colorId] ? parsed.colorId : Object.keys(prices)[0];
  const entry = key ? prices[key] : undefined;
  const price = typeof entry?.price === "number" ? entry.price : null;
  if (price == null || price <= 0) return null;
  const wasMajor = typeof entry?.crossedOutPrice === "number" ? entry.crossedOutPrice : null;

  const name: string = detail?.name ?? detail?.productName ?? "";
  if (!name) return null;

  /**
   * Images are built, not listed. `colors` is keyed by ORDINAL ("0","1",…) while
   * each entry's own `id` is the colour code that appears in the url ("03"), so
   * the lookup has to go through the values. The path is relative to
   * `assetsDomain`; `looks["00"]` is the primary shot, `bulletImg` the swatch —
   * the swatch is a poor product image but better than a grey placeholder.
   */
  const colorEntries: any[] = Object.values(detail?.colors ?? {});
  const colour =
    colorEntries.find((c: any) => String(c?.id) === (parsed.colorId || key)) ?? colorEntries[0];
  const assets: string = detail?.assetsDomain ?? "https://media.mango.com";
  const looks = colour?.looks ?? {};
  const firstLook: any = looks["00"] ?? Object.values(looks)[0];
  const imgPath: string | undefined =
    firstLook?.images?.["500"]?.img ?? firstLook?.images?.[Object.keys(firstLook?.images ?? {})[0]]?.img ?? colour?.bulletImg;
  const image = imgPath ? `${assets}${imgPath}` : null;

  return {
    brand: "mango",
    externalId: parsed.id,
    name,
    url: url.split(/[?#]/)[0],
    imageUrl: typeof image === "string" ? image : null,
    price: toMinor(price),
    listPrice: wasMajor && wasMajor > price ? toMinor(wasMajor) : null,
    inStock: true,
    category: null,
    type: classifyType(null, name),
    gender: parsed.gender,
    colorName: typeof colour?.label === "string" ? colour.label : null,
    country,
    currency: currencyFor(country),
  };
}

/* ---------------------------------------------------------------- registry */

/**
 * Only brands whose single-product endpoint is reachable without the
 * collector's proxy/retry stack. Adding one is a function plus a line here —
 * and a brand missing from this map simply falls back to "not found", which is
 * the behaviour that exists today.
 */
/**
 * Resolve a Beymen PDP url we do not already hold.
 *
 * The url ends in the product id — `…/p_yorstruly-…-t-shirt_2048339` — and the
 * app's own product endpoint takes exactly that, unauthenticated. Worth having
 * because Beymen is over half the catalogue AND the collector only crawls its
 * discounted rows, so a full-price item scanned in a shop is missing by design:
 * precisely the thing somebody wants to track and wait on.
 */
async function beymenUrl(url: string): Promise<LiveProduct | null> {
  const id = url.match(/_(\d{4,})(?:[/?#]|$)/)?.[1];
  if (!id) return null;
  const headers = { Accept: "application/json", "User-Agent": "okhttp/4.12.0" };
  const [res, stock] = await Promise.all([
    json<any>(`https://www.beymen.com/mobile2/api/mbProduct/v2/product?productId=${id}`, headers, countryFor("beymen")),
    json<any>(`https://www.beymen.com/mobile2/api/mbProduct/stock?productId=${id}`, headers, countryFor("beymen")),
  ]);
  // A miss is 200 with Success:false, exactly as on the barcode endpoint.
  if (!res?.Success) return null;
  const r = res.Result;
  /**
   * `ActualPrice`, not `PromotedOrActualPrice`: the latter folds in basket
   * promotions the collector's listing never shows (measured 2026-09-24:
   * 1968673 read 6100 here against the collector's 7995). Two sources pricing
   * one row differently would fire a fake drop every time they alternated.
   */
  const price = Number(r?.ActualPrice ?? r?.PromotedOrActualPrice);
  if (!r?.ProductId || !r.DisplayName || !Number.isFinite(price) || price <= 0) return null;
  const struck = Number(r.StrikeThroughPrice);
  const list = r.IsStrikeThroughPriceExist && Number.isFinite(struck) && struck > price ? struck : null;
  // v2 carries no `FirstProductImageURL` and no `IsOutOfStock` — both were read
  // anyway, so every url-resolved Beymen row was stored imageless and in stock.
  const imgs: any[] = r.Images?.[0]?.Images ?? [];
  const image = imgs.find((i) => i?.SizeCode === "original")?.ImageUrl ?? imgs[0]?.ImageUrl ?? null;
  const sizes: any[] = stock?.Success ? stock.Result?.SizeList ?? [] : [];
  const pgen = r.GtmModel?.Pgen ?? r.Pgen;
  return {
    brand: "beymen",
    externalId: String(r.ProductId),
    name: String(r.DisplayName),
    url: String(r.ShareUrl ?? url),
    imageUrl: typeof image === "string" && !image.includes("{") ? image : null,
    price: toMinor(price),
    listPrice: list == null ? null : toMinor(list),
    // Unknown stock (the stock call failed) is reported as in stock, which is
    // what this resolver always said before.
    inStock: sizes.length === 0 ? true : sizes.some((x) => Number(x?.StockQuantity) > 0),
    // The collector puts the designer label in `category` for beymen.
    category: r.BrandName ?? null,
    type: null,
    gender: pgen === "K" ? "kadin" : pgen === "E" ? "erkek" : null,
    colorName: null,
  };
}

/* ------------------------------------------------------------------ boyner */

/** Boyner's detail API prints money the Turkish way: "1.253,38". */
export function trMoney(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (!s) return NaN;
  return Number(s.replace(/\./g, "").replace(",", "."));
}

/**
 * Boyner by url. The collector sweeps DISCOUNTED items only, so every
 * full-price product — the thing someone wants to wait on — was "not found".
 * `GetDetails` is what boyner.com.tr's own product page calls; no auth.
 */
async function boynerUrl(url: string): Promise<LiveProduct | null> {
  const id = url.match(/-p-(\d{5,})(?:[/?#]|$)/)?.[1];
  if (!id) return null;
  const res = await json<any>(
    `https://mpcore-listingdetail-prod-web.boyner.com.tr/api/v3/ProductDetail/GetDetails?productId=${id}`,
    { Accept: "application/json", "User-Agent": "okhttp/4.12.0" },
    countryFor("boyner"),
  );
  const r = res?.Success ? res.Result : null;
  if (!r?.ProductId || !r.DisplayName) return null;
  const info = r.PriceInfo ?? {};
  let price = trMoney(info.Price);
  let old = trMoney(info.OldPrice);
  /**
   * "bestOffer" is a basket coupon: `Price` is the coupon price and `OldPrice`
   * the shelf price, while the collector's listing reports the shelf price.
   * Take the shelf price so the two sources never disagree about one row.
   */
  if (info.CampaignType === "bestOffer" && Number.isFinite(old) && old > 0) {
    price = old;
    old = NaN;
  }
  if (!Number.isFinite(price) || price <= 0) return null;
  const media: any[] = r.Medias ?? [];
  const img = media.find((m) => m?.IsDefault) ?? media[0];
  const selected = (r.OtherProducts ?? []).find((o: any) => o?.IsSelected);
  const variants: any[] = r.Variants ?? [];
  const inStock = r.ExtraInfos?.IsOutOfStock === true
    ? false
    : variants.length === 0 || variants.some((v) => Number(v?.StockCount) > 0 || v?.StockInfoType === "InStock");
  const gender = /kad[ıi]n/i.test(String(r.Gender ?? "")) ? "kadin"
    : /erkek/i.test(String(r.Gender ?? "")) ? "erkek"
    : /[çc]ocuk/i.test(String(r.Gender ?? "")) ? "cocuk" : null;
  return {
    brand: "boyner",
    externalId: String(r.ProductId),
    name: String(r.DisplayName).replace(/\s+/g, " ").trim(),
    url: selected?.Url ? `https://www.boyner.com.tr/${selected.Url}` : url.split(/[?#]/)[0],
    imageUrl: img?.CoverUrl ?? null,
    price: toMinor(price),
    listPrice: Number.isFinite(old) && old > price ? toMinor(old) : null,
    inStock,
    // Same as the collector: the label goes in category for multi-brand shops.
    category: r.Brand?.Name ?? null,
    type: classifyType(r.CategoryName ?? null, String(r.DisplayName)),
    gender,
    colorName: selected?.Title ?? null,
  };
}

/* ------------------------------------------------------------------- koton */

/**
 * Koton by url: the product page itself answers JSON with `?format=json`.
 *
 * The stored id is the COLOUR option's pk, not `product.pk` — a PDP url can
 * name one size of a colour (`-3911474-3/`), whose pk is a sibling of the one
 * the collector stores. Fetch the pasted path as-is: a rebuilt `/x-<code>/`
 * path 404s.
 */
async function kotonUrl(url: string): Promise<LiveProduct | null> {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/-\d{7}(?:-\d+)?\/?$/.test(u.pathname)) return null;
  const path = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
  const res = await json<any>(
    `https://www.koton.com${path}?format=json`,
    { Accept: "application/json", "User-Agent": UA },
    countryFor("koton"),
  );
  const p = res?.product;
  const price = parseFloat(p?.price);
  if (!p?.pk || !p.name || !Number.isFinite(price) || price <= 0) return null;
  const retail = parseFloat(p.retail_price);
  const groups: any[] = res.variants ?? [];
  const opts = (key: string): any[] => groups.find((g) => g?.attribute_key === key)?.options ?? [];
  const colourCode = p.attributes?.integration_color_desc;
  const colour = opts("integration_color_desc").find((o) => o?.value === colourCode);
  const sizes = opts("integration_size_id");
  const img = [...(p.productimage_set ?? [])].sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))[0];
  const name = String(p.name);
  const category = p.attributes?.filterable_kategori ?? p.attributes?.filterable_category ?? null;
  return {
    brand: "koton",
    externalId: String(colour?.product?.pk ?? p.pk),
    name,
    url: `https://www.koton.com${p.absolute_url ?? path}`,
    imageUrl: img?.image ?? null,
    price: toMinor(price),
    listPrice: Number.isFinite(retail) && retail > price ? toMinor(retail) : null,
    inStock: sizes.length > 0 ? sizes.some((o) => o?.in_stock === true) : res.in_stock !== false,
    category,
    type: classifyType(category, name),
    gender: null,
    colorName: colour?.label ?? null,
  };
}

/* ------------------------------------------------------------------ gratis */

/** Same rule as the collector's `payablePrice`: promo < shelf < normal. Minor units. */
function gratisMoney(prices: any): { price: number; list: number | null } | null {
  const normal = prices?.normalPrice;
  const shelf = prices?.discountedPrice ?? normal;
  if (typeof shelf !== "number" || shelf <= 0) return null;
  const promo = prices?.promotionPrice;
  const price = typeof promo === "number" && promo > 0 && promo < shelf ? promo : shelf;
  const higher = [typeof normal === "number" ? normal : 0, shelf].filter((v) => v > price);
  return { price, list: higher.length ? Math.max(...higher) : null };
}

async function gratisUrl(url: string): Promise<LiveProduct | null> {
  const id = url.match(/(?:^|[-/])p-(\d{5,})(?:[/?#]|$)/)?.[1];
  if (!id) return null;
  const res = await json<any>(
    `https://api.gratis.retter.io/1oakekr4e/CALL/Product/getProductDetail/${id}`,
    { Accept: "application/json", "User-Agent": UA },
    countryFor("gratis"),
  );
  const p = res?.product;
  const money = gratisMoney(p?.prices);
  if (!p?.id || !money) return null;
  // The detail endpoint lists attributes as [{key, value}]; search gives a dict.
  const attrs: Record<string, any> = Array.isArray(p.attributes)
    ? Object.fromEntries(p.attributes.map((a: any) => [a?.key, a?.value]))
    : p.attributes ?? {};
  const name = String(attrs.displayName ?? "");
  if (!name) return null;
  const categories = Array.isArray(attrs.categories) ? attrs.categories : [];
  return {
    brand: "gratis",
    externalId: String(p.id),
    name,
    url: typeof res.shareLink === "string" ? res.shareLink : url.split(/[?#]/)[0],
    imageUrl: p.imageUrls?.[0]?.fileUrl ?? null,
    price: money.price,
    listPrice: money.list,
    inStock: p.active !== false && p.stockStatus != null && p.stockStatus !== "NONE",
    category: categories.at(-1) ?? null,
    type: classifyType(categories.at(-1) ?? null, name),
    gender: null,
    colorName: attrs.colorName ?? null,
  };
}

/* ---------------------------------------------------------- rossmann (url) */

/**
 * Rossmann by url. The sku is the tail of the url key (`…-p-kt26080223`), and
 * filtering on it — not on `url_key` — survives any slug, which the site
 * itself accepts. Cloudflare refuses non-Turkish egress, which is also why the
 * collector's Rossmann sweep has been dark since 2026-09-06; `countryFor`
 * sends this through the Turkish exit.
 */
async function rossmannUrl(url: string): Promise<LiveProduct | null> {
  const sku = url.match(/-p-([a-z]{2,4}\d{5,})\/?(?:[?#]|$)/i)?.[1]?.toUpperCase();
  if (!sku) return null;
  const query = `{ products(filter: { sku: { eq: ${JSON.stringify(sku)} } }, pageSize: 2) { items { ${ROSSMANN_FIELDS} } } }`;
  const res = await postJson<any>(ROSSMANN_GQL, { query }, countryFor("rossmann"));
  const p = (res?.data?.products?.items ?? []).find((x: any) => String(x?.sku ?? "").toUpperCase() === sku);
  return p ? mapRossmann(p) : null;
}

/* --------------------------------------------------------------------- h&m */

/** Mirrors `LOCALES` in the collector's hm.ts, so names match stored rows. */
const HM_LOCALES: Partial<Record<CountryCode, string>> = {
  TR: "tr_tr", GB: "en_gb", US: "en_us", CA: "en_ca", AU: "en_au", IE: "en_ie",
  DE: "de_de", FR: "fr_fr", NL: "nl_nl", BE: "nl_be", AT: "de_at", ES: "es_es",
  IT: "it_it", PT: "pt_pt", FI: "fi_fi", CH: "de_ch", SE: "sv_se", DK: "da_dk", NO: "no_no",
};

/**
 * H&M by url, through the same `api.hm.com` search the collector lists with.
 * The product page is Akamai-blocked for scripts; the search is not, and
 * querying an article number returns that article. Limitation: a SOLD-OUT
 * article drops out of search, so it cannot be resolved this way.
 */
async function hmUrl(url: string): Promise<LiveProduct | null> {
  let path = "";
  try { path = decodeURIComponent(new URL(url).pathname); } catch { return null; }
  // `entrance.ahtml?orguri=/tr_tr/productpage…` (the country picker) keeps the
  // real path in its query; accept the id from there too.
  const id = (path.match(/productpage\.(\d{7,})\.html/) ?? url.match(/productpage\.(\d{7,})\.html/))?.[1];
  if (!id) return null;
  const country = countryFromUrl(url) ?? DEFAULT_MARKET;
  const locale = HM_LOCALES[country];
  if (!locale) return null;
  const res = await json<any>(
    `https://api.hm.com/search-services/v1/${locale}/search/resultpage?query=${id}&page=1&pageSize=36&touchPoint=Desktop`,
    { Accept: "application/json", "User-Agent": UA },
    countryFor("hm", country),
  );
  const p = (res?.searchHits?.productList ?? []).find((x: any) => String(x?.id) === id);
  if (!p) return null;
  const prices: number[] = (p.prices ?? []).map((x: any) => Number(x?.price)).filter((n: number) => n > 0);
  const white = Number((p.prices ?? []).find((x: any) => x?.priceType === "whitePrice")?.price ?? prices[0]);
  const current = Math.min(...prices);
  if (!Number.isFinite(current) || current <= 0 || !p.productName) return null;
  return {
    brand: "hm",
    externalId: id,
    name: String(p.productName),
    url: `https://www2.hm.com${p.url ?? `/${locale}/productpage.${id}.html`}`,
    imageUrl: p.productImage ?? null,
    price: toMinor(current),
    listPrice: Number.isFinite(white) && white > current ? toMinor(white) : null,
    inStock: p.availability?.stockState === "Available",
    category: null,
    type: classifyType(null, String(p.productName)),
    gender: null,
    colorName: null,
    country,
    currency: currencyFor(country),
  };
}

/* ------------------------------------------------------------------- guess */

const GUESS_ALGOLIA = "https://YML5RK21LG-dsn.algolia.net/1/indexes";
// The storefront's public search-only key — the same one guess.ts uses.
const GUESS_HEADERS = {
  "X-Algolia-Application-Id": "YML5RK21LG",
  "X-Algolia-API-Key": "769a17c8b936f70b64ab0c62f3fdf12e",
  Accept: "application/json",
};

/**
 * Guess by url: an Algolia get-object on the SKU at the end of the url.
 *
 * Worth more than it looks: the search key filters to in-stock items, so the
 * collector never stores a SOLD-OUT colour — exactly the product somebody wants
 * a restock alert for. get-object is not subject to those filters.
 */
async function guessUrl(url: string): Promise<LiveProduct | null> {
  let path = "";
  try { path = new URL(url).pathname; } catch { return null; }
  const sku = path.match(/\/([A-Z0-9]{6,}-[A-Z0-9]{2,})\.html$/i)?.[1]?.toUpperCase();
  if (!sku) return null;
  const country = countryFromUrl(url) ?? DEFAULT_MARKET;
  // Guess's own storefronts: tr_TR for Turkey, English everywhere else in Europe.
  if (!["TR", "GB", "IE", "DE", "FR", "NL", "BE", "AT", "ES", "IT", "PT", "FI", "CH", "SE", "DK", "NO"].includes(country)) return null;
  const locale = country === "TR" ? "tr_TR" : `en_${country}`;
  const h = await json<any>(`${GUESS_ALGOLIA}/production__products__${locale}/${sku}`, GUESS_HEADERS, countryFor("guess", country));
  if (!h?.objectID || !h.name) return null;
  const currency = currencyFor(country);
  // A hit priced in another currency would be stored under the wrong symbol.
  if (h.currencyCode && h.currencyCode !== currency) return null;
  const price = h.master_price;
  if (typeof price !== "number" || price <= 0) return null;
  const retail = typeof h.master_price_retail === "number" ? h.master_price_retail : null;
  const g = String(h.guess_gender ?? "").toLowerCase();
  return {
    brand: "guess",
    externalId: String(h.objectID),
    name: String(h.name),
    url: h.url ? `https://www.guess.eu${h.url}` : url.split(/[?#]/)[0],
    // Same Cloudinary transform as the collector; the index carries no image.
    imageUrl: "https://img.guess.com/image/upload/f_auto,q_auto,fl_strip_profile," +
      `w_640,ar_2:3,c_fill/v1/EU/Style/ECOMM/${h.objectID}`,
    price: toMinor(price),
    listPrice: retail && retail > price ? toMinor(retail) : null,
    inStock: h.in_stock !== false,
    category: null,
    type: classifyType(null, String(h.name)),
    gender: /women|kad|kvinn/.test(g) ? "kadin" : /^men|erkek/.test(g) ? "erkek" : /junior|girl|boy/.test(g) ? "cocuk" : null,
    colorName: null,
    country,
    currency,
  };
}

/* ------------------------------------------------------ inditex (itxrest) */

interface ItxSite { domain: string; brandId: number }
/**
 * The Inditex brands whose PDP url carries the product REFERENCE (`-l0689…`)
 * and whose collector stores `l<ref>` — so a live answer lands on the same row.
 * Oysho and Bershka are left out on purpose: their collector stores per-grid
 * bundle ids that no single-product call reproduces, so a live row would be a
 * duplicate of a stored one.
 */
const ITX_SITES: Record<string, ItxSite> = {
  massimodutti: { domain: "www.massimodutti.com", brandId: 3 },
  stradivarius: { domain: "www.stradivarius.com", brandId: 5 },
  pullandbear: { domain: "www.pullandbear.com", brandId: 2 },
};

interface ItxMarket { storeId: number; catalogId: number; languageId: number; urlPrefix: string }
const itxMarkets = new Map<string, { at: number; m: ItxMarket | null }>();
const ITX_HEADERS = (domain: string) => ({
  Accept: "application/json",
  "User-Agent": UA,
  Origin: `https://${domain}`,
  Referer: `https://${domain}/`,
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Dest": "empty",
});

/**
 * Store, catalog and language for one brand in one market, read from the
 * store list — catalog ids carry season names and rotate, so they are never
 * pasted. Same selection rules as the collector's `marketFromStoreList`; a
 * market with no store of its own (a worldwide "WW" store) is refused rather
 * than priced in another currency.
 */
async function itxMarket(site: ItxSite, country: CountryCode): Promise<ItxMarket | null> {
  const key = `${site.domain}:${country}`;
  const hit = itxMarkets.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.m;
  const list = await json<any>(
    `https://${site.domain}/itxrest/2/catalog/store?languageId=-1&appId=1&brandId=${site.brandId}`,
    ITX_HEADERS(site.domain),
    countryFor(undefined, country),
  );
  if (!list) return null; // not cached: a refusal is worth retrying next time
  const stores: any[] = (list.stores ?? []).filter((s: any) => s?.countryCode === country);
  const store = stores.find((s) => s.isOpenForSale !== false && (s.type ?? 1) === 1) ?? stores[0];
  let m: ItxMarket | null = null;
  const catalog = store?.catalogs?.find((c: any) => c.type === 1);
  const langs: any[] = store?.supportedLanguages ?? [];
  const lang = country === "TR"
    ? langs.find((l) => l.id === store?.storeDefaultLanguageId)
    : langs.find((l) => l.code === "en") ?? langs.find((l) => l.id === store?.storeDefaultLanguageId);
  if (store && store.isOpenForSale !== false && catalog && lang) {
    const dropLang = lang.id === store.storeDefaultLanguageId && store.iDesktopUrlRemoveDefaultLanguage !== false;
    m = {
      storeId: store.id,
      catalogId: catalog.id,
      languageId: lang.id,
      urlPrefix: `https://${site.domain}/${country.toLowerCase()}${dropLang ? "" : `/${lang.code}`}`,
    };
  }
  itxMarkets.set(key, { at: Date.now(), m });
  return m;
}

async function inditexUrl(brand: string, url: string): Promise<LiveProduct | null> {
  const site = ITX_SITES[brand];
  if (!site) return null;
  const ref = url.match(/-l(\d{6,})(?:[/?#]|$)/i)?.[1];
  if (!ref) return null;
  const country = countryFromUrl(url) ?? DEFAULT_MARKET;
  const m = await itxMarket(site, country);
  if (!m) return null;
  const p = await json<any>(
    `https://${site.domain}/itxrest/2/catalog/store/${m.storeId}/${m.catalogId}/product/${ref}?languageId=${m.languageId}&appId=1`,
    ITX_HEADERS(site.domain),
    countryFor(brand, country),
  );
  if (!p?.id) return null;
  const real = p.bundleProductSummaries?.[0] ?? p;
  const slug: string | undefined = p.productUrl ?? real.productUrl;
  // The endpoint answers NEAR matches: asking 01477778 returned l01477777.
  // Only the product whose own url carries the asked reference is this one.
  if (!slug || !new RegExp(`-l${ref}(?:[?#/]|$)`, "i").test(slug)) return null;
  const color = real.detail?.colors?.[0];
  let price = Infinity;
  let listPrice: number | null = null;
  for (const sz of color?.sizes ?? []) {
    const v = Number(sz?.price); // already minor units
    if (!Number.isFinite(v) || v <= 0 || v >= price) continue;
    price = v;
    const o = sz?.oldPrice == null ? NaN : Number(sz.oldPrice);
    listPrice = Number.isFinite(o) && o > v ? o : null;
  }
  const name = real.name ?? p.name;
  if (!Number.isFinite(price) || !name) return null;
  const sizes: any[] = color?.sizes ?? [];
  const inStock = sizes.length === 0 || sizes.some((sz) => {
    const vis = String(sz?.visibilityValue ?? "").toUpperCase();
    return vis ? vis === "SHOW" || /RUNNING|LOW|FEW/.test(vis) : sz?.isBuyable !== false;
  });
  let image: string | null = null;
  for (const x of real.detail?.xmedia ?? []) for (const it of x?.xmediaItems ?? []) for (const md of it?.medias ?? []) {
    const u = md?.url ?? md?.extraInfo?.deliveryUrl;
    if (!image && typeof u === "string" && u.startsWith("http")) image = u;
  }
  return {
    brand,
    externalId: `l${ref}`,
    name: String(name),
    url: `${m.urlPrefix}/${encodeURI(slug)}`,
    imageUrl: image,
    price,
    listPrice,
    inStock,
    category: null,
    type: classifyType(null, String(name)),
    gender: null,
    colorName: color?.name ?? null,
    country,
    currency: currencyFor(country),
  };
}

/* -------------------------------------------------------------------- zara */

/**
 * Zara by url: the PDP answers its own data as JSON with `ajax=true`.
 *
 * Redirects are walked by hand because Zara uses a private 278 status with a
 * JSON `{location}` for slug-less and `/share/` urls. The stored id is the
 * colour's `productId`, which is what `v1` carries; without `v1` the first
 * colour is taken, as the site itself does. Zara Home items resolve too — they
 * are sold on zara.com and tracked under zara.
 */
async function zaraUrl(url: string): Promise<LiveProduct | null> {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  u.hostname = "www.zara.com";
  // `zara.com/share/…` names no market and lands on an empty Spanish shell.
  if (!/^\/[a-z]{2}\/[a-z]{2}\//i.test(u.pathname)) u.pathname = `/tr/tr${u.pathname}`;
  const country = countryFromUrl(u.toString()) ?? DEFAULT_MARKET;
  let current = u.toString();
  for (let hop = 0; hop < 4; hop++) {
    const q = new URL(current);
    q.searchParams.set("ajax", "true");
    let r: Response;
    try {
      r = await fetch(q.toString(), {
        redirect: "manual",
        headers: { Accept: "application/json", "User-Agent": UA },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
        // @ts-expect-error undici's dispatcher is accepted by Node's fetch
        dispatcher: dispatcher(countryFor("zara", country)),
      });
    } catch (err) {
      console.warn(`live-lookup: www.zara.com unreachable — ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
    const loc = r.status === 278
      ? (await r.json().catch(() => null))?.location
      : r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
    if (loc) {
      const next = new URL(loc, q);
      next.searchParams.delete("ajax");
      current = next.toString();
      continue;
    }
    if (!r.ok) {
      console.warn(`live-lookup: www.zara.com refused with HTTP ${r.status}`);
      return null;
    }
    const d = await r.json().catch(() => null);
    const p = d?.product;
    const colors: any[] = p?.detail?.colors ?? [];
    const v1 = new URL(current).searchParams.get("v1");
    const c = colors.find((x) => String(x?.productId) === v1) ?? colors[0];
    const price = Number(c?.price);
    if (!p?.name || !c?.productId || !Number.isFinite(price) || price <= 0) return null;
    // The page's own currency, checked against the market the url named.
    const cur = d?.analyticsData?.page?.currency;
    if (cur && cur !== currencyFor(country)) return null;
    const old = Number(c.oldPrice);
    const market = new URL(current).pathname.split("/").slice(1, 3).join("/");
    const img = c.xmedia?.[0]?.url ?? p.detail?.xmedia?.[0]?.url;
    const name = String(p.name);
    return {
      brand: "zara",
      externalId: String(c.productId),
      name,
      url: p.seo?.keyword && p.seo?.seoProductId
        ? `https://www.zara.com/${market}/${p.seo.keyword}-p${p.seo.seoProductId}.html?v1=${c.productId}`
        : current,
      imageUrl: typeof img === "string" ? img.replace("{width}", "750") : null,
      price, // already minor units
      listPrice: Number.isFinite(old) && old > price ? old : null,
      inStock: (c.sizes ?? []).some((s: any) => /^(in_stock|low_on_stock)$/.test(String(s?.availability))),
      category: null,
      type: classifyType(null, name),
      gender: null,
      colorName: c.name ?? null,
      country,
      currency: currencyFor(country),
    };
  }
  return null;
}

const RESOLVERS: Record<string, (url: string) => Promise<LiveProduct | null>> = {
  mango,
  beymen: beymenUrl,
  boyner: boynerUrl,
  koton: kotonUrl,
  gratis: gratisUrl,
  rossmann: rossmannUrl,
  hm: hmUrl,
  guess: guessUrl,
  zara: zaraUrl,
  massimodutti: (url) => inditexUrl("massimodutti", url),
  stradivarius: (url) => inditexUrl("stradivarius", url),
  pullandbear: (url) => inditexUrl("pullandbear", url),
};

/** Brand slug from a pasted url's hostname, or undefined if it is not ours. */
export function brandFromUrl(raw: string): string | undefined {
  let host = "";
  try { host = new URL(raw).hostname.toLowerCase(); } catch { return undefined; }
  // Longest slug first: "massimodutti" must win over any shorter substring.
  return [...BRANDS].sort((a, b) => b.slug.length - a.slug.length)
    .find((b) => host.includes(b.slug))?.slug;
}

/* ------------------------------------------------------------- share links */

/**
 * Hosts that exist only to redirect: link shorteners and the deep-link
 * services shop apps put behind their Share button. A url on one of these is
 * not a product page, so it matched nothing and `brandFromUrl` either found no
 * brand or (for `beymen.app.link`) a brand with no id to read.
 *
 * An allow-list on purpose. Following redirects for ANY pasted host would make
 * this endpoint an open fetcher — anyone could point it at anything.
 */
const SHARE_HOSTS = /(?:^|\.)(?:app\.link|onelink\.me|page\.link|adj\.st|go\.link|boyner\.link|bit\.ly|tinyurl\.com|t\.co|ty\.gl|rebrand\.ly|cutt\.ly|shorturl\.at|is\.gd|app\.adjust\.com)$/i;

export function isShareLink(raw: string): boolean {
  try {
    const u = new URL(raw);
    return /^https?:$/.test(u.protocol) && SHARE_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

/** The product url a share page points at, when it says so in its markup. */
export function productUrlFromSharePage(html: string): string | null {
  const pick = [
    /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/i,
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
    /["']\$(?:canonical|desktop|fallback)_url["']\s*:\s*["']([^"']+)["']/i,
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/i,
    /window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
  ];
  for (const re of pick) {
    const m = html.match(re);
    const v = m?.[1].replace(/\\\//g, "/").replace(/&amp;/g, "&");
    if (v && /^https?:\/\//i.test(v) && brandFromUrl(v)) return v;
  }
  return null;
}

/**
 * Turn an app share link into the product url it stands for; anything else is
 * returned untouched, without a request.
 *
 * Redirects are followed by hand (max 5 hops) and the walk stops as soon as it
 * lands on a brand's own host, so the shop's product page itself is never
 * fetched here. A deep-link service that answers with an HTML interstitial
 * instead of a redirect usually names the destination in `og:url` or a
 * `$canonical_url`, which is read as a last resort. Any failure returns the
 * original url — resolving it then fails the ordinary way, as "not found".
 */
export async function expandShareLink(raw: string): Promise<string> {
  if (!isShareLink(raw)) return raw;
  let current = raw;
  for (let hop = 0; hop < 5; hop++) {
    let r: Response;
    try {
      r = await fetch(current, {
        redirect: "manual",
        headers: { "User-Agent": UA, Accept: "text/html,*/*" },
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
    } catch {
      return raw;
    }
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) {
      let next: string;
      try { next = new URL(loc, current).toString(); } catch { return raw; }
      if (!/^https?:/i.test(next)) return raw; // an app scheme: nothing to follow
      if (!isShareLink(next)) return brandFromUrl(next) ? next : raw;
      current = next;
      continue;
    }
    if (r.ok) {
      const html = await r.text().catch(() => "");
      return productUrlFromSharePage(html) ?? raw;
    }
    return raw;
  }
  return raw;
}

/**
 * Brands with a resolver that must NOT own their tracked products' stock.
 *
 * `canResolveLive` does two jobs in the collector: it spares a tracked product
 * the sweep's "missing means sold out" rule, and hands it to the reprice pass
 * instead. That is only safe when the resolver can itself SEE a sold-out
 * product. H&M's cannot — a sold-out article drops out of the search it reads —
 * so a protected H&M row would sit "in stock" forever. Its sweep keeps that job.
 */
const SWEEP_OWNS_STOCK = new Set(["hm"]);

/** True when `lookupLive` has anything to ask for this brand. */
export function hasLiveLookup(brand: string | undefined): boolean {
  return !!brand && brand in RESOLVERS;
}

export function canResolveLive(brand: string | undefined): boolean {
  return hasLiveLookup(brand) && !SWEEP_OWNS_STOCK.has(brand!);
}

/**
 * Every brand a single product can be re-checked for one url at a time.
 *
 * The collector needs this as a list rather than a predicate: for these brands
 * a tracked product does not depend on turning up in the sweep, which changes
 * both what gets re-priced and what may be delisted.
 */
export function liveBrands(): string[] {
  return Object.keys(RESOLVERS).filter((b) => !SWEEP_OWNS_STOCK.has(b));
}

export async function lookupLive(brand: string | undefined, url: string): Promise<LiveProduct | null> {
  if (!brand) return null;
  const fn = RESOLVERS[brand];
  if (!fn) return null;
  try {
    return await fn(url);
  } catch {
    return null;
  }
}

export { barcodeFromScanUrl } from "./scan-url";
