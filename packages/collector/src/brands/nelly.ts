/**
 * Nelly — Nordic women's fashion e-tailer (nelly.com/no), Norway, 2026-10-11.
 *
 * nelly.com itself sits behind a Cloudflare challenge (403 to plain requests,
 * runner and Mac alike), but its product lists come from Voyado Elevate
 * (Apptus eSales), which the site's browser code calls DIRECTLY on Elevate's
 * own host — not behind Nelly's wall. The cluster id (`w67A8630F`) and market
 * names (`Nelly_Norway`, locale `nb-NO`) are public constants in the site's JS
 * bundle. Customer/session keys are just random UUIDs the SDK mints per
 * visitor. Plain POST, no key, no cookie, no proxy (GitHub runner probe 200).
 *
 *   POST https://w67A8630F.api.esales.apptus.cloud/api/storefront/v3/queries/
 *        landing-page?market=Nelly_Norway&locale=nb-NO&touchpoint=desktop
 *        &customerKey=…&sessionKey=…&pageReference=/klar/&sort=DISCOUNT
 *        &limit=200&skip=0
 *
 * `pageReference` is a navigation-tree path (/klar/, /sko/, …); there is no
 * single "sale" page, so each top-level department is read sorted by DISCOUNT
 * (markdowns first) until a page stops yielding markdowns. Every product (one
 * colour) carries per-size variants with their own `sellingPrice` /
 * `listPrice` and `stockNumber` — the price is taken from a reduced variant so
 * a size range never reads as a fake strikethrough. Member prices are ignored.
 */
