/**
 * Alshaya brand shops in the Gulf (Victoria's Secret, Bath & Body Works,
 * American Eagle) — one platform: an AEM Edge Delivery front end whose
 * product lists come straight from Algolia. Measured 2026-10-11:
 *
 * - Each shop's `/configs.json` publishes its Algolia app id, search-only key
 *   and index names (`<brand>_prod_<ae|sa>_product_list`). The app and key are
 *   per brand, shared by every market of that brand.
 * - The KSA shops are on `.com.sa` (`victoriassecret.sa`/`americaneagle.sa`
 *   do not resolve; `bathandbodyworks.sa` redirects to the US site).
 * - bathandbodyworks.ae / .com.sa sit behind a JS "Client Challenge", but
 *   Algolia itself is a plain public API, so the collector never touches the
 *   walled host; the AEM origin's configs.json gave the BBW app id.
 * - BBW `title` is the fragrance alone; `gtm.gtm-name` is the full name.
 * - The index holds only buyable rows (`stock` 2 = in stock). `discount` is the
 *   markdown percent, `final_price`/`original_price` are major units in the
 *   market's currency. `attr_size` lists the sizes that are on sale now, so
 *   every listed size is in stock (sold-out sizes are simply absent). Basket
 *   promotions ("40% off everything", "3 for 175") are not in final_price and
 *   are ignored, like elsewhere.
 * - Qatar and Kuwait (2026-10-21) are the same apps and keys with
 *   `_prod_qa_`/`_prod_kw_` indices, sites on `.com.qa` / `.com.kw`. Kuwait
 *   prices are KWD with up to 3 decimals (17.5, 2.25); toMinor rounds to ×100.
 * - Pagination is not capped at 1,000 hits (AEO AE: 1,986 over two pages of
 *   1,000), so a market is 1–3 requests.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export interface AlshayaBrand {
  slug: string;
  appId: string;
  apiKey: string;
  /** Index prefix: `<prefix>_prod_<cc>_product_list`. */
  prefix: string;
  sites: Partial<Record<CountryCode, string>>;
  defaultGender: ProductRecord["gender"];
}

export const ALSHAYA_BRANDS: Record<string, AlshayaBrand> = {
  victoriassecret: {
    slug: "victoriassecret",
    appId: "4FNPAZ4RVM",
    apiKey: "febfc405b70857ee8f201a084e5853e6",
    prefix: "vs",
    sites: {
      AE: "https://www.victoriassecret.ae",
      SA: "https://www.victoriassecret.com.sa",
      QA: "https://www.victoriassecret.com.qa",
      KW: "https://www.victoriassecret.com.kw",
    },
    defaultGender: "kadin",
  },
  bathandbodyworks: {
    slug: "bathandbodyworks",
    appId: "6TOQSJY0O6",
    apiKey: "c7af7bb2c02f6f150cf0e92eeaef1476",
    prefix: "bbw",
    sites: {
      AE: "https://www.bathandbodyworks.ae",
      SA: "https://www.bathandbodyworks.com.sa",
      QA: "https://www.bathandbodyworks.com.qa",
      KW: "https://www.bathandbodyworks.com.kw",
    },
    defaultGender: null,
  },
  americaneagle: {
    slug: "americaneagle",
    appId: "SK1QL8DGIA",
    apiKey: "9102f3143ecc8b69ff6662de24805073",
    prefix: "aeo",
    sites: {
      AE: "https://www.americaneagle.ae",
      SA: "https://www.americaneagle.com.sa",
      QA: "https://www.americaneagle.com.qa",
      KW: "https://www.americaneagle.com.kw",
    },
    defaultGender: null,
  },
};

const PER_PAGE = 1000;
const MAX_PAGES = 5;
const CAP = Number(process.env.ALSHAYA_MAX_PRODUCTS ?? 1500);
const FIELDS = [
  "sku", "title", "url", "final_price", "original_price", "discount", "attr_size", "attr_color",
  "attr_style_code", "attr_product_category", "attr_form", "gtm", "media", "field_category", "super_category", "stock",
].join(",");

const en = (v: any): any => (v && typeof v === "object" && "en" in v ? v.en : v);
const num = (v: any): number => Number(en(v));
/** Sizes that are really a pack volume ("8 fl oz / 236 mL"), not a garment size. */
const VOLUME = /\b(oz|ml|g|one size)\b/i;

