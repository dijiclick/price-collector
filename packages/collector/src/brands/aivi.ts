/**
 * AIVI — Apparel Group's Gulf marketplace, formerly 6thStreet (6thstreet.com
 * now 301s to aivi.com). Multi-brand: Aldo, Charles & Keith, Skechers, Nine
 * West, Tommy, CK, R&B, LC Waikiki, Koton, boohoo… Measured 2026-10-11:
 *
 * - The storefront HTML sits behind CloudFront/WAF (403 to a GitHub runner),
 *   but every product list is read from Algolia with a public key that ships in
 *   the site's own JS bundle (`appId 02X7U6O3SI`, `en-ae.aivi.com/static/js/
 *   main.*.chunk.js`). Algolia is not behind the site's wall — plain POST, no
 *   proxy (verified on runner, probe run 38134349910).
 * - Index per market: `enterprise_magento_english_products` (UAE, AED) and
 *   `enterprise_magento_en_sa_products` (KSA, SAR). The price block is keyed
 *   by the market currency: `6s_special_price` is what is charged,
 *   `6s_base_price` the strikethrough.
 * - `discount` (percent) and `in_stock` are numeric attributes, so the query
 *   asks for discounted, in-stock rows only (~125k of 215k in AE).
 * - `simple_products` carries per-size stock (`quantity`), keyed by barcode —
 *   that is what powers size-restock alerts.
 * - Pagination is NOT capped at 1,000 hits, so 1,500 rows is 2 requests.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const APP_ID = "02X7U6O3SI";
const API_KEY = "6e9a600dc69be19481363bddd793e2f2";
const INDEX: Partial<Record<CountryCode, string>> = {
  AE: "enterprise_magento_english_products",
  SA: "enterprise_magento_en_sa_products",
  // 2026-10-21: QAR / KWD (KWD prices carry 3 decimals; toMinor rounds to ×100).
  QA: "enterprise_magento_en_qa_products",
  KW: "enterprise_magento_en_kw_products",
};
const PER_PAGE = 1000;
const CAP = Number(process.env.AIVI_MAX_PRODUCTS ?? 1500);
const FIELDS = [
  "objectID", "sku", "name", "url", "brand_name", "price", "discount", "in_stock", "color", "gender",
  "style_code", "product_type_6s", "image_url", "gallery_image_urls", "simple_products", "categories",
].join(",");

function genderOf(h: any): ProductRecord["gender"] {
  const g = String(h?.gender ?? "").toLowerCase();
  if (/^(girl|boy|kids?|baby|infant)/.test(g)) return "cocuk";
  if (g === "women") return "kadin";
  if (g === "men") return "erkek";
  const top: string[] = (h?.categories?.level0 ?? []).map(String);
  if (top.includes("Kids")) return "cocuk";
  if (top.includes("Women") && !top.includes("Men")) return "kadin";
  if (top.includes("Men") && !top.includes("Women")) return "erkek";
  return null;
}

function sizesOf(h: any): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const sp of Object.values<any>(h?.simple_products ?? {})) {
    const s = sp?.size ?? {};
    const label = String(s.eu || s.uk || s.us || "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const q = Number(sp?.quantity ?? 0);
    out.push({ label, availability: q <= 0 ? "out_of_stock" : q <= 2 ? "low_on_stock" : "in_stock" });
  }
  return out;
}

/** Map one Algolia hit. Pure. Returns null when the row has no usable price in this market. */
export function mapAivi(country: CountryCode, h: any): ProductRecord | null {
  const cur = COUNTRIES[country].currency;
  const p = (Array.isArray(h?.price) ? h.price : []).map((x: any) => x?.[cur]).find(Boolean);
  if (!p || !h?.sku || !h?.name || typeof h?.url !== "string") return null;
  const price = Number(p["6s_special_price"] ?? p.default);
  const base = Number(p["6s_base_price"]);
  if (!(price > 0)) return null;
  const brandName = String(h.brand_name ?? "").trim();
  const title = String(h.name).replace(/\s+/g, " ").trim();
  const name = brandName && !title.toLowerCase().includes(brandName.toLowerCase()) ? `${brandName} ${title}` : title;
  const imgs: string[] = [h.image_url, ...(h.gallery_image_urls ?? [])].filter((u: unknown) => typeof u === "string");
  const sizes = sizesOf(h);
  const color = typeof h.color === "string" && h.color.trim() ? h.color.trim() : null;
  const style = String(h.style_code ?? "").trim();
  return {
    brand: "aivi",
    country,
    externalId: String(h.sku),
    name,
    url: h.url,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: base > price ? toMinor(base) : null,
    currency: cur,
    inStock: Number(h.in_stock ?? 1) === 1 && (sizes.length === 0 || sizes.some((s) => s.availability !== "out_of_stock")),
    category: typeof h.product_type_6s === "string" ? h.product_type_6s : null,
    gender: genderOf(h),
    variants: sizes.length || color ? { colors: color ? [color] : [], sizes } : null,
    groupKey: style && style !== String(h.sku) ? `aivi:${style}` : null,
    colorName: color,
  };
}

export function aiviQuery(country: CountryCode, page: number) {
  const params = new URLSearchParams({
    query: "",
    hitsPerPage: String(PER_PAGE),
    page: String(page),
    numericFilters: "discount>0,in_stock=1",
    attributesToRetrieve: FIELDS,
    attributesToHighlight: "",
  }).toString();
  return {
    url: `https://${APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/${INDEX[country]}/query`,
    body: JSON.stringify({ params }),
  };
}

export async function listAivi(country: CountryCode): Promise<ProductRecord[]> {
  if (!INDEX[country]) return [];
  const byId = new Map<string, ProductRecord>();
  for (let page = 0; byId.size < CAP && page < 3; page++) {
    if (page > 0) await new Promise((r) => setTimeout(r, 800));
    const q = aiviQuery(country, page);
    const data = await getJson<any>(q.url, {
      method: "POST",
      body: q.body,
      country,
      headers: { "Content-Type": "application/json", "X-Algolia-Application-Id": APP_ID, "X-Algolia-API-Key": API_KEY },
    });
    const hits: any[] = data?.hits ?? [];
    for (const h of hits) {
      const r = mapAivi(country, h);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
    if (page + 1 >= Number(data?.nbPages ?? 0) || hits.length === 0) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
