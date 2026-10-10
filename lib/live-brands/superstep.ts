/**
 * SuperStep by url: an Akinon shop, so the product page itself answers JSON
 * with `?format=json` (like Koton). The stored id is the COLOUR
 * (`integration_model_renk`, e.g. "IE5836.-"), not the size SKU the url names,
 * matching packages/collector/src/brands/superstep.ts.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, json, toMinor } from "../live-http";

const SITE = "https://www.superstep.com.tr";

export function mapSuperstep(res: any): LiveProduct | null {
  const p = res?.product;
  const price = parseFloat(p?.price);
  if (!p?.pk || !p.name || !Number.isFinite(price) || price <= 0) return null;
  const retail = parseFloat(p.retail_price);
  const mr = p.attributes?.integration_model_renk;
  const id = typeof mr === "string" && mr.trim() ? mr.trim() : p.base_code ? String(p.base_code) : String(p.pk);
  const groups: any[] = res.variants ?? [];
  const sizes: any[] = groups.find((g) => g?.attribute_key === "integration_beden")?.options ?? [];
  const img = [...(p.productimage_set ?? [])].sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))[0];
  const label = (k: string): string | null => {
    const v = p.attributes_kwargs?.[k]?.label ?? p.attributes?.[k];
    return typeof v === "string" && v.trim() && v.trim() !== "-" ? v.trim() : null;
  };
  const g = label("integration_cinsiyet") ?? "";
  return {
    brand: "superstep",
    externalId: id,
    name: String(p.name).replace(/\s+/g, " ").trim(),
    url: `${SITE}${p.absolute_url ?? ""}`,
    imageUrl: img?.image ?? null,
    price: toMinor(price),
    listPrice: Number.isFinite(retail) && retail > price ? toMinor(retail) : null,
    inStock: sizes.length ? sizes.some((o) => o?.in_stock === true) : res.in_stock !== false,
    // Same as the collector: the label goes in category for multi-brand shops.
    category: label("integration_marka"),
    type: null,
    gender: /kad[ıi]n/i.test(g) ? "kadin" : /erkek/i.test(g) ? "erkek" : /[çc]ocuk|bebek|gen[çc]/i.test(g) ? "cocuk" : null,
    colorName: label("integration_renk_detay"),
    country: "TR",
    currency: "TRY",
  };
}

export async function superstepUrl(url: string): Promise<LiveProduct | null> {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/^\/(urun|product)\//.test(u.pathname)) return null;
  const path = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
  const res = await json<any>(
    `${SITE}${path}?format=json`,
    { Accept: "application/json", "User-Agent": UA },
    countryFor("superstep"),
  );
  return res ? mapSuperstep(res) : null;
}