function genderOf(b: AlshayaBrand, h: any): ProductRecord["gender"] {
  const cats: string[] = (en(h?.field_category) ?? []).map((c: any) => String(c?.lvl0 ?? ""));
  const sup: string[] = (en(h?.super_category) ?? []).map(String);
  const all = [...cats, ...sup, String(h?.gtm?.["gtm-category"] ?? "")].join(" | ");
  if (/\b(kids?|girls?|boys?|baby)\b/i.test(all)) return "cocuk";
  const women = /\b(women|aerie)\b/i.test(all);
  const men = /\bmen('s)?\b/i.test(all.replace(/\bwomen/gi, ""));
  if (women && !men) return "kadin";
  if (men && !women) return "erkek";
  return b.defaultGender;
}

/** Map one Algolia hit. Pure. Returns null for rows without a usable price. */
export function mapAlshaya(b: AlshayaBrand, country: CountryCode, h: any): ProductRecord | null {
  const site = b.sites[country];
  const title = String(en(h?.title) ?? "").replace(/\s+/g, " ").trim();
  const path = en(h?.url);
  const price = num(h?.final_price);
  const orig = num(h?.original_price);
  if (!site || !h?.sku || !title || typeof path !== "string" || !(price > 0)) return null;
  const type: string =
    (en(h?.attr_product_category) ?? [])[0] ??
    (en(h?.attr_form) ?? [])[0] ??
    String(h?.gtm?.["gtm-category"] ?? "").split("/").pop()?.trim() ??
    "";
  // BBW titles are the fragrance alone ("Ultimate"); gtm-name is the full
  // shelf name ("Ultimate Beard Oil"). For VS/AEO the two are equal.
  const gtmName = String(h?.gtm?.["gtm-name"] ?? "").replace(/\s+/g, " ").trim();
  const name = gtmName.length > title.length ? gtmName : title;
  const labels: string[] = (en(h?.attr_size) ?? []).map((s: unknown) => String(s).trim()).filter(Boolean);
  const sizes: SizeVariant[] = labels.every((l) => VOLUME.test(l))
    ? []
    : [...new Set(labels)].map((label) => ({ label, availability: "in_stock" as const }));
  const colors: string[] = (en(h?.attr_color) ?? []).map(String).filter(Boolean);
  const imgs: string[] = (h?.media ?? [])
    .filter((m: any) => m?.image_type === "image" && typeof m?.url === "string")
    .map((m: any) => m.url as string);
  const style = String(en(h?.attr_style_code) ?? "").trim();
  return {
    brand: b.slug,
    country,
    externalId: String(h.sku),
    name,
    url: `${site}${path}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: orig > price ? toMinor(orig) : null,
    currency: COUNTRIES[country].currency,
    inStock: Number(h?.stock ?? 2) !== 0,
    category: type ? String(type) : null,
    gender: genderOf(b, h),
    variants: sizes.length || colors.length ? { colors, sizes } : null,
    groupKey: style && style !== String(h.sku) ? `${b.slug}:${style}` : null,
    colorName: colors[0] ?? null,
  };
}

export function alshayaQuery(b: AlshayaBrand, country: CountryCode, page: number) {
  const index = `${b.prefix}_prod_${country.toLowerCase()}_product_list`;
  const params = new URLSearchParams({
    hitsPerPage: String(PER_PAGE),
    page: String(page),
    numericFilters: "discount.en>0",
    attributesToRetrieve: FIELDS,
    attributesToHighlight: "",
  }).toString();
  return {
    url: `https://${b.appId.toLowerCase()}-dsn.algolia.net/1/indexes/${index}/query`,
    body: JSON.stringify({ params }),
  };
}

export async function listAlshaya(slug: string, country: CountryCode): Promise<ProductRecord[]> {
  const b = ALSHAYA_BRANDS[slug];
  if (!b?.sites[country]) return [];
  const byId = new Map<string, ProductRecord>();
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await new Promise((r) => setTimeout(r, 800));
    const q = alshayaQuery(b, country, page);
    const data = await getJson<any>(q.url, {
      method: "POST",
      body: q.body,
      country,
      headers: {
        "Content-Type": "application/json",
        "X-Algolia-Application-Id": b.appId,
        "X-Algolia-API-Key": b.apiKey,
      },
    });
    const hits: any[] = data?.hits ?? [];
    for (const h of hits) {
      const r = mapAlshaya(b, country, h);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
    if (page + 1 >= Number(data?.nbPages ?? 0) || hits.length === 0) break;
  }
  const off = (r: ProductRecord) => (r.listPrice! - r.price) / r.listPrice!;
  const all = [...byId.values()].sort((a, z) => Number(z.inStock) - Number(a.inStock) || off(z) - off(a));
  return all.slice(0, CAP);
}
