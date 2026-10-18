/**
 * Jimmy Key by url (`jimmykey.com/tr/<slug>_<code>/<colour>/<colourId>`).
 * The shop has no product JSON of its own, so the lookup asks the same
 * PersonaClick search the collector reads (packages/collector/src/brands/
 * jimmykey.ts) for the model code in the url, and picks the row whose id ends
 * in the url's colour id — that id (`28786-108`) is the collector's external_id.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, json, toMinor } from "../live-http";

const SHOP_ID = "a2eecbc9a7b0414937fdb654375362";

/** `{ code: "5WW105284", colourId: "108" }`, or null when the url is not a Jimmy Key PDP. */
export function jimmykeyRefFromUrl(url: string): { code: string; colourId: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!u.hostname.toLowerCase().replace(/^www\./, "").endsWith("jimmykey.com")) return null;
  const m = u.pathname.match(/_([a-z0-9]+)\/[^/]+\/(\d+)\/?$/i);
  return m ? { code: m[1].toUpperCase(), colourId: m[2] } : null;
}

/** Pick and map the matching row of a PersonaClick search body. Pure. */
export function mapJimmyKeySearch(body: any, colourId: string): LiveProduct | null {
  const p = (body?.products ?? []).find((x: any) => String(x?.id ?? "").endsWith(`-${colourId}`));
  const price = Number(p?.price_full ?? p?.price);
  if (!p?.name || typeof p.url !== "string" || !Number.isFinite(price) || price <= 0) return null;
  const old = Number(p.oldprice_full ?? p.oldprice);
  const cats: any[] = Array.isArray(p.categories) ? p.categories : [];
  const leaf = cats
    .filter((c) => c?.name && !/indirim|yeniler|koleksiyon/.test(String(c.name).replace(/[İI]/g, "i").replace(/ı/g, "i").toLowerCase()))
    .sort((a, b) => Number(b.level) - Number(a.level))[0];
  const colour = ((p.params ?? []).find((x: any) => x?.key === "ColorGlobalName")?.values ?? [])[0] ?? null;
  return {
    brand: "jimmykey",
    externalId: String(p.id),
    name: String(p.name).trim(),
    url: p.url.split("?")[0],
    imageUrl: typeof p.image_url === "string" ? p.image_url : null,
    price: toMinor(price),
    listPrice: Number.isFinite(old) && old > price ? toMinor(old) : null,
    inStock: true,
    category: leaf ? String(leaf.name).split(" - ").pop()!.trim() : null,
    type: null,
    gender: p.fashion_feature === "child" ? "cocuk" : p.fashion_gender === "m" ? "erkek" : "kadin",
    colorName: colour ? String(colour) : null,
    country: "TR",
    currency: "TRY",
  };
}

export async function jimmykeyUrl(url: string): Promise<LiveProduct | null> {
  const ref = jimmykeyRefFromUrl(url);
  if (!ref) return null;
  const body = await json<any>(
    `https://api.personaclick.com/search?shop_id=${SHOP_ID}&type=full_search&search_query=${encodeURIComponent(ref.code)}&limit=50&page=1`,
    { Accept: "application/json", "User-Agent": UA },
    countryFor("jimmykey"),
  );
  return mapJimmyKeySearch(body, ref.colourId);
}
