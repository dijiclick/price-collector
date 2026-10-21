/**
 * Deichmann-group storefronts in Switzerland: Dosenbach, Ochsner Shoes,
 * Ochsner Sport and SNIPES (2026-10-11). All four are the same Angular storefront over a
 * BFF called "charybdis" (SCAYLE behind it). Its category endpoint returns a
 * whole listing page as JSON with per-size stock, EANs and CHF prices in
 * centimes — no cookie, no key, no proxy.
 *
 * The only thing the BFF wants is an `X-Charybdis` header: base64 of a small
 * JSON naming the concept, SCAYLE shop and CMS space. Those values are public —
 * they sit in every page's server-rendered `ng-state` CONFIG. They are pinned
 * here; if the BFF ever refuses them (400 validation error), the adapter
 * re-reads them from the shop's own home page once and retries.
 *
 * Collected: the shop's sale/outlet category, discounted rows only (Ochsner
 * Sport's outlet also lists permanently-low "outlet price" items with no
 * strikeout — those are dropped), in-stock first, capped.
 */
import { gunzipSync } from "node:zlib";
import { cleanGallery, type ProductRecord } from "../types";
import { getJson, getText } from "../http";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export type DeichmannSlug = "dosenbach" | "ochsner-shoes" | "ochsnersport" | "snipes" | "deichmann";

interface Charybdis {
  concept: string;
  scayleEnvironment: string;
  scayleShopId: string;
  cmsSpace: string;
  cmsEnvironment: string;
  cmsAccessToken: string;
  tree: string;
  context: string;
}

export interface DeichmannShop {
  slug: DeichmannSlug;
  /** Storefront root including the locale path, no trailing slash. */
  site: string;
  /** BFF base, ending in /v1/v1. */
  api: string;
  /** Cloudinary-style image host. */
  assets: string;
  /** Sale / outlet category id. */
  saleCategory: number;
  /** `lang` query param the storefront sends. */
  lang: string;
  /** Page size the BFF accepts (SNIPES answers 404 above 48). */
  perPage: number;
  token: Charybdis;
}

const DEICH_API = "https://api.deichmann.com/dse-pl-prd-stor-we-char/v1/v1";
const SNIPES_API = "https://api.snipes.com/sni-pl-prd-stor-we-char/v1/v1";

/**
 * EU shops, 2026-10-21 (values from each shop's own ng-state CONFIG). Every
 * Deichmann country is the DSE concept on deichmann.com/<locale>, sale
 * category 477 everywhere ("Sale", "Promotion", "Rea", "Tilbud" …); every SNIPES
 * country is snipes.com/<locale>, sale category 660. Prices in cents of the
 * shop's currency (SEK/DKK for Deichmann SE/DK). Verified from a GitHub runner
 * (probe 39615284904: all sixteen 200 with products). Deichmann NL/BE answer
 * 503 for the storefront itself today, so they are not listed; SNIPES has no
 * IE/SE/DK/FI shop (404).
 */
const DSE_TOKEN = { concept: "DSE", scayleEnvironment: "dmg-live", cmsSpace: "httlbzrqc9c6", cmsEnvironment: "master", cmsAccessToken: "QZ0q_7hcOA_hTCT7JfdvxOfdFeHNhW7K9ul_qwLol30" };
const SNI_TOKEN = { concept: "SNI", scayleEnvironment: "snipes-live", cmsSpace: "kjf22wf4wsoh", cmsEnvironment: "master", cmsAccessToken: "ysP4LsVG53AZ5Zm5ZOnoacsBNSJ6G8boSoowpNrDqmM" };

const deichmannEu = (context: string, shopId: string, tree: string): DeichmannShop => ({
  slug: "deichmann",
  site: `https://www.deichmann.com/${context}`,
  api: DEICH_API,
  assets: "https://asset.deichmann.com",
  saleCategory: 477,
  lang: context,
  perPage: 100,
  token: { ...DSE_TOKEN, scayleShopId: shopId, tree, context },
});

