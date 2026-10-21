/**
 * Zalando Switzerland, Norway and (2026-10-21) twelve EU shops — women's sale, through the GraphQL endpoint the
 * Zalando ANDROID APP calls (added 2026-10-11).
 *
 * www.zalando.<tld> is Akamai: every HTML page, sitemap and the web
 * `/api/catalog` + `/api/graphql` answer a GitHub runner with a timeout or an
 * `edge_error: halt` 403. The app's own path, `POST /api/graphql/mobile` on the
 * same host, is let through when the request carries the app's headers and its
 * request signature — measured from a runner (probe run 38134871636, 200 OK,
 * both markets). No proxy, no cookie, no login.
 *
 * What the app sends (from the 26.19.0 APK, `ed1.a` / `data.rest.okhttp.e`):
 *   x-ts   = epoch millis
 *   x-sig  = sha1_hex(urlPath + APP_SALT + x-ts)        (path without query)
 *   x-app-domain = the shop (CH 20, NO 32 — from `/api/mobile/v3/config/shops`)
 *   X-Zalando-Mobile-App, a `Zalando/<ver> (Linux; Android …)` User-Agent
 *   x-zalando-feature: catalog   (without it every catalog query is "invalid")
 * Queries are persisted: the body is `[{id: <operation sha256>, variables}]`,
 * raw GraphQL is refused. `AppCatalog` is the app's category grid.
 *
 * The women's category (`ern:collection:cat:categ:damen` / `dame`) with the
 * `sales` toggle and order `SALE` is the app's women's sale, highest
 * reductions first (CH ~246k items, NO ~137k — far beyond the cap, so this takes
 * the top). Each card carries current and original price in minor units and the
 * market's currency. A card whose price is a range across sizes ("ab CHF 100",
 * "fra 319 kr", "bis zu 60%") has no single was-price — the TR −%81 variant-range
 * trap — so those are dropped.
 *
 * Sizes: the card lists every size of the article INCLUDING sold-out ones (checked
 * against the app's PDP query), with no stock flag, so no per-size availability
 * is stored; that would cost one PDP call per product.
 *
 * Multi-brand: the card's own brand (Mango, Puma, Dune London…) goes into the
 * name; `category` is Zalando's product-type segment of the name.
 */
import { createHash } from "node:crypto";
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "zalando";

const APP_VERSION = "26.19.0";
const APP_UA = `Zalando/${APP_VERSION} (Linux; Android 14; Google Pixel 7/UQ1A.240205.004)`;
const APP_ID = "1166c0792788b3f3a"; // X-Zalando-Mobile-App, constant in the APK
const APP_SALT = "9bde64a09e825d35a4128c813a05b5eff24b6ab6"; // x-sig salt, constant in the APK
const PATH = "/api/graphql/mobile";
/** Persisted `AppCatalog` operation (AppCatalogQuery.OPERATION_ID in the APK). */
const APP_CATALOG = "4fff04773d07da1892419b81016f5f658df2c2e84d596d1b4e6692c0994dbf50";

export const ZALANDO_MARKETS: Partial<Record<CountryCode, { host: string; appDomain: number; lang: string; women: string }>> = {
  CH: { host: "www.zalando.ch", appDomain: 20, lang: "de", women: "damen" },
  NO: { host: "www.zalando.no", appDomain: 32, lang: "no", women: "dame" },
  // EU (2026-10-21): shop ids from the app's `/api/mobile/v3/config/shops`.
  DE: { host: "www.zalando.de", appDomain: 1, lang: "de", women: "damen" },
  AT: { host: "www.zalando.at", appDomain: 19, lang: "de", women: "damen" },
  NL: { host: "www.zalando.nl", appDomain: 5, lang: "nl", women: "dames" },
  BE: { host: "www.zalando.be", appDomain: 25, lang: "nl", women: "dames" },
  FR: { host: "www.zalando.fr", appDomain: 11, lang: "fr", women: "femme" },
  IT: { host: "www.zalando.it", appDomain: 15, lang: "it", women: "donna" },
  ES: { host: "www.zalando.es", appDomain: 30, lang: "es", women: "mujer" },
  PT: { host: "www.zalando.pt", appDomain: 50, lang: "pt", women: "mulher-roupa" },
  IE: { host: "www.zalando.ie", appDomain: 48, lang: "en", women: "women" },
  SE: { host: "www.zalando.se", appDomain: 27, lang: "sv", women: "kvinna" },
  DK: { host: "www.zalando.dk", appDomain: 29, lang: "da", women: "damer" },
  FI: { host: "www.zalando.fi", appDomain: 28, lang: "fi", women: "naiset" },
};

