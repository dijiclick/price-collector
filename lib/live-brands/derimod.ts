/**
 * Derimod by url (`derimod.com.tr/products/<handle>`, also reached through a
 * `/collections/<c>/products/<handle>` path). Shopify's `/products/<handle>.js`
 * answers the product with prices in MINOR units (kuruş) — unlike
 * `products.json`, which the collector reads in major-unit strings — plus
 * per-variant `available`. The id is Shopify's product id, as the collector's.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, json } from "../live-http";

const SITE = "https://derimod.com.tr";

export function derimodHandleFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!u.hostname.toLowerCase().endsWith("derimod.com.tr")) return null;
  const h = u.pathname.match(/\/products\/([^/?#]+?)(?:\.js|\.json)?\/?$/)?.[1];
  return h ? decodeURIComponent(h) : null;
}

const fold = (s: string) => s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").toLowerCase();

/** Map a `/products/<handle>.js` body. Pure. */
export function mapDerimodJs(p: any): LiveProduct | null {
  const vs: any[] = p?.variants ?? [];
  if (!p?.id || !p?.title) return null;
  const buyable = vs.filter((v) => v?.available === true && Number(v.price) > 0);
  const pool = (buyable.length ? buyable : vs).filter((v) => Number(v?.price) > 0);
  const pick = [...pool].sort((a, b) => Number(a.price) - Number(b.price))[0];
  const price = Math.round(Number(pick?.price ?? p.price));
  if (!Number.isFinite(price) || price <= 0) return null;
  const cmp = Math.round(Number(pick?.compare_at_price ?? p.compare_at_price));
  const colourIdx = (p.options ?? []).findIndex((o: any) => /renk|colou?r/i.test(String(o?.name ?? o)));
  const colours = colourIdx >= 0 ? [...new Set(vs.map((v) => v?.[`option${colourIdx + 1}`]).filter(Boolean))] : [];
  const img = typeof p.featured_image === "string" ? p.featured_image : p.images?.[0];
  const tags = fold((Array.isArray(p.tags) ? p.tags.join(" | ") : String(p.tags ?? "")) + " | " + p.title);
  const gender = /cocuk/.test(tags) ? "cocuk" : /feed-gender-female|\bkadin\b/.test(tags) ? "kadin" : /feed-gender-male|\berkek\b/.test(tags) ? "erkek" : null;
  const type = typeof p.type === "string" ? p.type.split(">").pop()!.trim() : "";
  return {
    brand: "derimod",
    externalId: String(p.id),
    name: String(p.title).trim(),
    url: `${SITE}/products/${p.handle}`,
    imageUrl: typeof img === "string" ? (img.startsWith("//") ? `https:${img}` : img) : null,
    price,
    listPrice: Number.isFinite(cmp) && cmp > price ? cmp : null,
    inStock: vs.length ? vs.some((v) => v?.available === true) : p.available === true,
    category: type || null,
    type: null,
    gender,
    colorName: colours.length === 1 ? String(colours[0]) : null,
    country: "TR",
    currency: "TRY",
  };
}

export async function derimodUrl(url: string): Promise<LiveProduct | null> {
  const handle = derimodHandleFromUrl(url);
  if (!handle) return null;
  const body = await json<any>(
    `${SITE}/products/${encodeURIComponent(handle)}.js`,
    { Accept: "application/json", "User-Agent": UA },
    countryFor("derimod"),
  );
  return mapDerimodJs(body);
}