const snipesEu = (context: string, shopId: string, tree: string): DeichmannShop => ({
  slug: "snipes",
  site: `https://www.snipes.com/${context}`,
  api: SNIPES_API,
  assets: "https://asset.snipes.com",
  saleCategory: 660,
  lang: context,
  perPage: 48,
  token: { ...SNI_TOKEN, scayleShopId: shopId, tree, context },
});

/** Values read from each shop's ng-state CONFIG on 2026-10-11. */
export const DEICHMANN_SHOPS: Record<DeichmannSlug, Partial<Record<CountryCode, DeichmannShop>>> = {
  dosenbach: {
    CH: {
      slug: "dosenbach",
      site: "https://www.dosenbach.ch/de-ch",
      api: DEICH_API,
      assets: "https://asset.deichmann.com",
      saleCategory: 477,
      lang: "de-ch-2",
      perPage: 100,
      token: {
        concept: "DOS", scayleEnvironment: "dmg-live", scayleShopId: "10082", cmsSpace: "httlbzrqc9c6",
        cmsEnvironment: "master", cmsAccessToken: "QZ0q_7hcOA_hTCT7JfdvxOfdFeHNhW7K9ul_qwLol30", tree: "88", context: "de-ch",
      },
    },
  },
  "ochsner-shoes": {
    CH: {
      slug: "ochsner-shoes",
      site: "https://www.ochsner-shoes.ch/de-ch",
      api: DEICH_API,
      assets: "https://asset.deichmann.com",
      saleCategory: 477,
      lang: "de-ch",
      perPage: 100,
      token: {
        concept: "OCH", scayleEnvironment: "dmg-live", scayleShopId: "10074", cmsSpace: "jaor7kkog8n7",
        cmsEnvironment: "master", cmsAccessToken: "KTwqNpPILQPdURGLuKH1BOHbWiFKVKO0fluopJT6fIc", tree: "99", context: "de-ch",
      },
    },
  },
  ochsnersport: {
    CH: {
      slug: "ochsnersport",
      site: "https://www.ochsnersport.ch/de-ch",
      api: "https://api.ochsnersport.ch/osp-pl-prd-stor-we-char/v1/v1",
      assets: "https://asset.ochsnersport.ch",
      saleCategory: 4175, // "OUTLET" (alle/aktionen/outlet)
      lang: "de-ch",
      perPage: 100,
      token: {
        concept: "OSP", scayleEnvironment: "osp-live", scayleShopId: "20001", cmsSpace: "esg2spwbpa7v",
        cmsEnvironment: "master", cmsAccessToken: "zEhgnam5rEK5ZCTAvFQIJ-MfhIqItEZW1dwgVrisU_U", tree: "1", context: "de-ch",
      },
    },
  },
  snipes: {
    CH: {
      slug: "snipes",
      site: "https://www.snipes.com/de-ch",
      api: "https://api.snipes.com/sni-pl-prd-stor-we-char/v1/v1",
      assets: "https://asset.snipes.com",
      saleCategory: 660, // "Sale" root (schuhe + bekleidung + accessoires)
      lang: "de-ch",
      perPage: 48,
      token: {
        concept: "SNI", scayleEnvironment: "snipes-live", scayleShopId: "1057", cmsSpace: "kjf22wf4wsoh",
        cmsEnvironment: "master", cmsAccessToken: "ysP4LsVG53AZ5Zm5ZOnoacsBNSJ6G8boSoowpNrDqmM", tree: "17", context: "de-ch",
      },
    },
    DE: snipesEu("de-de", "1048", "16"),
    FR: snipesEu("fr-fr", "1042", "12"),
    NL: snipesEu("nl-nl", "1054", "6"),
    BE: snipesEu("nl-be", "1062", "19"),
    AT: snipesEu("de-at", "1051", "5"),
    IT: snipesEu("it-it", "1039", "10"),
    ES: snipesEu("es-es", "1036", "11"),
    PT: snipesEu("pt-pt", "1033", "9"),
  },
  deichmann: {
    DE: deichmannEu("de-de", "10089", "52"),
    FR: deichmannEu("fr-fr", "10008", "39"),
    AT: deichmannEu("de-at", "10032", "19"),
    IT: deichmannEu("it-it", "10007", "47"),
    ES: deichmannEu("es-es", "10005", "38"),
    PT: deichmannEu("pt-pt", "10006", "46"),
    SE: deichmannEu("sv-se", "10015", "43"),
    DK: deichmannEu("da-dk", "10009", "42"),
  },
};