const PAGE = 50; // the server rejects larger pages ("first is greater than the max allowed value")
const MAX_PAGES = Number(process.env.ZALANDO_MAX_PAGES ?? 40);
const PAUSE_MS = Number(process.env.ZALANDO_PAUSE_MS ?? 800);
const CAP = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function signature(path: string, ts: number): string {
  return createHash("sha1").update(`${path}${APP_SALT}${ts}`).digest("hex");
}

export function appHeaders(country: CountryCode, ts = Date.now()): Record<string, string> {
  const m = ZALANDO_MARKETS[country]!;
  return {
    "User-Agent": APP_UA,
    "x-app-domain": String(m.appDomain),
    "x-ts": String(ts),
    "x-sig": signature(PATH, ts),
    "x-device-language": m.lang,
    "x-os-version": "14",
    "Accept-Language": "*",
    Accept: "application/json",
    "X-Zalando-Mobile-App": APP_ID,
    "X-Logged-In": "false",
    "x-app-version": APP_VERSION,
    "x-device-platform": "android",
    "x-device-os": "android",
    "x-zalando-feature": "catalog",
    "content-type": "application/json",
  };
}

/** Variables for the persisted AppCatalog query; everything optional switched off. */
export function catalogVariables(country: CountryCode, after: string | null): Record<string, unknown> {
  const m = ZALANDO_MARKETS[country]!;
  return {
    id: `ern:collection:cat:categ:${m.women}`,
    first: PAGE,
    order: "SALE",
    afterCursor: after,
    filters: { toggleFilters: [{ key: "sales" }] },
    productCardImageWidth: 1000,
    categoryImageWidth: 100,
    includeIfFirstPage: false,
    includeIfFirstPageAndNotSearch: false,
    shouldIncludeOmnibusPrice: true,
    shouldIncludeThemeExperience: false,
    shouldIncludeExperience: false,
    experienceLogoWidth: 10,
    shouldIncludeExperienceWatermark: false,
    experienceWatermarkImageWidth: 10,
    isRecoCatalog: false,
    shouldIncludeFullExperience: false,
    shouldIncludeExperienceBrandedBanner: false,
    experienceBrandedBannerLogoWidth: 10,
    benefitsLogoWidth: 10,
    isDPSHighlightModuleEnabled: false,
    isDPSHighlightBackgroundColorEnabled: false,
    upperLimitHighlightItems: 0,
    shouldIncludeDSAAdvertisingFields: false,
    shouldIncludeOmnibusProductCardPriceChanges: false,
    shouldIncludeOutfits: false,
    outfitImageWidth: 10,
    outfitCuratorImageWidth: 10,
    shouldIncludeGA4TrackingFields: false,
    shouldIncludeCategoryDomain: false,
    shouldIncludeSportsDialogPoll: false,
    productCardDisplayPriceModule: "CATALOG",
    zdsTextVersion: 1,
    shouldIncludeZAAssistHeaderModule: false,
    shouldIncludeProductRating: false,
    shouldIncludeEnergyLabel: false,
    shouldIncludeRedirect: false,
    shouldIncludeImageGallery: true,
    redirectSubSli: "catalog",
  };
}

const slug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[æÆ]/g, "ae")
    .replace(/[øØ]/g, "o")
    .replace(/[åÅ]/g, "a")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Zalando names are "<model> - <type> - <colour>" (model is sometimes absent).
 * Returns the type and colour segments.
 */
export function splitName(name: string): { type: string | null; colour: string | null } {
  const parts = name.split(" - ").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return { type: null, colour: null };
  return { type: parts[parts.length - 2] || null, colour: parts[parts.length - 1] || null };
}

