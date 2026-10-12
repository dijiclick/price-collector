/**
 * Lacoste outside Turkey — the United States, through the same Salesforce
 * Shopper API (SCAPI) Lacoste's own North-America app reads.
 *
 * lacoste.com is SFCC behind Akamai, which refuses runners and the Mac alike.
 * The app (`com.lacoste.norcam` 1.21.0, decompiled 2026-10-12) talks to a BFF
 * at `mapp.lacoste.com/northamerica/prd/` that Akamai lets through for the
 * app's own `okhttp/4.12.0` User-Agent, with four region headers (`countryCode`,
 * `locale`, `currency`, `siteId`). `POST user/auth/oauth2/token?type=guest`
 * there hands back a SLAS guest token (30 min) for org `aaup_prd`, short code
 * `d9dziz0a` — and that token reads Salesforce's own host
 * `d9dziz0a.api.commercecloud.salesforce.com` directly (Cloudflare, no wall).
 * So one request touches Akamai; the catalogue comes from Salesforce. Probe run
 * 38229349088: token 200 and both search calls 200 from a GitHub runner.
 *
 * - The sale is category `Lacoste_Sale_US` (from the app's `content/menus/
 *   navigation`), ~2,900 colours. `htype=variation_group` gives one hit per
 *   colour with every size as a variant (`orderable` = in stock).
 * - Prices: `perPricebook=true` returns the list book `lacoste-us` (the
 *   strike-through) beside the sale book `lacoste-us-sales_app`; `price` is
 *   what the shopper pays. Ranges across sizes are dropped, not averaged.
 *   "Extra 20% off" badges (`c_lc_flagproduct`) are checkout promotions and
 *   are NOT applied.
 * - A colour hit carries size VALUES ("6"), not the names shoppers see ("7"
 *   for a men's shoe, "XL" for a polo, "12 Years"), and the mapping differs per
 *   product (a women's shoe "5" is a US 7), so one pass over the catalogue's
 *   masters (`htype=master`, `expand=variations`, ~2,800 → 15 pages) reads
 *   each product's value → name table first. It has to be the ROOT category:
 *   only 706 of the ~1,880 sale masters are themselves in the sale category.
 *   A master it still misses keeps its raw values.
 * - Canada (`FlagShipCA`) answers the same token, but this app channel sees
 *   only the list book `lacoste-ca` — no sale price exists to collect. GB/CH
 *   (`emea` BFF, org `aaqm_prd`) have no sale pricebook on at all right now
 *   (Lacoste's EU sales are seasonal). Both are left out rather than shipped
 *   empty.
 * - Photos: Lacoste's own hosts (`imagena1`/`static1`/`www.lacoste.com`,
 *   Akamai) serve only the app's okhttp UA, so an iPhone could not load them.
 *   The same paths are rewritten to Salesforce's image edge
 *   `edge.disstg.commercecloud.salesforce.com/dw/image/v2/AAUP_PRD/...`, which
 *   answers an iPhone UA, curl and a GitHub runner alike (probe run 38234940463).
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "lacoste";

interface Market {
  bff: string;
  shortCode: string;
  org: string;
  siteId: string;
  locale: string;
  cgid: string;
  /** The catalogue root: sale colours sit in the sale category, their masters mostly do not. */
  rootCgid: string;
  listBook: string;
  hreflang: string;
  site: string;
}

export const LACOSTE_MARKETS: Partial<Record<CountryCode, Market>> = {
  US: {
    bff: "https://mapp.lacoste.com/northamerica/prd",
    shortCode: "d9dziz0a",
    org: "f_ecom_aaup_prd",
    siteId: "FlagShip",
    locale: "en-US",
    cgid: "Lacoste_Sale_US",
    rootCgid: "Lacoste",
    listBook: "lacoste-us",
    hreflang: "en-us",
    site: "https://www.lacoste.com/us",
  },
};

const PAGE = 200; // SCAPI's maximum
const MAX_PAGES = 25;
const CONCURRENCY = 3;
const CAP = Number(process.env.LACOSTE_INTL_MAX_PRODUCTS ?? 1500);
const APP_UA = "okhttp/4.12.0";
/**
 * Salesforce's own image edge for the org's realm: answers any UA from any IP
 * (Lacoste's Akamai hosts admit only the app's okhttp UA, which iPhone image
 * loaders do not send). Same pattern as pandora-intl.
 */
const IMG = "https://edge.disstg.commercecloud.salesforce.com/dw/image/v2/AAUP_PRD/on/demandware.static/";
const IMG_SIZE = "sw=1000&sh=1000&sm=fit";

const appHeaders = (country: CountryCode, m: Market): Record<string, string> => ({
  "User-Agent": APP_UA,
  countryCode: country,
  locale: m.locale,
  currency: COUNTRIES[country].currency,
  siteId: m.siteId,
  "Content-Type": "application/json",
});

