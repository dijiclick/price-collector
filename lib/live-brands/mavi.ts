/**
 * Mavi by url (`mavi.com/<slug>/p/<code>`). Reads the SAP Commerce OCC
 * product detail the storefront itself calls (`p1-api.mavi.com`), which has
 * prices and per-size stock. Cloudflare refuses Node's default fetch, hence
 * the shared browser-shaped HTTP/2 request. The id is the colour code
 * ("1614193-70240"), as in the collector.
 */
import type { LiveProduct } from "../live-lookup";
import { countryFor } from "../live-http";
import { classifyType } from "../productTypes";
import { browserJson } from "./_browser";

const API = "https://p1-api.mavi.com/maviwebservices/v2/mavi";

export function maviCode(url: string): string | null {
  try {
    const u = new URL(url);
    const code = decodeURIComponent(u.pathname.match(/\/p\/([^/?#]+)/)?.[1] ?? "");
    return /^[0-9A-Za-z-]{5,}$/.test(code) ? code : null;
  } catch { return null; }
}

/** Pure: an OCC product detail → LiveProduct (exported for tests). */
export function mapMaviDetail(p: any, url: string): LiveProduct | null {
  const list = Number(p?.price?.value);
  const sale = Number(p?.salePrice?.value);
  const price = Number.isFinite(sale) && sale > 0 ? sale : list;
  if (!p?.code || !p.name || !Number.isFinite(price) || price <= 0) return null;
  const opts: any[] = p.variantOptions ?? [];
  const inStock = opts.length
    ? opts.some((v) => /^(inStock|lowStock)$/.test(String(v?.stock?.stockLevelStatus)))
    : p.stock?.stockLevelStatus !== "outOfStock";
  const raw = p.mainImage?.url ?? p.images?.[0]?.url ?? null;
  const g = String(p.gender?.name ?? "").toLocaleLowerCase("tr");
  const name = String(p.name).trim();
  const category = p.mainCategories?.[0]?.name ?? null;
  return {
    brand: "mavi",
    externalId: String(p.code),
    name,
    url,
    imageUrl: typeof raw === "string" ? (raw.startsWith("//") ? `https:${raw}` : raw) : null,
    price: Math.round(price * 100),
    listPrice: Number.isFinite(list) && list > price ? Math.round(list * 100) : null,
    inStock,
    category,
    type: classifyType(category, name, "mavi"),
    gender: /çocuk/.test(g) ? "cocuk" : g.startsWith("kad") ? "kadin" : g.startsWith("erkek") ? "erkek" : null,
    colorName: p.colour?.name ?? null,
    country: "TR",
    currency: "TRY",
  };
}

export async function maviUrl(url: string): Promise<LiveProduct | null> {
  const code = maviCode(url);
  if (!code) return null;
  const d = await browserJson<any>(`${API}/products/${encodeURIComponent(code)}?fields=FULL&lang=tr&curr=TRY`, {
    country: countryFor("mavi"),
    order: "proxy-first",
    referer: "https://www.mavi.com/",
  });
  return d ? mapMaviDetail(d, url.split(/[?#]/)[0]) : null;
}
