/**
 * Aritzia (US + Canada) through the Algolia index its own storefront searches.
 *
 * aritzia.com is Salesforce PWA Kit behind Cloudflare ("Just a moment" on every
 * HTML page), but the product grid is served by Algolia with a public,
 * search-only key that sits in the page config (`__CONFIG__.app.sites[].algolia`).
 * Algolia answers a plain GET from a GitHub runner — no proxy (probe runs
 * 38129294052 and 38129880176, 2026-10-11).
 *
 * One hit is one colour of one product. `distinct=false` lists every colour,
 * `onSale:true` keeps the reduced ones, and `_tags:is_not_duplicate` drops the
 * copies Algolia keeps for merchandising. Each hit's own colour is found in
 * `selectableColors` (keyed by colour id), which carries that colour's list and
 * sale price in the market's currency and its size run vs. shippable sizes —
 * i.e. real per-size stock for restock alerts.
 *
 * Algolia stops paginating at 1,000 hits, and Canada's sale is ~1,070 colours,
 * so the sale is fetched in discount slices that are each well under that.
 * The house labels (Wilfred, Babaton, Tna, Golden, Sunday Best, ...) and the
 * third-party brands Aritzia sells all count as the Aritzia shop.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "aritzia";

const APP_ID = "SONLJM8OH6";
const API_KEY = "1455bca7c6c33e746a0f38beb28422e6"; // public search-only key from the storefront config
const HOST = `https://${APP_ID}-dsn.algolia.net`;
// f_jpg, not f_auto: f_auto answers AVIF to clients that accept it, which
// older Android image decoders cannot read.
// curl / node / python / JDK get a Cloudflare 403 on these (TLS fingerprint),
// but iOS NSURLSession, Android OkHttp, Chrome and check-host.net from 8
// countries all get 200 (2026-10-22) — test photos with a real client.
const IMG = "https://assets.aritzia.com/image/upload/c_crop,ar_1920:2623,g_south/q_auto,f_jpg,w_1200/";

export const ARITZIA_MARKETS: Partial<Record<CountryCode, { index: string; site: string; prefix: string }>> = {
  US: { index: "production_ecommerce_aritzia__Aritzia_US__products__en_US", site: "https://www.aritzia.com/us/en", prefix: "usd" },
  CA: { index: "production_ecommerce_aritzia__Aritzia_CA__products__en_CA", site: "https://www.aritzia.com/en", prefix: "cad" },
};

/** Each slice must stay under Algolia's 1,000-hit pagination limit. */
const SLICES = ["price.discount < 40", "price.discount >= 40 AND price.discount < 60", "price.discount >= 60"];
const CAP = 1500;
const ATTRS = "objectID,masterId,c_displayName,brand,slug,color,dept,selectableColors,hierarchicalCategories,subDept";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", rsquo: "’", trade: "™", reg: "®" };
const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .trim();

export function searchUrl(country: CountryCode, slice: string): string {
  const m = ARITZIA_MARKETS[country]!;
  const p = new URLSearchParams({
    query: "",
    hitsPerPage: "1000",
    page: "0",
    distinct: "false",
    filters: `onSale:true AND _tags:is_not_duplicate AND ${slice}`,
    attributesToRetrieve: ATTRS,
    attributesToHighlight: "",
    "x-algolia-application-id": APP_ID,
    "x-algolia-api-key": API_KEY,
  });
  return `${HOST}/1/indexes/${m.index}?${p}`;
}

const priceOf = (sc: any, prefix: string, kind: "list" | "sale"): number | null => {
  const e = (sc?.prices ?? []).find((p: any) => p?.source === `${prefix}-${kind}-prices`);
  const n = Number(e?.prices?.[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function genderOf(dept: unknown): ProductRecord["gender"] {
  if (dept === "W") return "kadin";
  if (dept === "M") return "erkek";
  if (dept === "K") return "cocuk";
  return null;
}

/** Map one Algolia hit (one colour). Pure; null unless the colour is genuinely reduced. */
export function mapAritziaHit(hit: any, country: CountryCode): ProductRecord | null {
  const m = ARITZIA_MARKETS[country];
  if (!m || !hit?.masterId || !hit?.color || !hit?.slug) return null;
  const sc = (hit.selectableColors ?? []).find((s: any) => s?.colorIds && hit.color in s.colorIds);
  if (!sc) return null;
  const list = priceOf(sc, m.prefix, "list");
  const sale = priceOf(sc, m.prefix, "sale");
  if (list == null || sale == null || sale >= list) return null;

  const shippable = new Set<string>((sc.shippableSizes ?? []).map(String));
  const run: string[] = (sc.sizeRun?.length ? sc.sizeRun : sc.shippableSizes ?? []).map(String);
  const sizes: SizeVariant[] = [...new Set(run)].map((label) => ({
    label,
    availability: shippable.has(label) ? "in_stock" : "out_of_stock",
  }));

  // A colour's image list is padded with another colour's on-model shots; keep
  // only this colour's own (`..._<code>_on_a`), falling back to all of them.
  const all: string[] = Array.isArray(sc.colorIds[hit.color]) ? sc.colorIds[hit.color].map(String) : [];
  const code = String(hit.color).split("_")[0];
  const own = all.filter((id) => id.includes(`_${code}_`));
  const ids = own.length ? own : all;
  const onModel = ids.filter((id) => /_on_/.test(id));
  const photos = [...onModel, ...ids.filter((id) => !onModel.includes(id))].map((id) => IMG + id);
  const colour = typeof sc.value === "string" ? sc.value.replace(/\b\w+/g, (w: string) => w[0] + w.slice(1).toLowerCase()) : null;
  // `subDept` is the product type (Pant, Dress, T-Shirt); the category tree mixes
  // in merchandising nodes ("Shop By Length"), so it is only the fallback.
  const sub = Array.isArray(hit.subDept) ? String(hit.subDept[0] ?? "").trim() : "";
  const tree = Object.values(hit.hierarchicalCategories ?? {}).filter(
    (v): v is string => typeof v === "string" && v.startsWith("All Clothing > "),
  );
  const leaf = tree.map((v) => v.split(">")[1].trim()).find((v) => !/^shop by/i.test(v)) ?? "";
  const category = sub || leaf || null;

  return {
    brand,
    country,
    externalId: `${hit.masterId}-${hit.color}`,
    name: decode(String(hit.c_displayName ?? "")) || decode(String(hit.slug).split("/")[0].replace(/-/g, " ")),
    url: `${m.site}/product/${hit.slug}?color=${encodeURIComponent(hit.color)}`,
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency: COUNTRIES[country].currency,
    inStock: sizes.some((s) => s.availability === "in_stock"),
    category,
    gender: genderOf(hit.dept),
    variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: `aritzia-${hit.masterId}`,
    colorName: colour,
  };
}

export async function listAritzia(country: CountryCode): Promise<ProductRecord[]> {
  if (!ARITZIA_MARKETS[country]) return [];
  const byId = new Map<string, ProductRecord>();
  for (const [i, slice] of SLICES.entries()) {
    if (i > 0) await sleep(800);
    const data = await getJson<any>(searchUrl(country, slice), { country });
    if (Number(data?.nbHits) > 1000) console.warn(`aritzia/${country}: slice "${slice}" has ${data.nbHits} hits; only 1000 returned`);
    for (const h of data?.hits ?? []) {
      const r = mapAritziaHit(h, country);
      if (r) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listAritzia;
