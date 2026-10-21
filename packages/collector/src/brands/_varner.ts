/**
 * Varner group (Cubus, Bik Bok, Carlings, Dressmann, Volt) — Norway, Sweden,
 * Finland (2026-10-21; Volt NO/FI only), DISCOUNTED rows only —
 * through each brand's Voyado Elevate storefront cluster (2026-10-11).
 *
 * The storefronts sit behind Cloudflare (403 on HTML for plain requests), but
 * the Elevate clusters their own browser code calls are not: a plain POST
 * with random customer/session keys answers from a GitHub runner (probe run
 * 38134822090). Cluster ids were read from the live pages' network traffic.
 *
 * `rule incl discount [1,100]` is the exact rule Bik Bok's own sale page sends
 * (`/no/tilbud/sale/`), so the API returns reduced products only; sort by
 * DISCOUNT puts the deepest first. One 100-group page carries every colour
 * with its sizes, per-size stock and per-size price — no detail calls.
 */
import { randomUUID } from "node:crypto";
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export interface VarnerBrand {
  slug: string;
  /** Elevate cluster id: https://<cluster>.elevate-api.cloud */
  cluster: string;
  site: string;
  /** Custom attributes to present: [category attribute, gender attribute?]. */
  categoryAttr: string;
  genderAttr?: string;
  defaultGender: ProductRecord["gender"];
  /** Markets the brand sells online through this cluster (NO when absent). */
  markets?: CountryCode[];
}

export const VARNER: Record<string, VarnerBrand> = {
  cubus: { slug: "cubus", cluster: "w51327962", site: "https://cubus.com", categoryAttr: "productmaincategory", genderAttr: "searchdepartment", defaultGender: null },
  bikbok: { slug: "bikbok", cluster: "wd4ecf775", site: "https://bikbok.com", categoryAttr: "productmaincategory", defaultGender: "kadin" },
  // 2026-10-21: Carlings' live pages carry cluster w3615D94A (`apptusLocal.clusterId`
  // in the HTML); webe08586 still answers but with zero reduced products.
  carlings: { slug: "carlings", cluster: "w3615d94a", site: "https://carlings.com", categoryAttr: "productmaincategory", genderAttr: "searchdepartment", defaultGender: null, markets: ["NO", "SE", "FI"] },
  dressmann: { slug: "dressmann", cluster: "w5ab6f674", site: "https://dressmann.com", categoryAttr: "productmaincategory", genderAttr: "searchdepartment", defaultGender: "erkek", markets: ["NO", "SE", "FI"] },
  volt: { slug: "volt", cluster: "wb5149640", site: "https://voltfashion.com", categoryAttr: "productmaincategory", genderAttr: "searchdepartment", defaultGender: null, markets: ["NO", "FI"] },
};

/** Elevate market + locale per country; one cluster serves all of a brand's markets. */
export const VARNER_MARKETS: Partial<Record<CountryCode, { market: string; locale: string; pageReference: string }>> = {
  NO: { market: "NO", locale: "nb-NO", pageReference: "/no/sale" },
  SE: { market: "SE", locale: "sv-SE", pageReference: "/sv/rea" },
  FI: { market: "FI", locale: "fi-FI", pageReference: "/fi/ale" },
};
/** Cubus and Bik Bok ship SE + FI too (2026-10-21). */
for (const k of ["cubus", "bikbok"]) VARNER[k].markets = ["NO", "SE", "FI"];

const PAGE = 100;
const MAX_PAGES = Number(process.env.VARNER_MAX_PAGES ?? 20);
const CAP = 1500;
const PAUSE_MS = Number(process.env.VARNER_PAUSE_MS ?? 700);
export const VARNER_DISCOUNT_RULE = "rule incl discount [1,100]";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const n = (x: unknown): number => (typeof x === "number" ? x : parseFloat(String(x ?? "")));

