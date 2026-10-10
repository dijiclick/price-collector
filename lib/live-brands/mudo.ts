/**
 * Mudo by url. Akinon, like Koton: the product page answers JSON with
 * `?format=json`. The stored id is `erp_VaryantNo` (model + colour, shared by
 * every size of a colour) — a pasted url names one size, whose pk differs per
 * size. Same rule as the collector (packages/collector/src/brands/mudo.ts).
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, json } from "../live-http";
import { classifyType } from "../productTypes";

const SITE = "https://www.mudo.com.tr";

/** Pure: an Akinon product-page JSON → LiveProduct (exported for tests). */
export function mapMudoPage(res: any, url: string): LiveProduct | null {
  const p = res?.product;
  const price = parseFloat(p?.price);
  if (!p?.pk || !p.name || !Number.isFinite(price) || price <= 0) return null;
  const a = p.attributes ?? {};
  const id = a.erp_VaryantNo
    ? String(a.erp_VaryantNo)
    : p.base_code && a.variant_renk ? `${p.base_code}-${a.variant_renk}` : String(p.pk);
  const retail = parseFloat(p.retail_price);
  const sizes: any[] = (res.variants ?? []).find((g: any) => g?.attribute_key === "beden")?.options ?? [];
  const img = [...(p.productimage_set ?? [])]
    .filter((im: any) => im?.status == null || im.status === "active")
    .sort((x: any, y: any) => (x.order ?? 0) - (y.order ?? 0))[0];
  const sex = String(a.cinsiyet ?? "").toLocaleLowerCase("tr");
  const name = String(p.name).trim();
  const category = [a.erp_MalSinifAdi, a.erp_MalAltSinifAdi].filter(Boolean).join(" / ") || null;
  return {
    brand: "mudo",
    externalId: id,
    name,
    url: `${SITE}${p.absolute_url ?? new URL(url).pathname}`,
    imageUrl: img?.image ?? null,
    price: Math.round(price * 100),
    listPrice: Number.isFinite(retail) && retail > price ? Math.round(retail * 100) : null,
    inStock: sizes.length ? sizes.some((o) => o?.in_stock === true) : res.in_stock !== false,
    category,
    type: classifyType(category, name, "mudo"),
    gender: /çocuk|kız/.test(sex) ? "cocuk" : sex.startsWith("kad") ? "kadin" : sex.startsWith("erkek") ? "erkek" : null,
    colorName: a.variant_renk ?? a.renk ?? null,
    country: "TR",
    currency: "TRY",
  };
}

export async function mudoUrl(url: string): Promise<LiveProduct | null> {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  // Product slugs end in the colour ("…-kahverengi-2/"); bare sections do not
  // resolve to a `product` and simply come back null below.
  if (!/^\/(?:[a-z0-9-]{8,}|product\/\d+)\/?$/.test(u.pathname)) return null;
  const path = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
  const res = await json<any>(`${SITE}${path}?format=json`, { Accept: "application/json", "User-Agent": UA }, countryFor("mudo"));
  return res ? mapMudoPage(res, url) : null;
}
