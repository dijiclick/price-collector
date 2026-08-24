import { ProxyAgent, type Dispatcher } from "undici";
import { BRANDS } from "./brands";
import { classifyType } from "./productTypes";

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
export const countryFor = (brand: string | undefined): string =>
  (brand && BRAND_COUNTRY[brand]) || DEFAULT_COUNTRY;

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
async function rossmannByBarcode(barcode: string): Promise<LiveProduct | null> {
  const FIELDS = `sku barcode name url_key stock_status small_image { url }
    crm_price special_price ross_60_price cmp_100_price cmp_50_price cmp_20_price
    price_range { minimum_price { regular_price { value } final_price { value } } }`;
  const query = `{ products(filter: { barcode: { match: ${JSON.stringify(barcode)} } }, pageSize: 5) {
      items { ${FIELDS} } } }`;

  const res = await postJson<any>(ROSSMANN_GQL, { query }, countryFor("rossmann"));
  const items: any[] = res?.data?.products?.items ?? [];
  // `match` is a LIKE, so a short code could bring back neighbours. Only the row
  // whose own barcode equals what was scanned is the product in the user's hand.
  const p = items.find((x) => String(x?.barcode ?? "").replace(/\D/g, "") === barcode) ?? null;
  if (!p || !p.sku || !p.url_key) return null;

  const min = p.price_range?.minimum_price ?? {};
  const regular: number | undefined = min.regular_price?.value;
  const final: number | undefined = min.final_price?.value ?? regular;
  if (typeof final !== "number" || final <= 0) return null;
  // Campaign columns undercut `final` when a promotion is running; the lowest
  // positive one is what the shelf actually charges.
  const campaign = [p.crm_price, p.special_price, p.ross_60_price, p.cmp_100_price, p.cmp_50_price, p.cmp_20_price]
    .map(Number).filter((n) => Number.isFinite(n) && n > 0 && n < final)
    .sort((a, b) => a - b)[0];
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
  const m = path.match(/\/p\/([^/]+)\/.*?\/(\d{6,9})(?:\/(\d{2,3}))?/);
  if (!m) return null;
  const section = m[1];
  const gender =
    section === "kadin" ? "kadin"
    : section === "erkek" ? "erkek"
    : /cocuk|kids|teen/.test(section) ? "cocuk"
    : null;
  return { id: m[2], colorId: m[3] ?? "", gender };
}

async function mango(url: string): Promise<LiveProduct | null> {
  const parsed = parseMangoUrl(url);
  if (!parsed) return null;
  const [prices, detail] = await Promise.all([
    json<Record<string, { price?: number; crossedOutPrice?: number; type?: string }>>(
      `${MANGO_ORCH}/v3/prices/products?channelId=shop&countryIso=TR&productId=${parsed.id}`,
      MANGO_HEADERS,
      countryFor("mango"),
    ),
    json<any>(
      `${MANGO_ORCH}/v4/products?channelId=shop&countryIso=TR&languageIso=tr&productId=${parsed.id}`,
      MANGO_HEADERS,
      countryFor("mango"),
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
  const res = await json<any>(
    `https://www.beymen.com/mobile2/api/mbProduct/v2/product?productId=${id}`,
    { Accept: "application/json", "User-Agent": "okhttp/4.12.0" },
    countryFor("beymen"),
  );
  // A miss is 200 with Success:false, exactly as on the barcode endpoint.
  if (!res?.Success) return null;
  const r = res.Result;
  const price = Number(r?.PromotedOrActualPrice ?? r?.ActualPrice);
  if (!r?.ProductId || !r.DisplayName || !Number.isFinite(price) || price <= 0) return null;
  const struck = Number(r.StrikeThroughPrice);
  const list = r.IsStrikeThroughPriceExist && Number.isFinite(struck) && struck > price ? struck : null;
  return {
    brand: "beymen",
    externalId: String(r.ProductId),
    name: String(r.DisplayName),
    url: String(r.ShareUrl ?? url),
    imageUrl: r.FirstProductImageURL ?? null,
    price: toMinor(price),
    listPrice: list == null ? null : toMinor(list),
    inStock: r.IsOutOfStock !== true,
    // The collector puts the designer label in `category` for beymen.
    category: r.BrandName ?? null,
    type: null,
    gender: r.Pgen === "K" ? "kadin" : r.Pgen === "E" ? "erkek" : null,
    colorName: null,
  };
}

const RESOLVERS: Record<string, (url: string) => Promise<LiveProduct | null>> = {
  mango,
  beymen: beymenUrl,
};

/** Brand slug from a pasted url's hostname, or undefined if it is not ours. */
export function brandFromUrl(raw: string): string | undefined {
  let host = "";
  try { host = new URL(raw).hostname.toLowerCase(); } catch { return undefined; }
  // Longest slug first: "massimodutti" must win over any shorter substring.
  return [...BRANDS].sort((a, b) => b.slug.length - a.slug.length)
    .find((b) => host.includes(b.slug))?.slug;
}

export function canResolveLive(brand: string | undefined): boolean {
  return !!brand && brand in RESOLVERS;
}

/**
 * Every brand a single product can be re-checked for one url at a time.
 *
 * The collector needs this as a list rather than a predicate: for these brands
 * a tracked product does not depend on turning up in the sweep, which changes
 * both what gets re-priced and what may be delisted.
 */
export function liveBrands(): string[] {
  return Object.keys(RESOLVERS);
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
