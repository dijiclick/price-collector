/**
 * H&M group sister brands — COS, Arket, & Other Stories, Weekday — in GB, CH
 * and NO (2026-10-11).
 *
 * Their storefronts are Akamai-walled (403 to a browser UA from a GitHub
 * runner) and none of them is served by api.hm.com (that API only knows H&M).
 * Each brand is a Next.js site whose product grid comes from a JSON API, and
 * those APIs answer a plain GET with an Android-app User-Agent (`okhttp/…`):
 *
 *   cos     api.cos.com/product-search/v1/{mk}/products      Fredhopper BFF, `statuses_{mk}` = on_sale filter
 *   stories api.stories.com/product-search/v1/{mk}/products  Voyado Elevate behind a BFF, by pageReference
 *   weekday api.weekday.com/products/v1/{mk}/products        Voyado Elevate behind a BFF, by pageReference
 *   arket   wA35412D6.api.esales.apptus.cloud                Voyado Elevate storefront API directly (public, no key)
 *
 * All four verified from a GitHub runner, no proxy: probe run 38134841738.
 * English (`en-GB`) is used wherever the market accepts it, since
 * lib/productTypes.ts classifies English; the market code still picks the price
 * list, so prices come back in GBP / CHF / NOK / EUR / SEK / DKK. EU markets
 * (2026-10-21) that refuse `en-GB` use their own language — see `EU` below.
 *
 * Only reduced rows are kept, in-stock first, capped. Sale pages are seasonal:
 * COS had no sale at all on 2026-10-11 (0 rows is a correct answer then), and
 * the category grids of COS and & Other Stories deliberately EXCLUDE sale
 * items, so the sale filter / sale pages are the only way in.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export type HmGroupSlug = "cos" | "arket" | "stories" | "weekday";
type Gender = ProductRecord["gender"];

/** The app UA these APIs' bot rules let through; a browser UA gets Akamai's 403. */
const APP_HEADERS = { "User-Agent": "okhttp/4.12.0", Accept: "application/json" };
const LOCALE = "en-GB";
const CAP = 1500;
const PAUSE_MS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One market: the code the API takes, the site's locale path, and the locale to
 * ask for when the market refuses `en-GB` ("Locale "en-GB" is not supported in
 * market "de"" — every API checks the pair).
 */
interface Market {
  mk: string;
  path: string;
  locale?: string;
}

interface Brand {
  site: string;
  /** Market code the API takes, and the site's locale path, per country. */
  markets: Partial<Record<CountryCode, Market>>;
  /** Sale pages (Elevate pageReference) with the section's gender. Unused by COS. */
  pages: [ref: string, gender: Gender][];
  pageSize: number;
}

/**
 * EU markets (2026-10-21). Each brand runs its own market for the big
 * countries, and one euro market, `eu` (English, EUR), for the rest — Ireland,
 * Belgium, Portugal and Finland have no market of their own (their codes answer
 * 400 on every locale). Where a market accepts `en-GB` it is used (English
 * names classify best); elsewhere its own language. Measured from this Mac:
 * Arket's FR/ES/IT sale pages answer with 0 hits, and Weekday has no ES/IT
 * market, so those are left out rather than mapped to another shop.
 */
const EU = (mk: string, path = "en-eu"): Market => ({ mk, path });

export const HMGROUP: Record<HmGroupSlug, Brand> = {
  cos: {
    site: "https://www.cos.com",
    markets: {
      GB: { mk: "gb", path: "en-gb" }, CH: { mk: "ch", path: "en-ch" }, NO: { mk: "no", path: "en-no" },
      // COS had no sale in any market on 2026-10-21 (on_sale filter: 0 everywhere, GB too).
      DE: { mk: "de", path: "en-de" }, AT: { mk: "at", path: "de-at", locale: "de-AT" },
      FR: { mk: "fr", path: "fr-fr", locale: "fr-FR" }, ES: { mk: "es", path: "es-es", locale: "es-ES" },
      IT: { mk: "it", path: "it-it", locale: "it-IT" }, NL: { mk: "nl", path: "en-nl" },
      SE: { mk: "se", path: "sv-se", locale: "sv-SE" }, DK: { mk: "dk", path: "en-dk" },
      IE: EU("ie", "en-ie"), BE: EU("eu"), PT: EU("eu"), FI: EU("eu"),
    },
    pages: [],
    pageSize: 500,
  },
  arket: {
    site: "https://www.arket.com",
    markets: {
      GB: { mk: "GB", path: "en-gb" }, CH: { mk: "CH", path: "en-ch" }, NO: { mk: "NO", path: "en-no" },
      DE: { mk: "DE", path: "de-de", locale: "de-DE" }, AT: { mk: "AT", path: "de-at", locale: "de-AT" },
      NL: { mk: "NL", path: "en-nl" }, SE: { mk: "SE", path: "en-se" }, DK: { mk: "DK", path: "en-dk" },
      IE: EU("EU"), BE: EU("EU"), PT: EU("EU"), FI: EU("EU"),
    },
    pages: [["/sale/women", "kadin"], ["/sale/men", "erkek"], ["/sale/children", "cocuk"]],
    pageSize: 200,
  },
  stories: {
    site: "https://www.stories.com",
    markets: {
      GB: { mk: "gb", path: "en-gb" }, CH: { mk: "ch", path: "en-ch" }, NO: { mk: "no", path: "en-no" },
      DE: { mk: "de", path: "en-de" }, AT: { mk: "at", path: "de-at", locale: "de-AT" },
      NL: { mk: "nl", path: "en-nl" }, SE: { mk: "se", path: "en-se" }, DK: { mk: "dk", path: "en-dk" },
      FR: { mk: "fr", path: "fr-fr", locale: "fr-FR" }, ES: { mk: "es", path: "es-es", locale: "es-ES" },
      IT: { mk: "it", path: "it-it", locale: "it-IT" },
      IE: EU("eu"), BE: EU("eu"), PT: EU("eu"), FI: EU("eu"),
    },
    // "/promotions/new-to-sale" is the live markdown page; "/sale" is where the
    // seasonal sale lands (0 rows outside it). & Other Stories is womenswear.
    pages: [["/promotions/new-to-sale", "kadin"], ["/sale", "kadin"]],
    pageSize: 200,
  },
  weekday: {
    site: "https://www.weekday.com",
    markets: {
      GB: { mk: "gb", path: "en-gb" }, CH: { mk: "ch", path: "en-ch" }, NO: { mk: "no", path: "no-no" },
      DE: { mk: "de", path: "de-de", locale: "de-DE" }, AT: { mk: "at", path: "de-at", locale: "de-AT" },
      FR: { mk: "fr", path: "fr-fr", locale: "fr-FR" }, NL: { mk: "nl", path: "nl-nl", locale: "nl-NL" },
      SE: { mk: "se", path: "sv-se", locale: "sv-SE" }, DK: { mk: "dk", path: "en-dk" },
      IE: EU("eu"), BE: EU("eu"), PT: EU("eu"), FI: EU("eu"),
    },
    pages: [["/women/sale", "kadin"], ["/men/sale", "erkek"]],
    pageSize: 200,
  },
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The API answered another market's price list: fail rather than store wrong-currency prices. */
export function assertCurrency(slug: HmGroupSlug, country: CountryCode, seen: unknown): void {
  if (typeof seen !== "string" || !seen) return;
  const want = COUNTRIES[country].currency;
  if (!seen.toUpperCase().includes(want)) throw new Error(`${slug}/${country}: API priced in "${seen}", expected ${want}`);
}

const stockOf = (n: unknown): SizeVariant["availability"] => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "out_of_stock";
  return v <= 2 ? "low_on_stock" : "in_stock";
};

function record(
  slug: HmGroupSlug,
  country: CountryCode,
  r: Omit<ProductRecord, "brand" | "country" | "currency" | "listPrice" | "price" | "images"> & {
    price: number | null;
    was: number | null;
    gallery: unknown[];
  },
): ProductRecord | null {
  const { price, was, gallery, ...rest } = r;
  if (!rest.externalId || !rest.name || price == null || was == null || was <= price) return null;
  return {
    ...rest,
    brand: slug,
    country,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: COUNTRIES[country].currency,
    images: cleanGallery(gallery as string[], rest.imageUrl),
  };
}

// ---------- COS (Fredhopper BFF) ----------

export function cosUrl(mk: string, offset: number, limit: number, lang = "en"): string {
  const p = new URLSearchParams({
    customerType: "regular",
    deviceType: "desktop",
    languageCode: lang,
    layout: "editorial",
    view: "lister",
    limit: String(limit),
    offset: String(offset),
    filters: JSON.stringify([{ attribute: `statuses_${mk}`, type: "set", operator: "any of", values: ["on_sale"] }]),
  });
  return `https://api.cos.com/product-search/v1/${mk}/products?${p}`;
}

export function mapCos(country: CountryCode, p: any): ProductRecord | null {
  const m = HMGROUP.cos.markets[country]!;
  const imgs: string[] = (p?.media ?? []).map((x: any) => x?.source?.standard?.url);
  const g = String(p?.gender ?? "").toLowerCase();
  const cat = String(p?.mainCategory?.uri ?? "");
  return record("cos", country, {
    externalId: String(p?.sku ?? p?.id ?? ""),
    name: String(p?.name ?? "").trim(),
    url: `${HMGROUP.cos.site}/${m.path}/${cat ? `${cat}/` : ""}product/${p?.uri}`,
    imageUrl: p?.primaryImage?.source?.standard?.url ?? imgs[0] ?? null,
    gallery: imgs,
    price: num(p?.price?.value),
    was: num(p?.priceBeforeDiscount?.value),
    inStock: p?.hasStock !== false,
    category: p?.details?.productType ?? null,
    gender: /^(female|women)/.test(g) ? "kadin" : /^(male|men)/.test(g) ? "erkek" : /^(kid|child)/.test(cat) ? "cocuk" : null,
    variants: null,
    groupKey: p?.parent?.sku ? `cos:${p.parent.sku}` : null,
    colorName: p?.variant?.name ?? null,
  });
}

// ---------- & Other Stories / Weekday (Elevate behind the brand BFF) ----------

export function bffUrl(slug: "stories" | "weekday", mk: string, ref: string, skip: number, limit: number, locale = LOCALE): string {
  const p = new URLSearchParams({
    customerKey: "modadrop",
    sessionKey: "modadrop",
    locale,
    touchpoint: "DESKTOP",
    pageReference: ref,
    notify: "false",
    limit: String(limit),
    skip: String(skip),
  });
  return slug === "stories"
    ? `https://api.stories.com/product-search/v1/${mk}/products?${p}`
    : `https://api.weekday.com/products/v1/${mk}/products?${p}`;
}

export function mapStories(country: CountryCode, p: any, gender: Gender): ProductRecord | null {
  const m = HMGROUP.stories.markets[country]!;
  const imgs: string[] = (p?.images ?? []).map((x: any) => x?.url);
  const hero = (p?.images ?? []).find((x: any) => /StillLife/.test(x?.assetType ?? ""))?.url ?? imgs[0] ?? null;
  const sizes: SizeVariant[] = (p?.sizes ?? [])
    .filter((s: any) => s?.name)
    .map((s: any) => ({ label: String(s.name), availability: stockOf(s.stock) }));
  const cat = String(p?.categoryUris?.find((u: string) => !/^(sale|new|trending|promotions)/.test(u)) ?? "");
  return record("stories", country, {
    externalId: String(p?.sku ?? p?.id ?? ""),
    name: String(p?.name ?? "").trim(),
    url: `${HMGROUP.stories.site}/${m.path}/product/${p?.uri}/`,
    imageUrl: hero,
    gallery: imgs,
    price: num(p?.price?.value),
    was: num(p?.priceBeforeDiscount?.value),
    inStock: p?.available !== false && (sizes.length === 0 || sizes.some((s) => s.availability !== "out_of_stock")),
    category: cat ? cat.split("/").pop()! : null,
    gender,
    variants: sizes.length ? { colors: p?.variantName ? [p.variantName] : [], sizes } : null,
    groupKey: p?.sku ? `stories:${String(p.sku).slice(0, 7)}` : null,
    colorName: p?.variantName ?? null,
  });
}

export function mapWeekday(country: CountryCode, p: any, gender: Gender): ProductRecord | null {
  const imgs: string[] = p?.media?.images ?? [];
  const sizes: SizeVariant[] = (p?.sizeVariants ?? [])
    .filter((s: any) => s?.label)
    .map((s: any) => {
      const v = String(s.inStock ?? "").toLowerCase();
      return { label: String(s.label), availability: v === "yes" ? "in_stock" : v === "no" || !v ? "out_of_stock" : "low_on_stock" };
    });
  const path = String(p?.categoryNames?.[0] ?? "").split(">").map((s) => s.trim());
  return record("weekday", country, {
    externalId: String(p?.sku ?? p?.id ?? ""),
    name: String(p?.name ?? "").trim(),
    url: `${HMGROUP.weekday.site}${p?.url ?? ""}`,
    imageUrl: imgs[0] ?? null,
    gallery: imgs,
    price: num(p?.pricing?.priceAsNumber),
    was: num(p?.pricing?.originalPriceAsNumber ?? p?.pricing?.priceBeforeDiscountAsNumber),
    inStock: p?.available !== false && (sizes.length === 0 || sizes.some((s) => s.availability !== "out_of_stock")),
    category: path[1] || null,
    gender: /^men\b/i.test(String(p?.categoryUri ?? "")) ? "erkek" : /^women\b/i.test(String(p?.categoryUri ?? "")) ? "kadin" : gender,
    variants: sizes.length ? { colors: p?.variantName ? [p.variantName] : [], sizes } : null,
    groupKey: p?.productSku ? `weekday:${p.productSku}` : null,
    colorName: p?.variantName ?? null,
  });
}

// ---------- Arket (Elevate storefront API, direct) ----------

export const ARKET_CLUSTER = "https://wa35412d6.api.esales.apptus.cloud";

export function arketUrl(mk: string, ref: string, skip: number, limit: number, locale = LOCALE): string {
  const p = new URLSearchParams({
    market: mk,
    locale,
    customerKey: "modadrop",
    sessionKey: "modadrop",
    touchpoint: "desktop",
    pageReference: ref,
    limit: String(limit),
    skip: String(skip),
  });
  return `${ARKET_CLUSTER}/api/storefront/v3/queries/landing-page?${p}`;
}

/** One Elevate product = one colour; its `variants` are the sizes. */
export function mapArket(country: CountryCode, p: any, gender: Gender): ProductRecord | null {
  const m = HMGROUP.arket.markets[country]!;
  const imgs: string[] = (p?.imageInfo?.images ?? []).map((im: any) => im?.sources?.[0]?.url);
  const sizes: SizeVariant[] = (p?.variants ?? [])
    .filter((v: any) => v?.label ?? v?.size)
    .map((v: any) => ({ label: String(v.label ?? v.size), availability: v.inStock ? stockOf(v.stockNumber ?? 3) : "out_of_stock" }));
  const link = String(p?.link ?? "").replace(/^\/+|\/+$/g, "");
  return record("arket", country, {
    externalId: String(p?.key ?? ""),
    name: String(p?.title ?? "").trim(),
    url: `${HMGROUP.arket.site}/${m.path}/product/${link}/`,
    imageUrl: p?.imageInfo?.thumbnail ?? imgs[0] ?? null,
    gallery: imgs,
    price: num(p?.sellingPrice?.min),
    was: num(p?.listPrice?.min),
    inStock: p?.inStock === true,
    category: null,
    gender,
    variants: sizes.length ? { colors: [], sizes } : null,
    groupKey: p?.key ? `arket:${String(p.key).slice(0, 7)}` : null,
    colorName: null,
  });
}

// ---------- crawl ----------

export async function listHmGroup(slug: HmGroupSlug, country: CountryCode): Promise<ProductRecord[]> {
  const b = HMGROUP[slug];
  const m = b.markets[country];
  if (!m) return [];
  const byId = new Map<string, ProductRecord>();
  const add = (r: ProductRecord | null) => {
    if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
  };
  let requests = 0;
  const fetchJson = async (url: string, init: { method?: string; body?: string } = {}) => {
    if (requests > 0) await sleep(PAUSE_MS);
    requests++;
    return getJson<any>(url, {
      country,
      headers: init.body ? { ...APP_HEADERS, "Content-Type": "application/json" } : APP_HEADERS,
      ...init,
    });
  };
  const MAX_REQ = 40;

  if (slug === "cos") {
    for (let off = 0; requests < MAX_REQ; off += b.pageSize) {
      const d = await fetchJson(cosUrl(m.mk, off, b.pageSize, (m.locale ?? LOCALE).slice(0, 2)));
      const rows: any[] = d?.data?.products ?? [];
      if (off === 0) assertCurrency(slug, country, rows[0]?.price?.currencyCode);
      rows.forEach((p) => add(mapCos(country, p)));
      if (!rows.length || off + b.pageSize >= (d?.data?.pagination?.totalProducts ?? 0)) break;
    }
  } else {
    let checked = false;
    for (const [ref, gender] of b.pages) {
      for (let skip = 0; requests < MAX_REQ && byId.size < CAP * 2; skip += b.pageSize) {
        if (slug === "arket") {
          const d = await fetchJson(arketUrl(m.mk, ref, skip, b.pageSize, m.locale), { method: "POST", body: "{}" });
          const groups: any[] = d?.primaryList?.productGroups ?? [];
          for (const g of groups) for (const p of g?.products ?? []) add(mapArket(country, p, gender));
          if (!groups.length || skip + b.pageSize >= (d?.primaryList?.totalHits ?? 0)) break;
        } else {
          const d = await fetchJson(bffUrl(slug, m.mk, ref, skip, b.pageSize, m.locale));
          const rows: any[] = d?.data?.products ?? [];
          if (!checked && rows.length) {
            const r0 = rows[0];
            assertCurrency(slug, country, slug === "stories" ? r0?.price?.currency : r0?.pricing?.price);
            checked = true;
          }
          for (const p of rows) add(slug === "stories" ? mapStories(country, p, gender) : mapWeekday(country, p, gender));
          if (!rows.length || skip + b.pageSize >= (d?.data?.pagination?.totalProducts ?? 0)) break;
        }
      }
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
