/**
 * Damas jewellery, UAE (damasjewellery.com/ae-en) — an Akinon storefront like
 * Koton or Lacoste TR, so `?format=json` on any listing path answers JSON.
 *
 * Measured 2026-10-11: `/ae-en/list/?format=json&page_size=100` is the whole
 * UAE catalogue (~1,170 SKUs, 12 pages) priced in AED (`currency_type: aed`,
 * `price` vs `retail_price`, `discount_ratio`). The listing embeds
 * `extra_data.variants` (metal colour + size groups with `in_stock`), so sizes
 * need no PDP call. `gender` is F / M / K / U.
 *
 * KSA (`/sa-en/`) is still the old Magento shop — `/sa-en/list/?format=json`
 * is a Magento 404 — so this adapter is UAE only.
 *
 * Mapping reuses the Akinon helpers but not `mapAkinonProduct`, which is
 * hard-wired to TR/TRY.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { akinonId, akinonSizes } from "./_akinon";

const SITE = "https://www.damasjewellery.com/ae-en";
const SIZE_KEY = "size";
const COLOR_KEY = "metal_color";
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

function genderOf(code: unknown): ProductRecord["gender"] {
  switch (String(code ?? "").toUpperCase()) {
    case "F": return "kadin";
    case "M": return "erkek";
    case "K": return "cocuk";
    default: return null;
  }
}

/** Map one Akinon listing row of the UAE shop. Pure. */
export function mapDamas(p: any): ProductRecord | null {
  const id = akinonId(p, COLOR_KEY);
  const price = parseFloat(p?.price);
  if (!id || !p?.name || !Number.isFinite(price) || price <= 0) return null;
  if (p.currency_type && String(p.currency_type).toLowerCase() !== "aed") return null;
  const retail = parseFloat(p?.retail_price);
  const shots = [...(p.productimage_set ?? [])]
    .filter((im: any) => im && (im.status == null || im.status === "active"))
    .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
    .map((im: any) => im.image)
    .filter((u: unknown) => typeof u === "string");
  const groups: any[] = p.extra_data?.variants ?? [];
  const sizes = akinonSizes(groups, { sizeKey: SIZE_KEY }).filter((s) => s.label.toLowerCase() !== "regular");
  const colour = (groups.find((g) => g?.attribute_key === COLOR_KEY)?.options ?? [])
    .find((o: any) => o?.product?.pk === p.pk)?.label ?? null;
  return {
    brand: "damas",
    country: "AE",
    externalId: id,
    name: String(p.name).replace(/\s+/g, " ").trim(),
    url: p.absolute_url ? `${SITE}${p.absolute_url}` : SITE,
    imageUrl: shots[0] ?? null,
    images: cleanGallery(shots, shots[0] ?? null),
    price: toMinor(price),
    listPrice: Number.isFinite(retail) && retail > price ? toMinor(retail) : null,
    currency: "AED",
    inStock: sizes.length ? sizes.some((s) => s.availability !== "out_of_stock") : p.in_stock === true,
    category: p.attributes?.article_l3 ? String(p.attributes.article_l3) : null,
    gender: genderOf(p.attributes?.gender),
    variants: sizes.length || colour ? { colors: colour ? [String(colour)] : [], sizes } : null,
    groupKey: p.base_code ? `damas:${p.base_code}` : null,
    colorName: colour ? String(colour) : null,
  };
}

export const brand = "damas";

export async function listProducts(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "AE") return [];
  const byId = new Map<string, ProductRecord>();
  let pages = 1;
  for (let n = 1; n <= Math.min(pages, MAX_PAGES); n++) {
    if (n > 1) await new Promise((r) => setTimeout(r, 600));
    const data = await getJson<any>(`${SITE}/list/?format=json&page_size=${PAGE_SIZE}&page=${n}`, { country });
    pages = Number(data?.pagination?.num_pages ?? 1);
    for (const p of data?.products ?? []) {
      const r = mapDamas(p);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, 1500);
}