export function varnerUrl(b: VarnerBrand, skip: number, keys: { customer: string; session: string }, country: CountryCode = "NO"): string {
  const m = VARNER_MARKETS[country] ?? VARNER_MARKETS.NO!;
  const q = new URLSearchParams({
    market: m.market,
    locale: m.locale,
    customerKey: keys.customer,
    sessionKey: keys.session,
    touchpoint: "DESKTOP",
    pageReference: m.pageReference,
    sort: "DISCOUNT",
    limit: String(PAGE),
    skip: String(skip),
    presentCustom: [b.categoryAttr, b.genderAttr].filter(Boolean).join("|"),
  });
  return `https://${b.cluster}.elevate-api.cloud/api/storefront/v3/queries/landing-page?${q}`;
}

function sizesOf(variants: any[]): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const v of variants) {
    const label = String(v?.label ?? v?.size ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const stock = n(v?.stockNumber);
    out.push({
      label,
      availability: !v?.inStock ? "out_of_stock" : Number.isFinite(stock) && stock > 0 && stock <= 2 ? "low_on_stock" : "in_stock",
    });
  }
  return out;
}

const firstLabel = (custom: any, attr: string | undefined): { id: string; label: string } | null => {
  const v = attr ? custom?.[attr]?.[0] : null;
  return v && typeof v === "object" ? { id: String(v.id ?? ""), label: String(v.label ?? "") } : null;
};

/** Gender from Cubus' department id, else from the product link's section words. */
export function varnerGender(dept: string | null, link: string, fallback: ProductRecord["gender"]): ProductRecord["gender"] {
  const d = (dept ?? "").toUpperCase();
  if (/WOMEN|LADIES/.test(d)) return "kadin";
  if (/^MEN|\bMEN\b/.test(d)) return "erkek";
  if (/KID|BABY|GIRL|BOY|CHILD|JUNIOR|TEEN/.test(d)) return "cocuk";
  // Whole words only: "babydoll" is lingerie, not a baby section.
  const words = new Set((link.split("/").filter(Boolean).slice(-2, -1)[0] ?? "").split("-"));
  const has = (...w: string[]) => w.some((x) => words.has(x));
  if (has("baby", "barn", "gutt", "jente", "barneklar", "babyklar")) return "cocuk";
  if (has("dame", "dameklar")) return "kadin";
  if (has("herre", "herreklar")) return "erkek";
  // Swedish / Finnish link words (SE, FI markets).
  if (has("lapset", "vauvat", "pojat", "tytot", "flicka", "pojke")) return "cocuk";
  if (has("dam", "naiset", "nainen")) return "kadin";
  if (has("herr", "miehet", "mies")) return "erkek";
  return fallback;
}

/** Elevate category ids are English run-together words: "TOPSANDTSHIRTS" → "Tops and t-shirts". */
const CAT_WORDS: Record<string, string> = {
  TOPSANDTSHIRTS: "Tops and t-shirts", SWEATERSHOODIES: "Sweaters and hoodies", SWEATERSANDCARDIGANS: "Sweaters and cardigans",
  SHIRTSANDBLOUSES: "Shirts and blouses", JACKETSANDCOATS: "Jackets and coats", DRESSESANDSKIRTS: "Dresses and skirts",
  UNDERWEARANDSOCKS: "Underwear and socks", BLAZERSANDSUITS: "Blazers and suits", SPORTSWEAR: "Sportswear", NIGHTWEAR: "Nightwear",
  SWIMWEAR: "Swimwear", LOUNGEWEAR: "Loungewear",
};
export function varnerCategory(id: string | null | undefined): string | null {
  if (!id || !/^[A-Z]+$/.test(id)) return null;
  return CAT_WORDS[id] ?? id[0] + id.slice(1).toLowerCase();
}

