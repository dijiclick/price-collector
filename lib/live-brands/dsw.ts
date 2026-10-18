/**
 * DSW by url (`dsw.com/product/<slug>/<id>?activeColor=<colour>`, also under
 * `/en/us/`). DSW's item service (`api.dsw.com/item/api/v1/item/<id>`,
 * channel `dsw_us_digital`) answers one style with every colour and per-size
 * SKU: `regular_price` (DSW's price) vs `actual_price` (charged — the
 * clearance price when marked down), plus stock per SKU. `compare_at_price`
 * is the manufacturer's MSRP and is ignored, as in the collector
 * (packages/collector/src/brands/dsw.ts). The id is `<style>-<colour>`, as
 * the collector's. api.dsw.com refuses Turkish IPs; US egress is fine.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, json, toMinor } from "../live-http";

const SITE = "https://www.dsw.com";

export function dswIdFromUrl(url: string): { id: string; color: string | null } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)dsw\.com$/i.test(u.hostname)) return null;
  const id = u.pathname.match(/\/product\/[^/]+\/(\d+)\/?$/)?.[1];
  if (!id) return null;
  const color = u.searchParams.get("activeColor");
  return { id, color: color && /^\d+$/.test(color) ? color : null };
}

const atp = (x: any) => Number(x?.inventory?.available_to_promise ?? 0);

/** Map an item-service style to the asked colour (or the default one). Pure. */
export function mapDswItem(body: any, color: string | null): LiveProduct | null {
  const st = body?.styles?.[0];
  const variants: any[] = (st?.product_variants ?? []).filter((v: any) => (v?.product_skus ?? []).length);
  const v =
    (color ? variants.find((x) => String(x.color_code) === color) : null) ??
    variants.find((x) => String(x.color_code) === String(st?.spin_color_code)) ??
    variants[0];
  if (!st?.code || !v) return null;
  const skus: any[] = v.product_skus.filter((s: any) => Number(s?.price?.actual_price) > 0);
  const live = skus.filter((s) => atp(s) > 0);
  const pick = [...(live.length ? live : skus)].sort((a, b) => a.price.actual_price - b.price.actual_price)[0];
  if (!pick) return null;
  const price = Number(pick.price.actual_price);
  const regular = Number(pick.price.regular_price);
  const brand = String(st.trait?.brands?.[0]?.display_name ?? "").trim();
  const name = String(v.display_name ?? "").trim();
  const full = brand && !name.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${name}` : name;
  const img = (v.asset?.images ?? []).slice().sort((a: any, b: any) => (a?.sort ?? 0) - (b?.sort ?? 0))[0]?.site_url;
  const g = String(st.trait?.genders?.[0]?.code ?? "").toLowerCase();
  return {
    brand: "dsw",
    externalId: `${st.code}-${v.color_code}`,
    name: full || String(st.code),
    url: `${SITE}${typeof v.site_url === "string" ? v.site_url : `/product/x/${st.code}`}?activeColor=${encodeURIComponent(String(v.color_code))}`,
    imageUrl: typeof img === "string" ? `${img}?quality=70&width=1000` : null,
    price: toMinor(price),
    listPrice: regular > price ? toMinor(regular) : null,
    inStock: atp(v) > 0 || live.length > 0,
    category: typeof st.trait?.item_types?.[0]?.display_name === "string" ? st.trait.item_types[0].display_name : null,
    type: null,
    gender: /kid|boy|girl/.test(g) ? "cocuk" : g === "women" ? "kadin" : g === "men" ? "erkek" : null,
    colorName: typeof v.trait?.color?.display_name === "string" ? v.trait.color.display_name : null,
    country: "US",
    currency: "USD",
  };
}

export async function dswUrl(url: string): Promise<LiveProduct | null> {
  const ref = dswIdFromUrl(url);
  if (!ref) return null;
  const body = await json<any>(
    `https://api.dsw.com/item/api/v1/item/${ref.id}?channel=dsw_us_digital&locale=en_us`,
    { Accept: "application/json", "User-Agent": UA },
    countryFor("dsw", "us"),
  );
  return body ? mapDswItem(body, ref.color) : null;
}
