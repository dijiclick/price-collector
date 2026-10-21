/**
 * SoftMoc (softmoc.com/ca, Canada only) — multi-brand shoe store, sale only.
 *
 * The sale page fills its grid from the site's own JSON service, the same call
 * its script makes (`LoadFullPage`):
 *
 *   GET https://www.softmoc.com/ca/jsonservices/json_itemgridandfilters_1.aspx
 *       ?queryString=/ca/sale?page=N&pageType=saleshoeshop
 *       &filtersBaseJson=[{"FilterType":"P","Value":"sale"}]&...
 *
 * 108 items a page, in CAD. Each has `RegularPrice` (struck through) and
 * `SalePrice`; a row is kept only when sale < regular. `BrandName` is the maker,
 * `GenderIDs` the section, `I_HaveSoldOut` the stock flag. The payload carries
 * per-store size stock and is ~1.3 MB a page, so the walk is capped at 14 pages.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "softmoc";

const SITE = "https://www.softmoc.com";
const API = `${SITE}/ca/jsonservices/json_itemgridandfilters_1.aspx`;
const PAGES = 14;
const CAP = 1500;
const PAUSE_MS = 900;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function pageUrl(page: number): string {
  const q = new URLSearchParams({
    queryString: page > 1 ? `/ca/sale?page=${page}` : "/ca/sale",
    pageType: "saleshoeshop",
    collectionsId: "0",
    promopageId: "0",
    salePage: "0",
    filtersBaseJson: JSON.stringify([{ FilterType: "P", Value: "sale" }]),
    filtersJson: "[]",
    sortBy: "",
    storeId: "",
    getPageInfo: "1",
  });
  return `${API}?${q}`;
}

function genderOf(ids: unknown): ProductRecord["gender"] {
  const g = Array.isArray(ids) ? ids.map(String) : [];
  if (g.length && g.every((x) => /^(gir|boy|kid|gs|bs|ps|td|inf|yth|tod)/i.test(x))) return "cocuk";
  const w = g.some((x) => /^wo/i.test(x));
  const m = g.some((x) => /^m(e|n)/i.test(x));
  return w && !m ? "kadin" : m && !w ? "erkek" : null;
}

/** Map one grid item. Pure; null unless sale < regular. */
export function mapSoftMoc(x: any): ProductRecord | null {
  if (!x?.ItemID || !x?.ItemURL || x?.IsGiftCardItem) return null;
  const list = Number(x.RegularPrice);
  const price = Number(x.SalePrice);
  if (!(price > 0) || !(list > price)) return null;
  const make = String(x.OverwriteWebDisplayBrandName || x.BrandName || "").trim() || null;
  const desc = String(x.OnLineShortDesc || x.Description || "").trim();
  if (!desc) return null;
  const dash = desc.lastIndexOf(" - ");
  const title = dash > 0 ? desc.slice(0, dash) : desc;
  const colour = String(x.StyleColor_CopyFromPOS || x.Color || "").trim() || (dash > 0 ? desc.slice(dash + 3) : null);
  const img = [x.Thumbnail_X6, x.Thumbnail_X].find((u) => typeof u === "string" && u) ?? null;
  return {
    brand,
    country: "CA",
    externalId: String(x.ItemID),
    name: make && !title.toLowerCase().includes(make.toLowerCase()) ? `${make} ${title}` : title,
    url: SITE + String(x.ItemURL),
    imageUrl: img,
    images: cleanGallery([img], img),
    price: toMinor(price),
    listPrice: toMinor(list),
    currency: "CAD",
    inStock: !x.I_HaveSoldOut,
    category: typeof x.Department === "string" && x.Department ? x.Department : null,
    maker: make,
    gender: genderOf(x.GenderIDs),
    variants: null,
    groupKey: null,
    colorName: colour || null,
  };
}

export async function listSoftMoc(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "CA") return [];
  const byId = new Map<string, ProductRecord>();
  for (let page = 1; page <= PAGES; page++) {
    if (page > 1) await sleep(PAUSE_MS);
    const d = await getJson<any>(pageUrl(page), { country, retries: 1, timeoutMs: 45_000, headers: { "X-Requested-With": "XMLHttpRequest" } });
    const rows: any[] = Array.isArray(d?.results) ? d.results : [];
    if (!rows.length && page === 1) throw new Error("softmoc: sale grid returned no products");
    if (Number(d?.pagination?.CurrentPage) !== page && rows.length) throw new Error(`softmoc: asked page ${page}, got ${d?.pagination?.CurrentPage}`);
    for (const x of rows) {
      const r = mapSoftMoc(x);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (page >= Number(d?.pagination?.TotalPages ?? 0)) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listSoftMoc;
