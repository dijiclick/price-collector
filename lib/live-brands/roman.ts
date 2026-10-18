/**
 * Roman by url (`roman.com.tr/tr/products/<id>/<slug>`, also the bare
 * `roman.com.tr/<slug>` form). T-Soft prints the product's data into the PDP
 * as `PRODUCT_DATA.push(JSON.parse('{…}'))` — the same object the collector's
 * listing walk reads (packages/collector/src/brands/roman.ts) — so one html
 * request answers it, keyed by the same product `id`.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, dispatcher, toMinor } from "../live-http";

const SITE = "https://roman.com.tr";

export function romanPathFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname.toLowerCase().replace(/^www\./, "") !== "roman.com.tr") return null;
  const path = u.pathname.replace(/\/+$/, "");
  if (/^\/tr\/products\/\d+\/[^/]+$/.test(path)) return path;
  if (/^\/[a-z0-9-]+$/i.test(path) && path.length > 1) return path;
  return null;
}

/** The first PRODUCT_DATA object on a T-Soft page, mapped. Pure. */
export function mapRomanPage(html: string): LiveProduct | null {
  const m = html.match(/PRODUCT_DATA\.push\(JSON\.parse\('((?:[^'\\]|\\.)*)'\)\)/);
  if (!m) return null;
  let p: any;
  try { p = JSON.parse(JSON.parse(`"${m[1].replace(/\\'/g, "'")}"`)); } catch { return null; }
  const sale = Number(p?.total_sale_price);
  const base = Number(p?.total_base_price);
  if (!p?.id || !p?.name || !Number.isFinite(sale) || sale <= 0) return null;
  const path = String(p.url ?? "").replace(/^\/+/, "");
  return {
    brand: "roman",
    externalId: String(p.id),
    name: String(p.name).replace(/\s+/g, " ").trim(),
    url: path ? `${SITE}/${path}` : SITE,
    imageUrl: typeof p.image === "string" && /^https?:\/\//.test(p.image) ? p.image : null,
    price: toMinor(sale),
    listPrice: Number.isFinite(base) && base - sale > 0.005 ? toMinor(base) : null,
    inStock: p.available === false ? false : Number(p.quantity ?? 1) > 0,
    category: typeof p.category === "string" && p.category.trim() ? p.category.trim() : null,
    type: null,
    gender: "kadin",
    colorName: null,
    country: "TR",
    currency: "TRY",
  };
}

export async function romanUrl(url: string): Promise<LiveProduct | null> {
  const path = romanPathFromUrl(url);
  if (!path) return null;
  try {
    const r = await fetch(`${SITE}${path}`, {
      headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "tr-TR,tr;q=0.9" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(countryFor("roman")),
    });
    if (!r.ok) {
      console.warn(`live-lookup: roman.com.tr refused with HTTP ${r.status}`);
      return null;
    }
    return mapRomanPage(await r.text());
  } catch (err) {
    console.warn(`live-lookup: roman.com.tr unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
