/**
 * Torrid (US) by url (`torrid.com/product/<slug>/<style>-<colour>.html`).
 * The store's Bloomreach index answers a keyword query on the style-colour id
 * with that one doc (verified 2026-10-18), the same index and keys the
 * collector reads (packages/collector/src/brands/torrid.ts) — torrid.com
 * itself is Cloudflare + DataDome. The id is the Bloomreach `pid`, as stored.
 */
import type { LiveProduct } from "../live-lookup";
import { countryFor, json, toMinor } from "../live-http";

const SITE = "https://www.torrid.com";
const KEYS = "account_id=6137&auth_key=rvdtznmz4nsa2xmj&domain_key=torrid";

export function torridPidFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)torrid\.com$/i.test(u.hostname)) return null;
  return u.pathname.match(/\/(\d{6,}-\d{3,})\.html$/)?.[1] ?? null;
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Map one Bloomreach doc; full-price products resolve too (listPrice null). Pure. */
export function mapTorridLive(d: any): LiveProduct | null {
  if (!d?.pid || !d?.title) return null;
  const vs: any[] = Array.isArray(d.variants) ? d.variants : [];
  const pick = vs
    .map((v) => ({ sale: num(v?.sku_sale_price), list: num(v?.sku_price) }))
    .filter((x) => x.sale != null)
    .sort((a, b) => a.sale! - b.sale!)[0];
  const price = pick?.sale ?? num(d.sale_price) ?? num(d.price);
  const list = pick?.list ?? num(d.price);
  if (price == null) return null;
  const colour = Array.isArray(d.colors) && d.colors[0] ? String(d.colors[0]).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : null;
  return {
    brand: "torrid",
    externalId: String(d.pid),
    name: String(d.title).trim(),
    url: String(d.url ?? "").startsWith("http") ? String(d.url) : `${SITE}${d.url ?? ""}`,
    imageUrl: typeof d.thumb_image === "string" ? d.thumb_image : null,
    price: toMinor(price),
    listPrice: list != null && list > price ? toMinor(list) : null,
    inStock: true,
    category: null,
    type: null,
    gender: "kadin",
    colorName: colour,
    country: "US",
    currency: "USD",
  };
}

export async function torridUrl(url: string): Promise<LiveProduct | null> {
  const pid = torridPidFromUrl(url);
  if (!pid) return null;
  const q = new URLSearchParams({
    request_type: "search",
    search_type: "keyword",
    q: pid,
    rows: "5",
    start: "0",
    fl: "pid,title,price,sale_price,url,thumb_image,colors,sku_size,sku_sale_price,sku_price",
    _br_uid_2: "uid=6137000000000",
    url: SITE,
    ref_url: SITE,
    request_id: "1",
  });
  const body = await json<any>(`https://core.dxpapi.com/api/v1/core/?${KEYS}&${q}`, { Accept: "application/json" }, countryFor("torrid", "US"));
  const doc = (body?.response?.docs ?? []).find((d: any) => String(d?.pid) === pid);
  return doc ? mapTorridLive(doc) : null;
}