const MAX_PAGES = Number(process.env.DEICHMANN_MAX_PAGES ?? 40);
const PAUSE_MS = Number(process.env.DEICHMANN_PAUSE_MS ?? 800);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const one = (a: any): any => (Array.isArray(a?.values) ? a.values[0] : a?.values);
const many = (a: any): any[] => (Array.isArray(a?.values) ? a.values : a?.values ? [a.values] : []);

/**
 * Gender from `genders` (damen/herren on Dosenbach + Ochsner, men/women on
 * SNIPES); children from `phasesOfLife` when no adult phase is listed.
 */
export function genderOf(p: any): ProductRecord["gender"] {
  const phases = many(p?.attributes?.phasesOfLife).map((v) => String(v?.value ?? ""));
  if (phases.length && !phases.includes("erwachsene") && phases.some((x) => /kid|kinder|child|teen|bab/.test(x))) return "cocuk";
  const g = many(p?.attributes?.genders).map((v) => String(v?.value ?? "").toLowerCase());
  const women = g.some((x) => /^(damen|women|female|weiblich)/.test(x));
  const men = g.some((x) => /^(herren|men|male|maennlich|männlich)/.test(x));
  if (women && !men) return "kadin";
  if (men && !women) return "erkek";
  return null;
}

/**
 * The shop's product-type label. Outside the German-language shops the label is
 * French/Italian/Swedish … ("Bottines"), which the type classifier does not
 * read, so the attribute's own value — a German code ("stiefelette",
 * "sneaker", "sandale") — rides along after it.
 */
function categoryOf(shop: DeichmannShop, p: any): string | null {
  const t = one(p?.attributes?.productType);
  const label = String(t?.label ?? "").trim();
  const code = String(t?.value ?? "").trim();
  if (shop.lang.startsWith("de") || !code || label.toLowerCase().includes(code.toLowerCase())) return label || null;
  return label ? `${label} (${code})` : code;
}

export const imageUrl =(assets: string, publicId: string) => `${assets}/images/f_auto,q_auto/w_800/${publicId}/p`;

/**
 * Map one listing product. Pure. Prices in the API are already centimes.
 *
 * The listing carries ONE variant per product (the BFF trims the rest; the
 * full size run is only on `/products/{id}`, one request per product — far
 * over the request budget). So no per-size availability: product-level
 * `stock` / `isSoldOut` decide `inStock`, and the headline price is the
 * product's `priceRange.min`.
 */
