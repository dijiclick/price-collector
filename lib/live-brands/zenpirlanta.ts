/**
 * Zen Pırlanta by url (`zenpirlanta.com/urun/<slug>-<code>`). The site is
 * behind a Cloudflare challenge, so this asks the shopping assistant's product
 * API the collector reads (packages/collector/src/brands/zenpirlanta.ts), with
 * the same price rule and id (`productCode`).
 *
 * The API has no lookup by url or product code. The url's trailing code is the
 * product code for most rows (3,513 of 4,000 sampled) and otherwise the code
 * of a set it belongs to, so the resolver tries `set_code` = that code (one
 * request), then the discounted walk the collector does (a few requests), and
 * matches on the url. A full-price product outside a set is not reachable this
 * way and resolves to null.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, dispatcher, toMinor } from "../live-http";

const SITE = "https://www.zenpirlanta.com";
const ENDPOINT = "https://ecommerce-api-xgkluach6a-ew.a.run.app/api/chat/products";
const PAGE_SIZE = 50;
const MAX_PAGES = 6;

export interface ZenRef {
  path: string;
  code: string;
}

export function zenRefFromUrl(url: string): ZenRef | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!u.hostname.toLowerCase().endsWith("zenpirlanta.com")) return null;
  const m = u.pathname.match(/^\/urun\/([^/?#]*-(\d{6,}))\/?$/i);
  return m ? { path: `/urun/${m[1].toLowerCase()}`, code: m[2] } : null;
}

/** The API row that IS the pasted product, or null. Pure. */
export function pickZenRow(rows: any[], ref: ZenRef): any | null {
  const pathOf = (u: unknown) => {
    try { return new URL(String(u)).pathname.replace(/\/$/, "").toLowerCase(); } catch { return null; }
  };
  return rows.find((p) => pathOf(p?.url) === ref.path) ?? rows.find((p) => String(p?.productCode) === ref.code) ?? null;
}

/** Map one API row, same rules as the collector's mapZen. Pure. */
export function mapZenLive(p: any): LiveProduct | null {
  const price = Number(p?.price);
  const url = typeof p?.url === "string" ? p.url.split("?")[0] : "";
  if (!p?.productCode || !p?.title || !url.startsWith(SITE) || !Number.isFinite(price) || price <= 0) return null;
  const rate = Number(p.discountRate);
  const original = Number(p.originalPrice);
  const list =
    Number.isFinite(original) && original > price ? original
    : Number.isFinite(rate) && rate > 0 && rate < 90 ? Math.round(price / (1 - rate / 100) / 10) * 10
    : null;
  const category = String(p.category ?? "").trim();
  const sub = String(p.subCategory ?? "").trim();
  const g = [category, sub, p.title].join(" | ").toLocaleLowerCase("tr");
  const gender = /çocuk|bebek/.test(g) ? "cocuk" : /erkek/.test(g) ? "erkek" : /kadın|bayan/.test(g) ? "kadin" : null;
  return {
    brand: "zenpirlanta",
    externalId: String(p.productCode),
    name: String(p.title).trim(),
    url,
    imageUrl: typeof p.imageUrl === "string" ? p.imageUrl : null,
    price: toMinor(price),
    listPrice: list != null ? toMinor(list) : null,
    inStock: p.stock == null || Number(p.stock) > 0,
    category: sub || category || null,
    type: null,
    gender,
    colorName: typeof p.color === "string" && p.color.trim() ? p.color.trim() : null,
    country: "TR",
    currency: "TRY",
  };
}

async function page(filters: Record<string, unknown>, skip: number): Promise<any[] | null> {
  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA, Origin: SITE, Referer: `${SITE}/` },
      body: JSON.stringify({ filters, skip, limit: PAGE_SIZE, conversationId: "", is_visual_search: false }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(countryFor("zenpirlanta")),
    });
    if (!r.ok) {
      console.warn(`live-lookup: zen product API refused with HTTP ${r.status}`);
      return null;
    }
    const rows = await r.json();
    return Array.isArray(rows) ? rows : null;
  } catch (err) {
    console.warn(`live-lookup: zen product API unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function zenpirlantaUrl(url: string): Promise<LiveProduct | null> {
  const ref = zenRefFromUrl(url);
  if (!ref) return null;
  const set = await page({ set_code: ref.code }, 0);
  const hit = set && pickZenRow(set, ref);
  if (hit) return mapZenLive(hit);
  for (let n = 0; n < MAX_PAGES; n++) {
    const rows = await page({ discount_rate: { min: 1 } }, n * PAGE_SIZE);
    if (!rows) return null;
    const row = pickZenRow(rows, ref);
    if (row) return mapZenLive(row);
    if (rows.length < PAGE_SIZE) break;
  }
  return null;
}
