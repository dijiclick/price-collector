/**
 * Lyko — Nordic beauty retailer (lyko.com/no), Norway, 2026-10-11.
 *
 * lyko.com is an Avensia Nitro storefront (Episerver + Voyado Elevate behind
 * the shop's own server), like Vita/KappAhl in `_avensia.ts`: a listing URL
 * answers with its page view-model as JSON when the request carries
 * `X-Requested-With: XMLHttpRequest`. No key, no cookie, no proxy (GitHub
 * runner probe + Mac both 200).
 *
 * Lyko's card model differs from Vita's, so it has its own mapper:
 *   - `price.current` is a plain number (NOK incl. VAT), the reference price
 *     sits in `price.comparisonPrices[]`.
 *   - Only `ordinary` ("Førpris") and `previous` comparison prices are real
 *     markdowns. "Combo Deal" (`isComboDealPrice`, comparison `withoutCampaign`)
 *     is a multi-buy condition ("se betingelser"), and member prices need a
 *     login — both are dropped.
 *   - `onlineStatus.interactionType` is "buy" when it can be bought; "monitor"
 *     (bevake) means sold out.
 *
 * The deals root (/no/deals-kupp, ~9k products: campaigns + outlet) sorted by
 * `discount` puts the real markdowns first (all ~440 of them inside the first
 * 1000 rows on 2026-10-11; combo deals fill the rest), so reading stops at the
 * first window that brings almost no markdowns. Paging is a window like
 * Vita: `?count=N` first (model with `totalProductCount`), then
 * `?skip=S&count=E` (a bare array; E is the END index). Beauty cards carry no
 * sizes, so `variants` stays null; shades map to `colorName`.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const ORIGIN = "https://lyko.com";
/** Deals root per market (2026-10-21: same JSON on the Swedish/Finnish/Danish paths). */
export const LYKO_PATHS: Partial<Record<CountryCode, string>> = {
  NO: "/no/deals-kupp",
  SE: "/sv/deals-fynd",
  FI: "/fi/tarjouksia-loytoja",
  DK: "/da/deals-kup",
};
const WINDOW = 500;
const MAX_REQUESTS = 30;
/** Stop once a whole window brings fewer than this many real markdowns. */
const MIN_YIELD = 5;
const PAUSE_MS = Number(process.env.LYKO_PAUSE_MS ?? 700);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const num = (x: unknown): number => (typeof x === "number" ? x : parseFloat(String(x ?? "")));
const abs = (u: unknown): string | null =>
  typeof u === "string" && u ? (/^https?:\/\//.test(u) ? u : `${ORIGIN}${u.startsWith("/") ? "" : "/"}${u}`) : null;

/** The real "before" price of a Lyko card, or null when it is not a plain markdown. */
export function lykoOriginal(price: any): number | null {
  if (!price || price.isComboDealPrice || price.isMemberPrice) return null;
  const cmp = (Array.isArray(price.comparisonPrices) ? price.comparisonPrices : []).find(
    (c: any) => c?.type === "ordinary" || c?.type === "previous",
  );
  const v = num(cmp?.value);
  return Number.isFinite(v) ? v : null;
}

/** "/no/sminke/base/cc-cream" → "Cc cream". */
export function lykoCategory(deepest: unknown): string | null {
  if (typeof deepest !== "string") return null;
  const seg = deepest.split("?")[0].split("/").filter(Boolean).pop() ?? "";
  if (!seg || /^(no|sv|fi|da)$/.test(seg)) return null;
  const t = seg.replace(/-+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : null;
}

/** Map one Lyko VariantViewModel card. Pure. Returns only real markdowns. */
export function mapLyko(p: any, country: CountryCode = "NO"): ProductRecord | null {
  const path = typeof p?.url === "string" ? p.url : null;
  const id = String(p?.code ?? "").trim();
  const name = String(p?.displayName ?? "").trim();
  if (!path || !id || !name || p?.isDigital || p?.isCharity) return null;
  const price = num(p?.price?.current);
  const orig = lykoOriginal(p?.price);
  if (!Number.isFinite(price) || price <= 0 || orig == null || !(orig > price)) return null;
  const imgs = (Array.isArray(p?.images) ? p.images : []).map((im: any) => abs(im?.url)).filter(Boolean) as string[];
  const shade = typeof p?.color === "string" && p.color.trim() ? p.color.trim() : null;
  return {
    brand: "lyko",
    country,
    externalId: id,
    name,
    url: abs(path)!,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: toMinor(orig),
    currency: COUNTRIES[country].currency,
    inStock: p?.onlineStatus?.interactionType === "buy",
    category: lykoCategory(p?.deepestCategoryUrl),
    gender: null,
    variants: null,
    colorName: shade,
    groupKey: null,
  };
}

const HEADERS = { "X-Requested-With": "XMLHttpRequest" };

export async function listLyko(country: CountryCode, cap = 1500): Promise<ProductRecord[]> {
  const PATH = LYKO_PATHS[country];
  if (!PATH) return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  const get = async (url: string) => {
    if (requests > 0) await sleep(PAUSE_MS);
    requests++;
    return getJson<any>(url, { headers: HEADERS, country });
  };
  const take = (rows: any[]): number => {
    let n = 0;
    for (const p of rows) {
      const r = mapLyko(p, country);
      if (r && !byId.has(r.externalId)) {
        byId.set(r.externalId, r);
        n++;
      }
    }
    return n;
  };

  const base = `${ORIGIN}${PATH}?sortBy=discount`;
  const first = await get(`${base}&count=${WINDOW}`);
  const firstRows: any[] = first?.products?.products ?? [];
  if (!firstRows.length) throw new Error(`lyko/${country}: ${PATH} returned no products`);
  take(firstRows);
  const total = Number(first?.products?.totalProductCount ?? 0);
  for (let skip = WINDOW; skip < total && requests < MAX_REQUESTS && byId.size < cap * 1.2; skip += WINDOW) {
    const d = await get(`${base}&skip=${skip}&count=${skip + WINDOW}`).catch(() => null);
    const list: any[] | undefined = Array.isArray(d) ? d : d?.products?.products;
    if (!Array.isArray(list) || list.length === 0) break;
    if (take(list) < MIN_YIELD) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
}
