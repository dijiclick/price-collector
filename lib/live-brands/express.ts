/**
 * Express (US) by url (`express.com/clothing/<section>/<slug>/pro/<id>`,
 * optionally `/color/<name>`). The site's own GraphQL `product(id)` with the
 * headers its Apollo client sends (Akamai refuses the POST without them —
 * see packages/collector/src/brands/express.ts). Each colour carries its own
 * per-size `displayPrice` / `displayMSRP`: the asked colour (or the cheapest
 * colour, as the collector picks) is quoted. The id is the plain product id.
 */
import type { LiveProduct } from "../live-lookup";
import { countryFor, dispatcher, toMinor } from "../live-http";

const SITE = "https://www.express.com";
const HEADERS: Record<string, string> = {
  "User-Agent": "okhttp/4.12.0",
  Accept: "*/*",
  "Content-Type": "application/json",
  "apollographql-client-name": "main-raven-apollo-client",
  "x-exp-request-id": "146b777c-0afa-43db-9745-666955f587df",
  "x-exp-rvn-cacheable": "true",
  "x-exp-rvn-query-classification": "getProduct",
  "x-exp-rvn-source": "app_express.com",
  origin: SITE,
  referer: `${SITE}/`,
};
const QUERY =
  "query ProductQuery($productId: String!) { product(id: $productId) { productId name listPrice salePrice gender productURL productImage marketPlaceProduct " +
  "colorSlices { color defaultSlice skus { displayPrice displayMSRP isInStockOnline } } } }";

export function expressIdFromUrl(url: string): { id: string; colour: string | null } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)express\.com$/i.test(u.hostname)) return null;
  const m = decodeURIComponent(u.pathname).match(/\/pro\/(\d{6,})F?(?:\/color\/([^/]+))?\/?$/i);
  return m ? { id: m[1], colour: m[2] ?? u.searchParams.get("color") } : null;
}

const money = (s: unknown) => {
  const t = String(s ?? "");
  if (/\d\s*-\s*\$?\d/.test(t)) return null;
  const n = parseFloat(t.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Map a `product` body to the asked colour, else the cheapest. Pure. */
export function mapExpressLive(p: any, colour: string | null, url: string): LiveProduct | null {
  if (!p?.productId || !p?.name || p.marketPlaceProduct) return null;
  const slices = (Array.isArray(p.colorSlices) ? p.colorSlices : []).map((c: any) => {
    const skus: any[] = Array.isArray(c?.skus) ? c.skus : [];
    const priced = skus
      .map((k) => ({ price: money(k?.displayPrice), msrp: money(k?.displayMSRP), live: k?.isInStockOnline !== false }))
      .filter((k) => k.price != null)
      .sort((a, b) => a.price! - b.price!);
    return { colour: String(c?.color ?? ""), best: priced.find((k) => k.live) ?? priced[0], inStock: priced.some((k) => k.live) };
  }).filter((s: any) => s.best);
  const want = colour?.toLowerCase();
  const pick = (want && slices.find((s: any) => s.colour.toLowerCase() === want)) || [...slices].sort((a: any, b: any) => a.best.price - b.best.price)[0];
  const price = pick?.best.price ?? money(p.salePrice) ?? money(p.listPrice);
  const list = pick?.best.msrp ?? money(p.listPrice);
  if (price == null) return null;
  const g = String(p.gender ?? "").toLowerCase();
  return {
    brand: "express",
    externalId: String(p.productId).replace(/F$/, ""),
    name: String(p.name).trim(),
    url: url.split(/[?#]/)[0],
    imageUrl: typeof p.productImage === "string" ? `${p.productImage.split("?")[0]}?cache=on&wid=960&fmt=jpeg&qlt=85` : null,
    price: toMinor(price),
    listPrice: list != null && list > price ? toMinor(list) : null,
    inStock: pick ? pick.inStock : true,
    category: null,
    type: null,
    gender: g === "women" ? "kadin" : g === "men" ? "erkek" : null,
    colorName: pick?.colour ? pick.colour.toLowerCase().replace(/\b[a-z]/g, (c: string) => c.toUpperCase()) : null,
    country: "US",
    currency: "USD",
  };
}

export async function expressUrl(url: string): Promise<LiveProduct | null> {
  const id = expressIdFromUrl(url);
  if (!id) return null;
  try {
    const r = await fetch(`${SITE}/graphql`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ operationName: "ProductQuery", query: QUERY, variables: { productId: id.id } }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(countryFor("express", "US")),
    });
    if (!r.ok) {
      console.warn(`live-lookup: www.express.com refused with HTTP ${r.status}`);
      return null;
    }
    const body: any = await r.json();
    return mapExpressLive(body?.data?.product, id.colour, url);
  } catch (err) {
    console.warn(`live-lookup: www.express.com unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
