/**
 * Tory Burch by url (`toryburch.com/en-us/<path>/<id>.html?color=<colour>`).
 * The storefront's own product API (`/api/prod-r2/v12/products/<id>`, public
 * `x-api-key` from the page config) answers one style with its swatches; a
 * `Sale` swatch price is `min` charged vs `max` struck through, as in the
 * collector (packages/collector/src/brands/toryburch.ts). The id is
 * `<style>-<colour>`, as the collector's. Akamai refuses okhttp, so the
 * default browser UA is kept.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, json, toMinor } from "../live-http";

const SITE = "https://www.toryburch.com";
const API_KEY = "yP6bAmceig0QmrXzGfx3IG867h5jKkAs";

export function toryburchIdFromUrl(url: string): { id: string; color: string | null } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)toryburch\.com$/i.test(u.hostname)) return null;
  const id = u.pathname.match(/\/([A-Za-z0-9]+)\.html$/)?.[1];
  if (!id) return null;
  const color = u.searchParams.get("color");
  return { id, color: color && /^[A-Za-z0-9]+$/.test(color) ? color : null };
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

/** Map a `/products/<id>` style to the asked colour (or its first). Pure. */
export function mapToryStyle(p: any, color: string | null): LiveProduct | null {
  const id = String(p?.id ?? "");
  const name = String(p?.name ?? "").replace(/\s+/g, " ").trim();
  const swatches: any[] = p?.swatches ?? [];
  const s = (color ? swatches.find((x) => String(x?.colorNumber) === color) : null) ?? swatches[0];
  if (!id || !name || !s?.colorNumber) return null;
  const pr = s.price ?? p.price;
  const min = Number(pr?.min);
  const max = Number(pr?.max);
  if (!(min > 0)) return null;
  const sale = pr?.type === "Sale" && max > min;
  const code = (Array.isArray(s.images) ? s.images : []).find((c: unknown) => typeof c === "string" && /^[A-Za-z0-9_]+$/.test(c));
  const path = typeof p.staticURL === "string" && p.staticURL ? `/${p.staticURL.replace(/^\/+|\/+$/g, "")}` : "";
  return {
    brand: "toryburch",
    externalId: `${id}-${s.colorNumber}`,
    name,
    url: `${SITE}/en-us${path}/${id}.html?color=${encodeURIComponent(String(s.colorNumber))}`,
    imageUrl: code ? `https://s7d9.scene7.com/is/image/ToryBurch/${code}?wid=1200&hei=1200&fmt=jpeg` : null,
    price: toMinor(min),
    listPrice: sale ? toMinor(max) : null,
    inStock: s.soldOut !== true,
    category: typeof p.productClassName === "string" ? p.productClassName : null,
    type: null,
    gender: "kadin",
    colorName: typeof s.colorName === "string" && s.colorName ? titleCase(s.colorName) : null,
    country: "US",
    currency: "USD",
  };
}

export async function toryburchUrl(url: string): Promise<LiveProduct | null> {
  const ref = toryburchIdFromUrl(url);
  if (!ref) return null;
  const body = await json<any>(
    `${SITE}/api/prod-r2/v12/products/${encodeURIComponent(ref.id)}?site=ToryBurch_US`,
    { Accept: "application/json", "User-Agent": UA, "x-api-key": API_KEY, Locale: "en-us" },
    countryFor("toryburch", "us"),
  );
  return body?.product ? mapToryStyle(body.product, ref.color) : null;
}
