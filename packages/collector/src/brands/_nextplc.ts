/**
 * Next plc storefronts (next.co.uk, reiss.com) through the Bloomreach
 * Discovery search API their own frontends are configured with
 * (`"accountId"`/`"domainKey"` in the home page HTML). 2026-10-11.
 *
 * Why this route: every www.next.co.uk / www.reiss.com page except the home
 * page answers a plain request with an Akamai 403, but `core.dxpapi.com` is
 * Bloomreach's public API — no key, no cookie — and serves the same catalogue
 * with `price` (was) and `sale_price` (now) in GBP.
 *
 * Discount filter: there is no "sale" facet on next.co.uk (Reiss has
 * `feat:"Sale"`), but `sort=discount desc` puts every reduced row first, so we
 * page until a page carries no reduction. Measured: Next women ~150 reduced of
 * 102k (Next itself only marks down in its two seasonal sales; out of season
 * the reductions are its third-party brands), Reiss women ~3.5k.
 *
 * Sizes: Next's product-level `sizes` lists only sellable sizes (a 70%-off
 * dress lists one size), so they are stored as in stock. Reiss leaves that
 * field empty and its per-SKU sizes are unnormalised ("1112years", "uk4eu37"),
 * with no stock flag — no sizes for Reiss rather than false restock signals.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export interface NextPlcSite {
  brand: string;
  accountId: string;
  domainKey: string;
  site: string;
  /** `next_gender` values to collect, in priority order (the cap fills front to back). */
  genders: string[];
  /** Next's titles are all lower case in the index; Reiss's are already cased. */
  titleCase: boolean;
  /** Whether product-level `sizes` is trustworthy as "sellable sizes". */
  sizes: boolean;
}

export const NEXT_SITE: NextPlcSite = {
  brand: "next", accountId: "6042", domainKey: "next", site: "https://www.next.co.uk",
  genders: ["women"], titleCase: true, sizes: true,
};
export const REISS_SITE: NextPlcSite = {
  brand: "reiss", accountId: "6647", domainKey: "reiss", site: "https://www.reiss.com",
  genders: ["women", "men"], titleCase: false, sizes: false,
};

const API = "https://core.dxpapi.com/api/v1/core/";
const ROWS = 200;
const MAX_PAGES = Number(process.env.NEXTPLC_MAX_PAGES ?? 15);
const PAUSE_MS = Number(process.env.NEXTPLC_PAUSE_MS ?? 800);
const FIELDS = "pid,title,brand,url,price,sale_price,sizes,next_gender,gender,next_category,thumb_image,large_image,variants,sku_color";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const titleCase = (s: string) => s.replace(/(^|[\s(/-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

export function genderOf(g: unknown): ProductRecord["gender"] {
  const v = (Array.isArray(g) ? g : [g]).map((x) => String(x ?? "").toLowerCase()).filter(Boolean);
  if (v.some((x) => /girl|boy|newborn|baby/.test(x))) return "cocuk";
  if (v.includes("women")) return "kadin";
  if (v.includes("men")) return "erkek";
  return null;
}

export function searchUrl(s: NextPlcSite, gender: string, start: number): string {
  const q = new URLSearchParams({
    account_id: s.accountId, domain_key: s.domainKey, request_type: "search", search_type: "keyword",
    q: "*", rows: String(ROWS), start: String(start), sort: "discount desc",
    fq: `next_gender:"${gender}"`, fl: FIELDS,
    url: s.site, ref_url: s.site, _br_uid_2: "uid=modadrop",
  });
  return `${API}?${q}`;
}

/** Map one Bloomreach doc. Pure. Prices are major-unit numbers. */
export function mapNextPlc(s: NextPlcSite, country: CountryCode, d: any): ProductRecord | null {
  const price = Number(d?.sale_price);
  const was = Number(d?.price);
  if (!d?.pid || !d?.title || !d?.url || !Number.isFinite(price) || price <= 0) return null;
  let name = decode(String(d.title)).trim();
  if (s.titleCase && name === name.toLowerCase()) name = titleCase(name);
  const imgs: string[] = [...(Array.isArray(d.large_image) ? d.large_image : []), d.thumb_image].filter(
    (u: unknown): u is string => typeof u === "string",
  );
  const sizes: SizeVariant[] = [];
  if (s.sizes) {
    const seen = new Set<string>();
    for (const raw of Array.isArray(d.sizes) ? d.sizes : []) {
      const label = String(raw ?? "").trim();
      if (!label || /^one$/i.test(label) || seen.has(label)) continue;
      seen.add(label);
      sizes.push({ label, availability: "in_stock" });
    }
  }
  const colors = [
    ...new Set(
      (Array.isArray(d.variants) ? d.variants : [])
        .map((v: any) => String(v?.sku_color ?? "").trim())
        .filter(Boolean)
        .map((c: string) => (c === c.toLowerCase() ? titleCase(c) : c)),
    ),
  ] as string[];
  const style = /\/style\/([A-Z0-9]+)\//i.exec(String(d.url))?.[1] ?? null;
  const cat = Array.isArray(d.next_category) ? d.next_category[0] : d.next_category;
  const url = String(d.url).split("#")[0];
  return {
    brand: s.brand,
    country,
    externalId: String(d.pid),
    name,
    url: url.startsWith("http") ? url : `${s.site}${url}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: Number.isFinite(was) && was > price ? toMinor(was) : null,
    currency: COUNTRIES[country].currency,
    // The search index only carries sellable products.
    inStock: true,
    category: typeof cat === "string" && cat ? titleCase(cat.toLowerCase()) : null,
    gender: genderOf(d.next_gender ?? d.gender),
    variants: sizes.length ? { colors, sizes } : null,
    groupKey: style ? `${s.brand}:${style}` : null,
    colorName: colors.length === 1 ? colors[0] : null,
  };
}

export async function listNextPlc(s: NextPlcSite, country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "GB") return [];
  const cap = 1500;
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  let lastFirst = "";
  outer: for (const gender of s.genders) {
    for (let p = 0; p < MAX_PAGES; p++) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      let data = await getJson<any>(searchUrl(s, gender, p * ROWS), { country });
      // Bloomreach occasionally answers 200 with an empty doc list (next/GB,
      // 2026-10-13: 0 products, no error, Reiss fine in the same run). An empty
      // FIRST page of a 100k-item index is a hiccup, not "no sale" — ask again.
      if (p === 0 && !(data?.response?.docs ?? []).length) {
        await sleep(PAUSE_MS * 3);
        data = await getJson<any>(searchUrl(s, gender, 0), { country });
      }
      const docs: any[] = data?.response?.docs ?? [];
      if (p === 0) lastFirst = `numFound=${data?.response?.numFound ?? "?"} docs=${docs.length}`;
      let reduced = 0;
      for (const d of docs) {
        const r = mapNextPlc(s, country, d);
        if (!r || r.listPrice == null) continue;
        reduced++;
        if (!byId.has(r.externalId)) byId.set(r.externalId, r);
        if (byId.size >= cap) break outer;
      }
      // Sorted by discount: the first page with no reduction ends the sale.
      if (reduced === 0 || docs.length < ROWS) break;
    }
  }
  // Out of season Next still carries ~60+ reduced third-party rows, so an empty
  // result is a bad answer from the API; fail loudly rather than report "no sale".
  if (!byId.size) throw new Error(`${s.brand}: Bloomreach returned no reduced rows (${lastFirst})`);
  return [...byId.values()].slice(0, cap);
}

export const listNext = (country: CountryCode) => listNextPlc(NEXT_SITE, country);
export const listReiss = (country: CountryCode) => listNextPlc(REISS_SITE, country);
