/**
 * DSW (dsw.com, US) through the content API its own storefront and app page
 * with: `POST api.dsw.com/content/api/v3/page?uri=/category/clearance`, a
 * Sitecore Discover (Reflektion, account `dswus_prod`) search behind DSW's
 * own gateway. The body names the widgets to fill; `list_products` is the
 * product grid, paged by `content.products.page_size/page_number`.
 *
 * api.dsw.com refuses Turkish IPs outright (403 on every path from the Mac)
 * but answers a GitHub runner with no proxy (probe run 39137413533,
 * 2026-10-18: 200) and the Hetzner box.
 *
 * Markdown: DSW's own price (`price`) against its clearance price
 * (`clearance_price`), both for the colour the tile shows (`color_code`).
 * `msrp_list` is the manufacturer's "compare at" reference, never a price DSW
 * charged, so it is ignored. Under 5% is not a deal (DSW marks a $69.99 shoe
 * down to $69.98 in clearance). Items whose price shows only in the cart are
 * skipped.
 *
 * Multi-brand store: the name carries the brand, as Nordstrom Rack does.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const SITE = "https://www.dsw.com";
const API = "https://api.dsw.com/content/api/v3/page";
const URI = "/category/clearance";
const PAGE = 100; // the API serves at most ~100 per page, whatever is asked
const MAX_PAGES = 20;
const CAP = 1500;
const MIN_PCT = 5;
const PAUSE_MS = 800;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const FIELDS = [
  "id", "name", "category_list", "gender", "brand", "default_sku", "default_color_code", "color_code", "color_code_list", "color_list",
  "web_type", "is_any_clearance", "is_show_price_in_cart", "price_min", "price_max", "clearance_price_min", "clearance_price_max",
  "msrp_list", "stock_quantity", "price", "clearance_price", "badges",
];

/** The request body the storefront sends for a category grid, reduced to the product widget. */
export function pageBody(pageNumber: number): string {
  return JSON.stringify({
    widgets: [{ id: "list_products", type: "search", parameters: { include_ad_banners: false, include_ad_products: false, copy_format: "html" }, content: { products: {} } }],
    context: { user: {}, device: { app_type: "browser", device_type: "desktop" }, page: {} },
    content: { products: { page_size: PAGE, page_number: pageNumber, fields: FIELDS } },
  });
}

export const pageUrl = () => `${API}?${new URLSearchParams({ rfk_account: "dswus_prod", banner: "dswus", uri: URI })}`;

const num = (x: unknown): number | null => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** DSW's PDP slug, as the storefront's own `convertToUrl` builds it from brand + name. */
export const slugOf = (s: string) =>
  s.trim().toLowerCase().replace(/\s/g, "-").replace(/&/g, "and").replace(/[^a-z0-9\-.]+/g, "");

function genderOf(g: unknown): ProductRecord["gender"] {
  const v = (Array.isArray(g) ? g : [g]).map((x) => String(x ?? "").toLowerCase());
  if (v.some((x) => /boys|girls|kids|baby|toddler/.test(x))) return "cocuk";
  if (v.includes("women") && !v.includes("men")) return "kadin";
  if (v.includes("men") && !v.includes("women")) return "erkek";
  return null;
}

const SHOE_TYPE = /sandal|sneaker|boot|bootie|heel|pump|flat|loafer|slipper|clog|mule|oxford|wedge|slide|espadrille|moccasin|handbag|bag|backpack|wallet/i;
const BROAD = /^(spring|summer|fall|winter|gifts?|new arrivals?|clearance|sale|shoes|women|men|kids)$/i;

/** The most specific product type in `category_list` ("Slide Sandals" over "Sandals" over "Gifts"). */
export function categoryOf(list: unknown, webType: unknown): string | null {
  const l = (Array.isArray(list) ? list : []).map((x) => String(x ?? "").trim()).filter((x) => x && !BROAD.test(x));
  const typed = l.filter((x) => SHOE_TYPE.test(x));
  return typed[typed.length - 1] ?? l[l.length - 1] ?? (typeof webType === "string" && webType ? webType : null);
}

const photo = (id: string, colour: string, n: string) => `https://assets.designerbrands.com/match/Site_Name/${id}_${colour}_ss_${n}/?quality=70&width=1000`;

/** Map one `list_products` product to its clearance record. Pure. */
export function mapDswProduct(p: any, country: CountryCode = "US"): ProductRecord | null {
  const id = String(p?.id ?? "");
  const name = String(p?.name ?? "").replace(/\s+/g, " ").trim();
  if (!id || !name || p?.is_show_price_in_cart === true) return null;
  const was = num(p.price);
  const now = num(p.clearance_price);
  if (was == null || now == null || now >= was || (1 - now / was) * 100 < MIN_PCT) return null;
  const colour = String(p.color_code ?? p.default_color_code ?? "");
  const brand = Array.isArray(p.brand) ? String(p.brand[0] ?? "").trim() : String(p.brand ?? "").trim();
  const full = brand && !name.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${name}` : name;
  const codes: string[] = Array.isArray(p.color_code_list) ? p.color_code_list.map(String) : [];
  const names: string[] = Array.isArray(p.color_list) ? p.color_list.map(String) : [];
  const colourName = colour && codes.indexOf(colour) >= 0 ? names[codes.indexOf(colour)] ?? null : null;
  const image = colour ? photo(id, colour, "01") : null;
  return {
    brand: "dsw",
    country,
    externalId: colour ? `${id}-${colour}` : id,
    name: full,
    url: `${SITE}/product/${slugOf(full)}/${id}${colour ? `?activeColor=${encodeURIComponent(colour)}` : ""}`,
    imageUrl: image,
    images: cleanGallery([image], image),
    price: toMinor(now),
    listPrice: toMinor(was),
    currency: COUNTRIES[country].currency,
    inStock: Number(p.stock_quantity ?? 1) > 0,
    category: categoryOf(p.category_list, p.web_type),
    gender: genderOf(p.gender),
    variants: null,
    groupKey: codes.length > 1 ? `dsw-${id}` : null,
    colorName: colourName,
  };
}

export async function listDsw(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const byId = new Map<string, ProductRecord>();
  let inStock = 0;
  for (let page = 1; page <= MAX_PAGES && inStock < CAP; page++) {
    if (page > 1) await sleep(PAUSE_MS);
    const j = await getJson<any>(pageUrl(), {
      method: "POST",
      country,
      headers: { "Content-Type": "application/json", Origin: SITE, Referer: `${SITE}${URI}` },
      body: pageBody(page),
    });
    const w = (j?.widgets ?? []).find((x: any) => x?.id === "list_products");
    const products: any[] = w?.products?.value ?? [];
    for (const p of products) {
      const r = mapDswProduct(p, country);
      if (!r || byId.has(r.externalId)) continue;
      byId.set(r.externalId, r);
      if (r.inStock) inStock++;
    }
    if (!products.length || page >= Number(w?.products?.page_count ?? 0)) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
