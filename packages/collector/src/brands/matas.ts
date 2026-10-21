/**
 * Matas — Denmark's beauty and personal-care chain (matas.dk), 2026-10-21.
 *
 * matas.dk renders each product list server-side and hands the page's whole
 * view-model to React inline: `React.createElement(Components.ProductListPage,
 * {"model":{…}})`. Reading that JSON out of the HTML is the route (GitHub
 * runner probe 39634668018: 200, no proxy).
 *
 *   GET /tilbud/gruppe/<makeup|hudpleje|dufte|haar-styling|maend>
 *       ?pagesize=90&sort=savings_percentage&page=N
 *
 * Only plain markdowns pass. Matas' "tilbud" list is mostly offers that are
 * NOT a price the shopper gets by buying one item:
 *   - Club Matas member prices (`priceLabel.type: "ClubMatasOnlyPrice"`,
 *     before-label "Ikke medlem") — need a membership;
 *   - multi-buy ("Uden kampagne" before-label, "Mix 2", "Køb 2 spar 25%");
 *   - minimum-spend prices (`campaignInfo.priceConditions` set, e.g. "Pris
 *     pr. stk ved køb for min. 100 kr.").
 * What is left carries the before-label "Førpris" (the shop's own previous
 * price). Sorted by savings, those cluster in the first pages of each group
 * (measured 2026-10-21: makeup 46+105 of the first 360, hudpleje 101 of 180,
 * hår 66 of 180, then ~1 per page), so a group stops at the first page that
 * brings fewer than MIN_YIELD of them. Pages are ~2 MB of HTML each (~35 MB a run).
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const ORIGIN = "https://www.matas.dk";
const GROUPS: { path: string; gender: ProductRecord["gender"] }[] = [
  { path: "makeup", gender: null },
  { path: "hudpleje", gender: null },
  { path: "dufte", gender: null },
  { path: "haar-styling", gender: null },
  { path: "maend", gender: "erkek" },
];
const PAGE_SIZE = 90;
const MAX_PAGES_PER_GROUP = 8;
const MIN_YIELD = 3;
const PAUSE_MS = Number(process.env.MATAS_PAUSE_MS ?? 800);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MARKER = "React.createElement(Components.ProductListPage, ";

/** Top-level categories that are not beauty/personal care. */
const OFF_SCOPE = /^(medicin|helse|sundhed|bolig|mor\s*&\s*barn|sport|mad|dyr)/i;

/** "1.299,95 kr." → 1299.95; unit prices ("3,33 kr./stk.") → NaN. */
export function kroner(s: unknown): number {
  if (typeof s !== "string" || s.includes("/")) return NaN;
  const t = s.replace(/[^\d.,]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : NaN;
}

/** The page's ProductListPage model, or null. */
export function matasModel(html: string): any | null {
  const at = html.indexOf(MARKER);
  if (at < 0) return null;
  const start = at + MARKER.length;
  // The props object ends where React.createElement's argument list closes;
  // find the matching brace by scanning (strings may hold braces).
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1))?.model ?? null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** True only for a plain markdown against the shop's own "Førpris". */
export function matasIsMarkdown(pi: any): boolean {
  if (!pi?.isOnDiscount || pi.priceLabel || pi.priceBeforeLabel !== "Førpris") return false;
  if (pi.campaignInfo?.priceConditions) return false;
  return Number(pi.minimumSalesQuantity ?? 1) <= 1;
}

/** Map one ProductListItemModel. Pure. Returns only real markdowns. */
export function mapMatas(i: any, gender: ProductRecord["gender"] = null, country: CountryCode = "DK"): ProductRecord | null {
  if (i?.$type !== "ProductListItemModel" || i.isSponsored) return null;
  const id = i.id != null ? String(i.id) : "";
  const name = String(i.standardName ?? "").trim();
  const path = i.linkAction?.url;
  if (!id || !name || typeof path !== "string" || !matasIsMarkdown(i.priceInfo)) return null;
  const price = kroner(i.priceInfo.price);
  const was = kroner(i.priceInfo.priceBefore);
  if (!(price > 0) || !(was > price)) return null;
  const category: string | null = i.dataLayerDto?.viewEvents?.[0]?.ecommerce?.impressions?.[0]?.category ?? null;
  if (category && OFF_SCOPE.test(category)) return null;
  const maker = (i.listName?.lines ?? []).find((l: any) => l?.type === "Brand")?.value ?? null;
  const img = typeof i.primaryImage?.url === "string" ? i.primaryImage.url : null;
  return {
    brand: "matas",
    country,
    externalId: id,
    name,
    url: `${ORIGIN}${path}`,
    imageUrl: img,
    images: cleanGallery([img], img),
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: COUNTRIES[country].currency,
    inStock: i.inStock === true,
    barcodes: typeof i.ean === "string" && /^\d{8,14}$/.test(i.ean) ? [i.ean] : null,
    category: category ? category.split("/").slice(-2).join(" ") : null,
    maker: typeof maker === "string" ? maker : null,
    gender,
    variants: null,
    groupKey: null,
  };
}

export async function listMatas(country: CountryCode, cap = 1500): Promise<ProductRecord[]> {
  if (country !== "DK") return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const g of GROUPS) {
    for (let page = 1; byId.size < cap; page++) {
      if (page > MAX_PAGES_PER_GROUP) break; // the yield rule normally stops sooner
      if (requests++ > 0) await sleep(PAUSE_MS);
      const url = `${ORIGIN}/tilbud/gruppe/${g.path}?pagesize=${PAGE_SIZE}&sort=savings_percentage&page=${page}`;
      const model = matasModel(await getText(url, { country, timeoutMs: 45_000 }));
      const list = model?.productListModel?.productList;
      if (!Array.isArray(list?.items)) throw new Error(`matas/${country}: no product list on ${g.path} page ${page}`);
      let n = 0;
      for (const it of list.items) {
        const r = mapMatas(it, g.gender, country);
        if (r && !byId.has(r.externalId)) {
          byId.set(r.externalId, r);
          n++;
        }
      }
      const pages = Number(list.pagingModel?.numberOfPages ?? 1);
      if (page >= pages || n < MIN_YIELD) break;
    }
  }
  if (!byId.size) throw new Error(`matas/${country}: no markdowns found`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
}