export function mapDeichmann(shop: DeichmannShop, country: CountryCode, p: any): ProductRecord | null {
  if (!p?.id || !p?.url) return null;
  const min = p.priceRange?.min ?? p.variants?.[0]?.price;
  const price = Number(min?.withTax);
  if (!Number.isFinite(price) || price <= 0) return null;
  const was = Number(min?.beforeSaleWithTax);
  const listPrice = Number.isFinite(was) && was > price ? was : null;

  const brandName = String(one(p.attributes?.brand)?.label ?? "").trim();
  const display = String(p.displayName ?? one(p.attributes?.name)?.label ?? "").trim();
  if (!display) return null;
  const name = brandName && !display.toLowerCase().startsWith(brandName.toLowerCase()) ? `${brandName} ${display}` : display;
  const colour = String(one(p.attributes?.color)?.label ?? "").trim() || null;

  const barcodes = (Array.isArray(p.variants) ? p.variants : [])
    .map((v: any) => String(one(v?.attributes?.ean)?.value ?? ""))
    .filter((e: string) => /^\d{8,14}$/.test(e));

  const imgs = (Array.isArray(p.images) ? p.images : [])
    .map((im: any) => (typeof im?.public_id === "string" ? imageUrl(shop.assets, im.public_id) : null))
    .filter((u: string | null): u is string => !!u);
  const siblings = Array.isArray(p.siblings) ? p.siblings.length : 0;

  return {
    brand: shop.slug,
    country,
    externalId: String(p.id),
    name,
    url: `${shop.site}${p.url}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price,
    listPrice,
    currency: String(min?.currencyCode ?? COUNTRIES[country].currency),
    inStock: p.isSoldOut !== true && Number(p.stock ?? 1) > 0,
    barcodes: barcodes.length ? [...new Set<string>(barcodes)] : null,
    category: categoryOf(shop, p),
    gender: genderOf(p),
    variants: null,
    groupKey: siblings > 1 && p.masterKey ? `${shop.slug}:${p.masterKey}` : null,
    colorName: colour,
  };
}

export const charybdisHeader = (t: Charybdis) => Buffer.from(JSON.stringify(t)).toString("base64");

/**
 * Re-read the shop's charybdis values from its own home page (`ng-state`
 * CONFIG is gzip+base64 JSON). Used only when the pinned values are refused.
 */
export function tokenFromHtml(html: string, context: string): Charybdis | null {
  const m = html.match(/<script id="ng-state" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const state = JSON.parse(m[1]);
    const raw = String(state.CONFIG ?? "");
    const cfg = JSON.parse(raw.startsWith("H4sI") ? gunzipSync(Buffer.from(raw, "base64")).toString("utf8") : raw);
    const data = cfg?.body?.client?.data;
    const server = data?.server?.[0];
    const lang = data?.languages?.[context];
    if (!server?.concept || !lang?.scayleShopId) return null;
    return {
      concept: server.concept,
      scayleEnvironment: server.scayleEnvironment,
      scayleShopId: String(lang.scayleShopId),
      cmsSpace: server.cmsSpace,
      cmsEnvironment: server.cmsEnvironment,
      cmsAccessToken: server.cmsAccessToken,
      tree: String(lang.navigationTreeDesktop ?? server.navigationTreeDesktop),
      context,
    };
  } catch {
    return null;
  }
}

export async function listDeichmann(slug: DeichmannSlug, country: CountryCode): Promise<ProductRecord[]> {
  const shop = DEICHMANN_SHOPS[slug]?.[country];
  if (!shop) return [];
  const cap = 1500;
  let token = shop.token;
  const fetchPage = (n: number) =>
    getJson<any>(`${shop.api}/categories/${shop.saleCategory}?page=${n}&perPage=${shop.perPage}&lang=${shop.lang}`, {
      country,
      retries: 1,
      headers: { "X-Charybdis": charybdisHeader(token) },
    });

  const byId = new Map<string, ProductRecord>();
  let inStock = 0;
  for (let n = 1; n <= MAX_PAGES; n++) {
    if (n > 1) await sleep(PAUSE_MS);
    let data: any;
    try {
      data = await fetchPage(n);
    } catch (err) {
      if (n !== 1) break;
      const fresh = tokenFromHtml(await getText(`${shop.site}/`, { country }), shop.token.context);
      if (!fresh) throw err;
      token = fresh;
      data = await fetchPage(n);
    }
    const rows: any[] = Array.isArray(data?.products) ? data.products : [];
    for (const p of rows) {
      const r = mapDeichmann(shop, country, p);
      if (!r || r.listPrice == null || byId.has(r.externalId)) continue;
      byId.set(r.externalId, r);
      if (r.inStock) inStock++;
    }
    const pages = Number(data?.pagination?.totalPages ?? 0);
    if (!rows.length || n >= pages || inStock >= cap) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
}