/** Map one Elevate product (one colour of a product group). Pure. */
export function mapVarner(b: VarnerBrand, p: any, groupKey: string | null, country: CountryCode = "NO"): ProductRecord | null {
  const title = String(p?.title ?? p?.name ?? "").trim();
  const link = typeof p?.link === "string" ? p.link.split("?")[0] : null;
  if (!p?.key || !title || !link) return null;
  const vs: any[] = Array.isArray(p.variants) ? p.variants : [];
  // The price a shopper pays for the cheapest size still sold, with that size's own list price.
  const priced = vs
    .map((v) => ({ v, price: n(v?.sellingPrice), list: n(v?.listPrice) }))
    .filter((x) => Number.isFinite(x.price) && x.price > 0);
  const pick =
    [...priced].sort((a, c) => Number(!!c.v.inStock) - Number(!!a.v.inStock) || a.price - c.price)[0] ??
    { price: n(p?.sellingPrice?.min), list: n(p?.listPrice?.max) };
  if (!Number.isFinite(pick.price) || pick.price <= 0) return null;
  const imgs: string[] = (p?.imageInfo?.images ?? [])
    .map((im: any) => im?.sources?.[0]?.url)
    .filter((u: unknown): u is string => typeof u === "string");
  const sizes = sizesOf(vs);
  const cat = firstLabel(p.custom, b.categoryAttr);
  const dept = firstLabel(p.custom, b.genderAttr);
  return {
    brand: b.slug,
    country,
    externalId: String(p.key),
    name: title,
    url: `${b.site}${link}`,
    imageUrl: imgs[0] ?? p?.imageInfo?.thumbnail ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(pick.price),
    listPrice: Number.isFinite(pick.list) && pick.list > pick.price ? toMinor(pick.list) : null,
    currency: COUNTRIES[country].currency,
    inStock: p.inStock === true || vs.some((v) => v?.inStock === true),
    // NO keeps the Norwegian label; SE/FI labels are Swedish/Finnish, so they get the English id.
    category: country === "NO" ? cat?.label || null : varnerCategory(cat?.id) ?? (cat?.label || null),
    gender: varnerGender(dept?.id ?? null, link, b.defaultGender),
    variants: sizes.length ? { colors: [], sizes } : null,
    groupKey,
  };
}

export async function listVarner(slug: string, country: CountryCode): Promise<ProductRecord[]> {
  const b = VARNER[slug];
  if (!b || !(b.markets ?? ["NO"]).includes(country) || !VARNER_MARKETS[country]) return [];
  const keys = { customer: randomUUID(), session: randomUUID() };
  const body = JSON.stringify({ primaryList: { include: true, productRules: VARNER_DISCOUNT_RULE } });
  const byId = new Map<string, ProductRecord>();
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await sleep(PAUSE_MS);
    const d = await getJson<any>(varnerUrl(b, page * PAGE, keys, country), {
      method: "POST",
      body,
      headers: { "Content-Type": "text/plain;charset=UTF-8", Origin: b.site, Referer: `${b.site}/` },
      country,
    });
    const groups: any[] = d?.primaryList?.productGroups ?? [];
    if (!groups.length) break;
    for (const g of groups) {
      const prods: any[] = g?.products ?? [];
      const gk = prods.length > 1 && g?.key ? `${b.slug}:${g.key}` : null;
      for (const p of prods) {
        const r = mapVarner(b, p, gk, country);
        if (r && r.listPrice != null && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
    }
    if (byId.size >= CAP * 1.2) break;
    const total = Number(d?.primaryList?.totalHits ?? 0);
    if (total && (page + 1) * PAGE >= total) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listCubus = (country: CountryCode) => listVarner("cubus", country);
export const listBikbok = (country: CountryCode) => listVarner("bikbok", country);
export const listCarlings = (country: CountryCode) => listVarner("carlings", country);
export const listDressmann = (country: CountryCode) => listVarner("dressmann", country);
export const listVolt = (country: CountryCode) => listVarner("volt", country);