export function lacosteSearchUrl(country: CountryCode, kind: "variation_group" | "master", offset: number): string | null {
  const m = LACOSTE_MARKETS[country];
  if (!m) return null;
  const p = new URLSearchParams({
    siteId: m.siteId,
    currency: COUNTRIES[country].currency,
    locale: m.locale,
    limit: String(PAGE),
    offset: String(offset),
    allVariationProperties: "true",
  });
  p.append("refine", `cgid=${kind === "master" ? m.rootCgid : m.cgid}`);
  p.append("refine", `htype=${kind}`);
  if (kind === "master") {
    p.set("expand", "variations");
  } else {
    p.set("expand", "availability,images,prices,represented_products,variations,custom_properties");
    p.set("perPricebook", "true");
    p.set("allImages", "false");
  }
  return `https://${m.shortCode}.api.commercecloud.salesforce.com/search/shopper-search/v1/organizations/${m.org}/product-search?${p}`;
}

/** Per master: size value → shopper-facing name, colour code → colour name. */
export type NameTables = Map<string, { size: Map<string, string>; color: Map<string, string> }>;

export function readMasters(hits: any[], into: NameTables = new Map()): NameTables {
  for (const h of hits ?? []) {
    if (!h?.productId) continue;
    const t = { size: new Map<string, string>(), color: new Map<string, string>() };
    for (const a of h.variationAttributes ?? []) {
      const target = a?.id === "size" ? t.size : a?.id === "color" ? t.color : null;
      if (!target) continue;
      for (const v of a.values ?? []) {
        if (v?.value != null && v?.name) target.set(String(v.value), String(v.name).trim());
      }
    }
    into.set(String(h.productId), t);
  }
  return into;
}

const GENDER: Record<string, ProductRecord["gender"]> = { MAN: "erkek", WOM: "kadin", BOY: "cocuk", GIR: "cocuk", KID: "cocuk", BAB: "cocuk" };

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s/-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()).replace(/\s*\/\s*/g, " / ");

/** static1.lacoste.com / the SFCC origin → Salesforce's resizing image edge. */
export function lacostePhoto(link: string): string | null {
  const i = link.indexOf("/on/demandware.static/");
  if (i < 0) return null;
  return `${IMG}${link.slice(i + "/on/demandware.static/".length).split("?")[0]}?${IMG_SIZE}`;
}

function usUrl(rp: any, m: Market): string | null {
  try {
    const list = JSON.parse(String(rp?.c_lc_hreflang ?? "[]"));
    const hit = Array.isArray(list) ? list.find((x: any) => x?.lang === m.hreflang && typeof x.url === "string") : null;
    return hit?.url ?? null;
  } catch {
    return null;
  }
}

/**
 * A size value's shopper-facing name. The master's table lists only the sizes
 * still orderable somewhere, so a sold-out value can be missing from it; then
 * the table's own pattern decides — a constant shoe offset (UK 6 → US 7), or
 * "12A" → "12 Years" — and a value no pattern explains is DROPPED rather than
 * shown raw beside named neighbours (a raw "10.5" next to a named "10.5" would
 * be two different shoes). A master with no table at all keeps raw values.
 */
export function sizeName(value: string, table: Map<string, string> | undefined): string | null {
  if (!table || table.size === 0) return value;
  const named = table.get(value);
  if (named) return named;
  const pairs = [...table.entries()];
  const nums = pairs.filter(([v, n]) => /^\d+(\.\d+)?$/.test(v) && /^\d+(\.\d+)?$/.test(n));
  if (/^\d+(\.\d+)?$/.test(value) && nums.length && nums.length === pairs.length) {
    const deltas = new Set(nums.map(([v, n]) => Number(n) - Number(v)));
    if (deltas.size === 1) return String(Number(value) + [...deltas][0]);
  }
  const years = value.match(/^(\d+)A$/);
  if (years && pairs.some(([v, n]) => /^\d+A$/.test(v) && /Years?$/.test(n))) return `${years[1]} Years`;
  return null;
}

/** "MEN S S/S POLO" → "Polo": the product family without its section prefix. */
export function familyType(family: unknown): string | null {
  const f = String(family ?? "")
    .replace(/^(MEN|WOMEN|CHILDREN|BOYS?|GIRLS?|UNISEX|KIDS?|BABY)(\s+S)?\s+/i, "")
    .replace(/^(S\/S|L\/S)\s+/i, "")
    .trim();
  return f ? titleCase(f) : null;
}

const clean = (v: unknown): string => String(v ?? "").replace(/[\u200b-\u200d\ufeff]/g, "").trim();

