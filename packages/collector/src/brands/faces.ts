/**
 * FACES (Chalhoub's beauty chain) — faces.ae / faces.sa. Measured 2026-10-11:
 *
 * - SFCC (SFRA), sites `Faces_AE` / `Faces_SA`. The storefront answers a plain
 *   request (Cloudflare in front, no challenge) from GitHub runners and here.
 * - The sale category is `beauty-sale` ("Offers": AE ~500, SA ~350 rows). Its
 *   "Show more" grid is `Search-UpdateGrid?cgid=beauty-sale&start=N&sz=48`
 *   (sz is capped at 48 server-side). The page ships that link Caesar-shifted;
 *   the plain URL works as long as the request carries the XHR header the
 *   site's own script sends — without it the controller answers 500.
 * - Each tile's `data-gtm-enhancedecommerce-impression` JSON has brand, name,
 *   gender, stock, category path, `price` (the ORIGINAL price) and `discount`
 *   (the markdown AMOUNT, not a percent); `data-cnstrc-item-price` is the price
 *   paid. The strike-through `content` agrees with `price`. Prices are major
 *   units in the market's currency (incl. VAT).
 * - A tile is one variant (one size/shade), so no size list is collected.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { attrOf, decodeEntities, jsonOf } from "./_sfcchtml";

export const FACES_MARKETS: Partial<Record<CountryCode, { host: string; site: string; locale: string }>> = {
  AE: { host: "https://www.faces.ae", site: "Faces_AE", locale: "en_AE" },
  SA: { host: "https://www.faces.sa", site: "Faces_SA", locale: "en_SA" },
};

const PAGE = 48;
const MAX_PAGES = 30;
const CAP = Number(process.env.FACES_MAX_PRODUCTS ?? 1500);

const GENDER: Record<string, ProductRecord["gender"]> = { WOMEN: "kadin", MEN: "erkek", KIDS: "cocuk" };

export function facesGridUrl(country: CountryCode, start: number): string | null {
  const m = FACES_MARKETS[country];
  if (!m) return null;
  return `${m.host}/on/demandware.store/Sites-${m.site}-Site/${m.locale}/Search-UpdateGrid?cgid=beauty-sale&start=${start}&sz=${PAGE}`;
}

const MARK: Record<string, string> = {
  acute: "\u0301", grave: "\u0300", circ: "\u0302", uml: "\u0308", tilde: "\u0303", cedil: "\u0327", ring: "\u030a",
};
/** decodeEntities + the accented-letter entities it does not know ("&ocirc;" → "ô"). */
export const facesText = (s: string): string =>
  decodeEntities(s)
    .replace(/&([a-z])(acute|grave|circ|uml|tilde|cedil|ring);/gi, (_, c: string, k: string) => c + MARK[k.toLowerCase()])
    .normalize("NFC");

const money = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

/** Parse one grid page into records. Pure. Only marked-down tiles are kept. */
export function parseFacesGrid(country: CountryCode, html: string): ProductRecord[] {
  const m = FACES_MARKETS[country];
  if (!m) return [];
  const out: ProductRecord[] = [];
  for (const block of html.split('class="js-product-tile-container').slice(1)) {
    const tag = block.slice(0, block.indexOf(">", block.indexOf("data-cnstrc-item-price")) + 1) || block;
    const imp = jsonOf<any[]>(attrOf(tag, "data-gtm-enhancedecommerce-impression") ?? "")?.[0];
    if (!imp?.item_id) continue;
    const orig = money(imp.price);
    const cnstrc = money(attrOf(tag, "data-cnstrc-item-price"));
    const paid = Number.isFinite(cnstrc) && cnstrc > 0 ? cnstrc : orig - money(imp.discount);
    if (!(paid > 0) || !(orig > paid)) continue;
    const href = block.match(/href="(\/[a-z]{2}\/p\/[^"]+\.html)"/)?.[1];
    if (!href) continue;
    const imgs = [...block.matchAll(/srcset="([^"\s]+)/g)]
      .map((x) => decodeEntities(x[1]).replace(/\?sw=\d+&sh=\d+/, "?sw=800&sh=800"))
      .filter((u) => /\/dw\/image\//.test(u));
    // The JSON's strings are entity-encoded a second time ("Lanc&ocirc;me").
    const brand = facesText(String(imp.item_brand ?? "")).trim();
    const name = facesText(String(imp.item_name ?? "")).replace(/\s+/g, " ").trim();
    const size = String(imp.item_size ?? "").replace(/\s+/g, " ").trim();
    const category =
      [imp.item_category3, imp.item_category2, imp.item_category].map((c) => String(c ?? "").trim()).find(Boolean) ??
      null;
    out.push({
      brand: "faces",
      country,
      externalId: String(imp.item_id),
      name: [brand, name, size].filter(Boolean).join(" "),
      url: `${m.host}${href}`,
      imageUrl: imgs[0] ?? null,
      images: cleanGallery(imgs, imgs[0] ?? null),
      price: toMinor(paid),
      listPrice: toMinor(orig),
      currency: COUNTRIES[country].currency,
      inStock: imp.item_in_stock !== false,
      barcodes: /^\d{12,14}$/.test(String(imp.item_variant ?? "")) ? [String(imp.item_variant)] : null,
      category,
      gender: GENDER[String(imp.item_gender ?? "").toUpperCase()] ?? null,
      variants: null,
      groupKey: null,
      colorName: imp.item_color ? String(imp.item_color) : null,
    });
  }
  return out;
}

const total = (html: string): number => Number(html.match(/class="total[^"]*">\s*([\d,]+)/)?.[1]?.replace(/,/g, "") ?? 0);

export async function listFaces(country: CountryCode): Promise<ProductRecord[]> {
  const m = FACES_MARKETS[country];
  if (!m) return [];
  const byId = new Map<string, ProductRecord>();
  let count = Infinity;
  for (let page = 0; page < MAX_PAGES && page * PAGE < count; page++) {
    if (page > 0) await new Promise((r) => setTimeout(r, 700));
    const html = await getText(facesGridUrl(country, page * PAGE)!, {
      country,
      headers: { "X-Requested-With": "XMLHttpRequest", Referer: `${m.host}/en/beauty-sale` },
    });
    if (page === 0) count = total(html) || PAGE * MAX_PAGES;
    const rows = parseFacesGrid(country, html);
    const tiles = html.split('class="js-product-tile-container').length - 1;
    for (const r of rows) byId.set(r.externalId, r);
    if (tiles === 0) break;
  }
  const off = (r: ProductRecord) => (r.listPrice! - r.price) / r.listPrice!;
  const all = [...byId.values()].sort((a, z) => Number(z.inStock) - Number(a.inStock) || off(z) - off(a));
  return all.slice(0, CAP);
}