function genderOf(target: unknown): ProductRecord["gender"] {
  if (target === "WOMEN") return "kadin";
  if (target === "MEN") return "erkek";
  if (target === "KIDS") return "cocuk";
  return null; // ALL = unisex
}

/** One AppCatalog `Product` node → a record, or null when it is not a clean single-price reduction. */
export function mapNode(country: CountryCode, n: any): ProductRecord | null {
  if (n?.__typename !== "Product" || !n.sku || !n.name) return null;
  const m = ZALANDO_MARKETS[country]!;
  const tp = n.trackingContext_display_price ?? {};
  const price = Number(tp.current?.amount);
  const was = Number(tp.original?.amount);
  if (!Number.isInteger(price) || price <= 0 || !Number.isInteger(was) || was <= price) return null;
  const dp = n.displayPrice ?? {};
  // A price range across sizes: "ab"/"fra" before the price, "bis zu"/"opptil" before the %.
  if (dp.promotional?.lowerBoundLabel || dp.original?.lowerBoundLabel || dp.current?.lowerBoundLabel) return null;
  // "up to -N%" in every shop language (de, no, en, fr, it, nl, es, sv, da, fi, pt).
  if (/bis zu|opptil|up to|jusqu|fino a|\btot\b|hasta|upp till|op til|jopa|até/i.test(String(dp.original?.discountLabel ?? ""))) return null;
  const brandName = String(n.brand?.name ?? "").trim();
  const name = String(n.name).replace(/\s+/g, " ").trim();
  const { type, colour } = splitName(name);
  const first: string | null = n.catalogDefaultImage?.uri ?? n.primaryImage?.uri ?? null;
  const photos: string[] = (n.gallery ?? []).map((g: any) => g?.media?.uri).filter((u: unknown): u is string => typeof u === "string");
  const sku = String(n.sku);
  const model = sku.split("-")[0];
  return {
    brand: "zalando",
    country,
    externalId: sku,
    name: brandName && !name.toLowerCase().startsWith(brandName.toLowerCase()) ? `${brandName} ${name}` : name,
    // The slug is NOT cosmetic: a named model ("AURORA") missing from it 404s
    // (2026-10-21, NL/FR/Nordics). Brand + full name, as Zalando's own URLs are.
    url: `https://${m.host}/${slug(`${brandName} ${name}`)}-${sku.toLowerCase()}.html`,
    imageUrl: first,
    images: cleanGallery(photos, first),
    price,
    listPrice: was,
    currency: COUNTRIES[country].currency,
    inStock: true,
    category: type,
    gender: genderOf(n.navigationTargetGroup),
    variants: null,
    groupKey: model ? `zalando:${model}` : null,
    colorName: colour,
  };
}

export async function listZalando(country: CountryCode): Promise<ProductRecord[]> {
  const m = ZALANDO_MARKETS[country];
  if (!m) return [];
  const byId = new Map<string, ProductRecord>();
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES && byId.size < CAP; page++) {
    if (page > 0) await sleep(PAUSE_MS);
    const body: string = JSON.stringify([{ id: APP_CATALOG, variables: catalogVariables(country, after) }]);
    const data: any = await getJson<any>(`https://${m.host}${PATH}`, {
      method: "POST",
      body,
      headers: appHeaders(country),
      country,
      retries: 1,
    }).catch((e) => {
      if (page === 0) throw new Error(`zalando/${country}: catalog refused (${e?.message ?? e})`);
      return null;
    });
    const ents: any = (Array.isArray(data) ? data[0] : data)?.data?.collection?.entities;
    const edges: any[] = ents?.edges ?? [];
    if (!edges.length) {
      if (page === 0) throw new Error(`zalando/${country}: empty catalog answer`);
      break;
    }
    for (const e of edges) {
      const r = mapNode(country, e?.node);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    after = ents?.pageInfo?.endCursor ?? null;
    if (!after) break;
  }
  return [...byId.values()].slice(0, CAP);
}

export async function listProducts(country: CountryCode): Promise<ProductRecord[]> {
  return listZalando(country);
}