/** Map one colour hit. Pure; null unless it is a genuine, single-price markdown. */
export function mapLacosteHit(hit: any, country: CountryCode, names: NameTables): ProductRecord | null {
  const m = LACOSTE_MARKETS[country];
  const id = String(hit?.productId ?? "");
  if (!m || !id || hit?.hitType !== "variation_group") return null;
  const cut = id.lastIndexOf("-");
  const master = cut > 0 ? id.slice(0, cut) : id;
  const rp = hit.representedProduct ?? {};
  const colorCode = String(rp.c_color ?? rp.c_colorCode ?? id.slice(cut + 1));

  const ranges: any[] = hit.priceRanges ?? [];
  const listR = ranges.find((r) => r?.pricebook === m.listBook);
  const saleR = ranges.filter((r) => r?.pricebook !== m.listBook);
  if (!listR || listR.minPrice !== listR.maxPrice) return null;
  if (saleR.some((r) => r.minPrice !== r.maxPrice)) return null;
  const list = Number(listR.maxPrice);
  const sale = Number(hit.price);
  if (!(list > 0) || !(sale > 0) || !(sale < list)) return null;

  const t = names.get(master);
  const seen = new Set<string>();
  const sizes: SizeVariant[] = [];
  for (const v of hit.variants ?? []) {
    const vv = v?.variationValues ?? {};
    if (vv.color != null && String(vv.color) !== colorCode) continue;
    const value = vv.size != null ? String(vv.size) : "";
    if (!value) continue;
    const label = sizeName(value, t?.size);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: v.orderable ? "in_stock" : "out_of_stock" });
  }
  const inStock = sizes.length ? sizes.some((s) => s.availability === "in_stock") : Boolean(hit.orderable);

  const details = (hit.imageGroups ?? []).find((g: any) => g?.viewType === "details") ?? (hit.imageGroups ?? [])[0];
  const photos = [...(details?.images ?? []), hit.image]
    .map((im: any) => (typeof im?.link === "string" ? lacostePhoto(im.link) : null))
    .filter((u): u is string => !!u);
  const colourRaw = t?.color.get(colorCode) ?? (Array.isArray(rp.c_searchColorName) ? rp.c_searchColorName[0] : null);
  const colour = colourRaw ? titleCase(String(colourRaw)) : null;
  const page = usUrl(rp, m);

  return {
    brand,
    country,
    externalId: id,
    name: String(hit.productName ?? "").replace(/\s+/g, " ").trim(),
    url: page ? `${page}?color=${encodeURIComponent(colorCode)}` : `${m.site}/search?q=${encodeURIComponent(master)}`,
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency: COUNTRIES[country].currency,
    inStock,
    category: clean(rp.c_lc_categorizationLabel) || clean(rp.c_Style) || familyType(rp.c_family),
    gender: GENDER[String(rp.c_lc_gender ?? "").toUpperCase()] ?? null,
    variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: `lacoste-${master}`,
    colorName: colour,
  };
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

/** Every page of one search, the first page telling how many there are. */
async function allHits(country: CountryCode, kind: "variation_group" | "master", auth: Record<string, string>): Promise<any[]> {
  const first = await getJson<any>(lacosteSearchUrl(country, kind, 0)!, { country, headers: auth });
  const total = Math.min(Number(first?.total ?? 0), PAGE * MAX_PAGES);
  const pages: any[][] = [first?.hits ?? []];
  const offsets: number[] = [];
  for (let o = PAGE; o < total; o += PAGE) offsets.push(o);
  await pool(offsets, CONCURRENCY, async (o) => {
    const d = await getJson<any>(lacosteSearchUrl(country, kind, o)!, { country, headers: auth });
    pages[o / PAGE] = d?.hits ?? [];
  });
  return pages.flat();
}

/** Women get two places for every one of each other section when the cap bites. */
const GENDER_WEIGHT: Record<string, number> = { kadin: 2, erkek: 1, cocuk: 1, null: 1 };

/**
 * In stock first; then a weighted round-robin over the sections, each in the
 * store's own order. The US sale is ~2/3 men's, so a plain "women first" sort
 * under a 1,500 cap would drop every men's polo.
 */
export function rankLacoste(rows: ProductRecord[]): ProductRecord[] {
  const seen: Record<string, number> = {};
  return rows
    .map((r, i) => {
      const g = String(r.gender);
      const k = (seen[g] = (seen[g] ?? 0) + 1);
      return { r, i, slot: k / (GENDER_WEIGHT[g] ?? 1) };
    })
    .sort((a, b) => Number(b.r.inStock) - Number(a.r.inStock) || a.slot - b.slot || a.i - b.i)
    .map((x) => x.r);
}

export async function listLacosteIntl(country: CountryCode): Promise<ProductRecord[]> {
  const m = LACOSTE_MARKETS[country];
  if (!m) return [];
  const tok = await getJson<any>(`${m.bff}/user/auth/oauth2/token?type=guest`, {
    country,
    method: "POST",
    body: "",
    headers: appHeaders(country, m),
  });
  if (!tok?.access_token) throw new Error(`lacoste/${country}: no guest token from the app BFF`);
  const auth = { Authorization: `Bearer ${tok.access_token}` };

  const names = readMasters(await allHits(country, "master", auth));
  const byId = new Map<string, ProductRecord>();
  for (const h of await allHits(country, "variation_group", auth)) {
    const r = mapLacosteHit(h, country, names);
    if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
  }
  const all = [...byId.values()];
  if (!all.length) throw new Error(`lacoste/${country}: the sale category returned no marked-down colours`);
  return rankLacoste(all).slice(0, CAP);
}
