/**
 * Kendra Scott by url (`kendrascott.com/<path>/<id>.html`). The site is the
 * Salesforce PWA Kit behind Cloudflare; its own SLAS private-client proxy
 * hands out a guest token (`client_credentials`), and Shopper Products on the
 * Commerce API host answers one product with `perPricebook=true` — the
 * `usd-ks-list-prices` entry is the struck-through price, `price` is charged.
 * The id is the variant id (12-digit UPC), as the collector's
 * (packages/collector/src/brands/kendrascott.ts). A master url (`…/<slug>.html`)
 * resolves to its first orderable variant.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, dispatcher, json, toMinor } from "../live-http";

const SITE = "https://www.kendrascott.com";
const API = "https://fio8iwwu.api.commercecloud.salesforce.com";
const ORG = "f_ecom_bbkx_prd";
const SITE_ID = "KendraScott";

export function kendrascottIdFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)kendrascott\.com$/i.test(u.hostname)) return null;
  const id = u.pathname.match(/\/([A-Za-z0-9_-]+)\.html$/)?.[1];
  return id ? decodeURIComponent(id) : null;
}

async function guestToken(country: string): Promise<string | null> {
  try {
    const r = await fetch(`${SITE}/mobify/slas/private/shopper/auth/v1/organizations/${ORG}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, Accept: "application/json" },
      body: `grant_type=client_credentials&channel_id=${SITE_ID}`,
      signal: AbortSignal.timeout(8000),
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(country),
    });
    if (!r.ok) {
      console.warn(`live-lookup: kendrascott token refused with HTTP ${r.status}`);
      return null;
    }
    return ((await r.json()) as any)?.access_token ?? null;
  } catch (err) {
    console.warn(`live-lookup: kendrascott token unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

const listOf = (tiered: unknown): number | null => {
  if (!Array.isArray(tiered)) return null;
  const l = tiered.filter((p: any) => /list/i.test(String(p?.pricebook ?? ""))).map((p: any) => Number(p?.price)).filter((n) => Number.isFinite(n) && n > 0);
  return l.length ? Math.max(...l) : null;
};

/** Map one Shopper Products variant record. Pure. */
export function mapKendraProduct(p: any): LiveProduct | null {
  const id = String(p?.id ?? "");
  const name = String(p?.name ?? "").replace(/\s+/g, " ").trim();
  const price = Number(p?.price);
  if (!id || !name || !(price > 0) || p?.type?.master) return null;
  const list = listOf(p?.tieredPrices);
  const large = (p?.imageGroups ?? []).find((g: any) => g?.viewType === "large");
  const img = large?.images?.[0]?.disBaseLink ?? large?.images?.[0]?.link ?? null;
  const metal = typeof p?.variationValues?.metal === "string" ? p.variationValues.metal : "";
  const url = typeof p?.slugUrl === "string" && p.slugUrl.startsWith(SITE) ? p.slugUrl.split("?")[0] : `${SITE}/${id}.html`;
  return {
    brand: "kendrascott",
    externalId: id,
    name,
    url,
    imageUrl: typeof img === "string" ? img.replace("/w_500,c_fit/", "/w_1000,c_fit/") : null,
    price: toMinor(price),
    listPrice: list != null && list > price ? toMinor(list) : null,
    inStock: p?.inventory?.orderable !== false,
    category: null,
    type: null,
    gender: null,
    colorName: metal ? (metal === "RHODIUM" ? "Silver" : metal[0] + metal.slice(1).toLowerCase()) : null,
    country: "US",
    currency: "USD",
  };
}

async function product(id: string, token: string, country: string): Promise<any | null> {
  const q = new URLSearchParams({ siteId: SITE_ID, currency: "USD", expand: "prices,availability,images,variations", perPricebook: "true", allImages: "false" });
  return json<any>(
    `${API}/product/shopper-products/v1/organizations/${ORG}/products/${encodeURIComponent(id)}?${q}`,
    { Accept: "application/json", "User-Agent": UA, Authorization: `Bearer ${token}` },
    country,
  );
}

export async function kendrascottUrl(url: string): Promise<LiveProduct | null> {
  const id = kendrascottIdFromUrl(url);
  if (!id) return null;
  const country = countryFor("kendrascott", "us");
  const token = await guestToken(country);
  if (!token) return null;
  let p = await product(id, token, country);
  if (p?.type?.master) {
    const v = (p.variants ?? []).find((x: any) => x?.orderable) ?? p.variants?.[0];
    p = v?.productId ? await product(String(v.productId), token, country) : null;
  }
  return p ? mapKendraProduct(p) : null;
}