import { randomUUID } from "node:crypto";
import { cleanGallery, type Availability, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const ORIGIN = "https://nelly.com";
const CLUSTER = "https://w67A8630F.api.esales.apptus.cloud/api/storefront/v3/queries";

/** Per-market Elevate settings (from the site's own locale table). */
export const NELLY_MARKETS: Partial<Record<CountryCode, { market: string; locale: string; departments?: string[] }>> = {
  NO: { market: "Nelly_Norway", locale: "nb-NO" },
  // 2026-10-21: same cluster; the department paths are localised per market.
  SE: { market: "Nelly_Sweden", locale: "sv-SE", departments: ["/klader/", "/skor/", "/badklader/", "/underklader/", "/accessoarer/", "/sport/"] },
  FI: { market: "Nelly_Finland", locale: "fi-FI", departments: ["/vaatteet/", "/kengat/", "/uima-asut/", "/alusvaatteet/", "/asusteet/", "/urheilu/"] },
  DK: { market: "Nelly_Denmark", locale: "da-DK", departments: ["/toj/", "/sko/", "/badetoj/", "/undertoj/", "/accessories/", "/sport/"] },
};

/** Top-level departments of the navigation tree, read in this order. */
const DEPARTMENTS = ["/klar/", "/sko/", "/badetoy/", "/undertoy/", "/accessories/", "/sport/"];
const LIMIT = 200;
const MAX_REQUESTS = 30;
/** Stop a department once a page brings fewer than this many markdowns. */
const MIN_YIELD = 5;
const PAUSE_MS = Number(process.env.NELLY_PAUSE_MS ?? 600);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const num = (x: unknown): number => (typeof x === "number" ? x : parseFloat(String(x ?? "")));

const SIZE_ABBR: Record<string, string> = {
  "xxx-small": "XXXS",
  "xx-small": "XXS",
  "x-small": "XS",
  small: "S",
  medium: "M",
  large: "L",
  "x-large": "XL",
  "xx-large": "XXL",
  "xxx-large": "XXXL",
  "one size": "One Size",
};
export const nellySize = (label: string): string => SIZE_ABBR[label.trim().toLowerCase()] ?? label.trim();

function availability(v: any): Availability {
  const n = num(v?.stockNumber);
  if (v?.inStock === false || (Number.isFinite(n) && n <= 0)) return "out_of_stock";
  return Number.isFinite(n) && n <= 3 ? "low_on_stock" : "in_stock";
}

/** Deepest "A>B>C" categoryNode label → "C". */
export function nellyCategory(custom: any): string | null {
  const nodes: any[] = Array.isArray(custom?.categoryNode) ? custom.categoryNode : [];
  let best = "";
  for (const n of nodes) {
    const l = String(n?.label ?? "");
    if (l.split(">").length > best.split(">").length) best = l;
  }
  const leaf = best.split(">").pop()?.trim();
  return leaf || null;
}

/** Map one Elevate product (one colour). Pure. Returns only real markdowns. */
export function mapNelly(p: any, country: CountryCode = "NO", groupSize = 1, groupKey?: string): ProductRecord | null {
  const key = String(p?.key ?? "").trim();
  const title = String(p?.title ?? "").trim();
  const link = typeof p?.link === "string" ? p.link : null;
  if (!key || !title || !link) return null;
  const variants: any[] = Array.isArray(p?.variants) ? p.variants : [];

  // The cheapest reduced variant, its own list price — never min/max across sizes.
  let price = Infinity;
  let list = 0;
  for (const v of variants) {
    const sp = num(v?.sellingPrice);
    const lp = num(v?.listPrice);
    if (Number.isFinite(sp) && Number.isFinite(lp) && sp > 0 && lp > sp && sp < price) {
      price = sp;
      list = lp;
    }
  }
  if (!variants.length) {
    // No variant rows: only trust a product-level reduction without a range.
    const sp = num(p?.sellingPrice?.min);
    const lp = num(p?.listPrice?.min);
    if (num(p?.sellingPrice?.max) === sp && num(p?.listPrice?.max) === lp && lp > sp && sp > 0) {
      price = sp;
      list = lp;
    }
  }
  if (!Number.isFinite(price)) return null;

  const imgs: string[] = (Array.isArray(p?.imageInfo?.images) ? p.imageInfo.images : [])
    .map((im: any) => im?.sources?.[0]?.url)
    .filter((u: unknown): u is string => typeof u === "string");
  const first = imgs[0] ?? (typeof p?.imageInfo?.thumbnail === "string" ? p.imageInfo.thumbnail : null);
  const sizes = variants
    .filter((v) => typeof v?.label === "string" && v.label.trim())
    .map((v) => ({ label: nellySize(v.label), availability: availability(v) }));
  const color = (Array.isArray(p?.custom?.filterColor) ? p.custom.filterColor[0]?.label : null) ?? null;
  const brand = String(p?.brand ?? "").trim();
  const name = brand && brand.toLowerCase() !== "nelly" && !title.toLowerCase().startsWith(brand.toLowerCase())
    ? `${brand} ${title}`
    : title;

  return {
    brand: "nelly",
    country,
    externalId: key,
    name,
    url: `${ORIGIN}${link.startsWith("/") ? "" : "/"}${link}`,
    imageUrl: first,
    images: cleanGallery(imgs, first),
    price: toMinor(price),
    listPrice: toMinor(list),
    currency: COUNTRIES[country].currency,
    inStock: p?.inStock === true || sizes.some((s) => s.availability !== "out_of_stock"),
    category: nellyCategory(p?.custom),
    gender: "kadin",
    variants: sizes.length ? { colors: color ? [color] : [], sizes } : null,
    colorName: typeof color === "string" ? color : null,
    groupKey: groupKey && groupSize > 1 ? `nelly:${groupKey}` : null,
  };
}

/** All products of one landing-page response, with their group size. */
export function productsOf(d: any): { p: any; groupSize: number; groupKey?: string }[] {
  const groups: any[] = d?.primaryList?.productGroups ?? [];
  const out: { p: any; groupSize: number; groupKey?: string }[] = [];
  for (const g of groups) {
    const ps: any[] = Array.isArray(g?.products) ? g.products : [];
    for (const p of ps) out.push({ p, groupSize: ps.length, groupKey: g?.key != null ? String(g.key) : undefined });
  }
  return out;
}

export async function listNelly(country: CountryCode, cap = 1500): Promise<ProductRecord[]> {
  const m = NELLY_MARKETS[country];
  if (!m) return [];
  const qs = new URLSearchParams({
    market: m.market,
    locale: m.locale,
    touchpoint: "desktop",
    customerKey: randomUUID(),
    sessionKey: randomUUID(),
    presentCustom: "categoryNode|filterColor",
    sort: "DISCOUNT",
    limit: String(LIMIT),
  });
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  const page = async (ref: string, skip: number) => {
    if (requests > 0) await sleep(PAUSE_MS);
    requests++;
    const url = `${CLUSTER}/landing-page?${qs}&pageReference=${encodeURIComponent(ref)}&skip=${skip}`;
    return getJson<any>(url, { method: "POST", body: "{}", headers: { "Content-Type": "text/plain" }, country });
  };

  let anyHits = false;
  for (const ref of m.departments ?? DEPARTMENTS) {
    for (let skip = 0; requests < MAX_REQUESTS && byId.size < cap * 1.2; skip += LIMIT) {
      const d = await page(ref, skip).catch(() => null);
      const rows = productsOf(d);
      if (!rows.length) break;
      anyHits = true;
      let fresh = 0;
      for (const { p, groupSize, groupKey } of rows) {
        const r = mapNelly(p, country, groupSize, groupKey);
        if (r && !byId.has(r.externalId)) {
          byId.set(r.externalId, r);
          fresh++;
        }
      }
      const total = Number(d?.primaryList?.totalHits ?? 0);
      if (fresh < MIN_YIELD || skip + LIMIT >= total) break;
    }
  }
  if (!anyHits) throw new Error(`nelly/${country}: Elevate returned no products`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
}
