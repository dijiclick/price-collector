/**
 * Torrid (US) — the store's own Bloomreach Discovery index (2026-10-18).
 *
 * torrid.com is Salesforce behind Cloudflare + DataDome: every page answers a
 * GitHub runner (and our Hetzner box) with a 403, whatever the User-Agent.
 * Its product search does not run through the site: the Android app
 * (`com.torrid.android`) and the site both query Bloomreach directly, and the
 * app ships the public keys (`account_id=6137`, `auth_key`, `domain_key=torrid`).
 * `core.dxpapi.com` has no bot wall and answers a runner with a plain request
 * (probe 39135972660).
 *
 * The sale tree is the category `Sale_Clearance` (~5,000 style-colours). Each
 * doc is one colour (`pid` = `<style>-<colour>`), its `variants` are the sizes,
 * each carrying its own `sku_price` / `sku_sale_price`. The deal is the cheapest
 * size's pair, read from the SAME size — never a doc-level min against a max.
 * Kept only when sale < list. No per-size stock in the index (only sellable
 * sizes are indexed), so variants carry sizes without availability claims.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "torrid";

const SITE = "https://www.torrid.com";
const KEYS = "account_id=6137&auth_key=rvdtznmz4nsa2xmj&domain_key=torrid";
const CATEGORY = "Sale_Clearance";
const ROWS = 200;
const CAP = 1500;
const MAX_REQ = 10;
const FIELDS = "pid,title,price,sale_price,url,thumb_image,large_image,colors,sizes,sku_size,sku_sale_price,sku_price,sku_color,skuid";

export function torridUrl(start: number, rows = ROWS): string {
  const p = new URLSearchParams({
    request_type: "search",
    search_type: "category",
    q: CATEGORY,
    fl: FIELDS,
    rows: String(rows),
    start: String(start),
    _br_uid_2: "uid=6137000000000",
    url: SITE,
    ref_url: SITE,
    request_id: "1",
  });
  return `https://core.dxpapi.com/api/v1/core/?${KEYS}&${p}`;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** One Bloomreach doc (one colour) → a record, or null when it is not a real markdown. */
export function mapTorridDoc(d: any): ProductRecord | null {
  const id = String(d?.pid ?? "").trim();
  const name = String(d?.title ?? "").trim();
  if (!id || !name) return null;
  const vs: any[] = Array.isArray(d?.variants) ? d.variants : [];
  // The cheapest size, with ITS list price.
  const priced = vs
    .map((v) => ({ v, sale: num(v?.sku_sale_price), list: num(v?.sku_price) }))
    .filter((x) => x.sale != null && x.list != null)
    .sort((a, b) => a.sale! - b.sale!);
  const sale = priced.length ? priced[0].sale : num(d?.sale_price);
  const list = priced.length ? priced[0].list : num(d?.price);
  if (sale == null || list == null || sale >= list) return null;
  const path = String(d?.url ?? "");
  const url = /^https?:\/\//.test(path) ? path : `${SITE}${path.startsWith("/") ? "" : "/"}${path}`;
  const img = String(d?.thumb_image ?? (Array.isArray(d?.large_image) ? d.large_image[0] : "") ?? "") || null;
  const sizes = [...new Set(vs.map((v) => String(v?.sku_size ?? "").trim()).filter(Boolean))];
  const colour = Array.isArray(d?.colors) && d.colors[0] ? titleCase(String(d.colors[0])) : null;
  return {
    brand,
    country: "US",
    externalId: id,
    name,
    url,
    imageUrl: img,
    images: cleanGallery(Array.isArray(d?.large_image) ? d.large_image : [], img),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency: "USD",
    inStock: true,
    category: null,
    gender: "kadin",
    variants: sizes.length ? { colors: colour ? [colour] : [], sizes: sizes.map((label) => ({ label, availability: "in_stock" as const })) } : null,
    groupKey: id.includes("-") ? `torrid:${id.split("-")[0]}` : null,
    colorName: colour,
  };
}

export async function listProducts(country: CountryCode = "US"): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const byId = new Map<string, ProductRecord>();
  for (let start = 0, req = 0; req < MAX_REQ && byId.size < CAP; start += ROWS, req++) {
    if (req) await new Promise((r) => setTimeout(r, 400));
    const d = await getJson<any>(torridUrl(start), { country, headers: { Accept: "application/json" } });
    const docs: any[] = d?.response?.docs ?? [];
    for (const doc of docs) {
      const r = mapTorridDoc(doc);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (!docs.length || start + ROWS >= (d?.response?.numFound ?? 0)) break;
  }
  return [...byId.values()].slice(0, CAP);
}
