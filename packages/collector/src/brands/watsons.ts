import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";

const BASE = "https://api.watsons.com.tr/api/v2/wtctr-spa";
const SITE = "https://www.watsons.com.tr";
const LOCALE = "lang=tr_TR&curr=TRY";
// SAP Hybris OCC behind Akamai: browser Origin/Referer are required, and the API
// 403s from datacenter/VPN egress. proxy:true routes via DATAIMPULSE_PROXY
// (residential); without that env the request goes direct and will likely 403.
const HEADERS = {
  Accept: "application/json",
  Origin: SITE,
  Referer: `${SITE}/`,
};

const MAX_PAGES = Number(process.env.WATSONS_MAX_PAGES ?? 80);
const PAGE_DELAY_MS = Number(process.env.WATSONS_PAGE_DELAY_MS ?? 300);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function occ(url: string) {
  return getJson<any>(url, { headers: HEADERS, proxy: true, retries: 1 });
}

function mapProduct(p: any, category: string | null): ProductRecord | null {
  const code = String(p.code ?? "");
  const value = p.price?.value;
  if (!code || typeof value !== "number" || value <= 0) return null;

  const img =
    p.images?.find((i: any) => i.imageType === "PRIMARY" && i.format === "product") ??
    p.images?.find((i: any) => i.imageType === "PRIMARY") ??
    p.images?.[0];
  const imageUrl = img?.url
    ? img.url.startsWith("http")
      ? img.url
      : `${SITE}${img.url}`
    : null;

  // Watsons Card (MEMBER) price is the headline discount shoppers actually get and
  // is shown prominently on-site. When it's lower than the shelf price, treat it as
  // the deal: price = member, listPrice = shelf (strikethrough).
  const member = (p.otherPrices ?? []).find((o: any) => o.priceSource === "MEMBER")?.value;
  const onSale = typeof member === "number" && member > 0 && member < value;
  return {
    brand: "watsons",
    externalId: code,
    name: p.name ?? "",
    url: p.url ? `${SITE}${p.url}` : SITE,
    imageUrl,
    price: toMinor(onSale ? member : value),
    listPrice: onSale ? toMinor(value) : null,
    currency: "TRY",
    inStock: p.stock?.stockLevelStatus !== "outOfStock",
    category,
    // groupKey is assigned in a post-pass (applyNameGroups) — see below.
  };
}

/**
 * Watsons' search API exposes no variant master — `variantsCode` is just the
 * product's own code and `variantsNumber` is 0 — so shade variants can't be
 * grouped from source ids the way other brands are. As a pragmatic fallback we
 * collapse products whose names match after dropping the trailing shade word,
 * but only when 2+ share a base of 4+ words. Distinct products almost never
 * share such a long prefix, so this catches the common wall (one lipstick in
 * several single-word shades → one "N renk" card) while leaving coded or
 * multi-word shades ungrouped rather than risk a wrong merge. The last word
 * becomes the variant's colour name for the PDP swatch list.
 */
export function applyNameGroups(records: ProductRecord[]): void {
  // Locale-robust key: source names mix Turkish casing ("Lİkit" vs "Likit") and
  // diacritics, which would split a group. Fold all i-variants to "i", lowercase,
  // then strip remaining accents (ş→s, ç→c, …) so siblings share one base.
  const norm = (s: string) =>
    s
      .replace(/[İIı]/g, "i") // İ, I, ı → i
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, ""); // strip combining accents
  const baseOf = (name: string): string | null => {
    const w = name.trim().split(/\s+/);
    return w.length >= 5 ? norm(w.slice(0, -1).join(" ")) : null;
  };
  const count = new Map<string, number>();
  for (const r of records) {
    const b = baseOf(r.name);
    if (b) count.set(b, (count.get(b) ?? 0) + 1);
  }
  for (const r of records) {
    const b = baseOf(r.name);
    if (b && (count.get(b) ?? 0) >= 2) {
      r.groupKey = "watsons:" + b;
      r.colorName = r.name.trim().split(/\s+/).at(-1) ?? null;
    }
  }
}

export const brand = "watsons";

/**
 * Walk the whole catalog with an empty query rather than seeding categories.
 * `popularTerms` only ever yields 9 distinct category codes covering 2657
 * products, so category seeding had a hard ceiling well below the catalog no
 * matter how high its cap was set — and MAX_PAGES=2 then took 904 of
 * those. The unfiltered search reports the real total (measured 2026-07:
 * totalResults=9007 over 46 pages at pageSize=200; the constant 9005 in run
 * logs is that total minus the 2 zero-price items mapProduct rejects — full
 * coverage, not clipping). MAX_PAGES=80 gives ~75% headroom for catalog
 * growth while still bounding a runaway pagination to ~16k products /
 * ~80 requests (~24s of inter-page delay).
 *
 * Kept sequential with a modest delay: 45 back-to-back requests did in fact
 * answer 200 each, but this endpoint has a history of banning fast scrapers and
 * one page a second is quick enough for a run that has 240s to play with.
 */
export async function listProducts(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  let currentPage = 0;
  let totalPages = 1;
  do {
    const url =
      `${BASE}/search?fields=FULL&searchType=PRODUCT&query=` +
      `&currentPage=${currentPage}&pageSize=200&${LOCALE}`;
    const res = await occ(url).catch(() => null);
    if (!res) break;
    for (const p of res.products ?? []) {
      const rec = mapProduct(p, p.categoryName ?? null);
      if (rec) byId.set(rec.externalId, rec);
    }
    totalPages = Math.min(res.pagination?.totalPages ?? 1, MAX_PAGES);
    currentPage++;
    await sleep(PAGE_DELAY_MS);
  } while (currentPage < totalPages);
  const records = [...byId.values()];
  applyNameGroups(records);
  return records;
}
