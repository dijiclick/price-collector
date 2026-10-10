import { cleanGallery, type ProductRecord, type ProductVariants, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";

/**
 * SuperStep (superstep.com.tr) — a multi-brand sneaker/streetwear retailer on
 * Akinon, so like Koton every listing page answers JSON with `?format=json`.
 * Better than Koton: each listed product already carries `extra_data.variants`
 * — the sibling sizes of its colour, each with `in_stock` — so per-size stock
 * comes with the listing and needs no detail calls at all.
 *
 * `/indirim/` held 7,648 products on 2026-10-10, far past the ~2,000 a run
 * should carry, so it is read sorted by discount rate (`sorter=number`,
 * "İndirim Oranına Göre") and capped: the deepest markdowns are the ones the
 * feed shows first anyway.
 *
 * A listed product is ONE SIZE of a colour (its pk is a size SKU) and which
 * size Akinon picks as the listing representative can change between runs, so
 * the stable id is the colour: `integration_model_renk` ("IE5836.-",
 * model + colour code), falling back to `base_code`.
 */
const SITE = "https://www.superstep.com.tr";
const PAGE_SIZE = 100;
const MAX_PAGES = Number(process.env.SUPERSTEP_MAX_PAGES ?? 20); // 2,000 products

const kw = (p: any, key: string): string | null => {
  const v = p?.attributes_kwargs?.[key]?.label ?? p?.attributes?.[key];
  return typeof v === "string" && v.trim() && v.trim() !== "-" ? v.trim() : null;
};

/** The colour-level id shared by every size SKU of one colourway. */
export function colourId(p: any): string | null {
  const mr = p?.attributes?.integration_model_renk;
  if (typeof mr === "string" && mr.trim()) return mr.trim();
  return p?.base_code ? String(p.base_code) : p?.pk ? String(p.pk) : null;
}

export function genderOf(p: any): ProductRecord["gender"] {
  const g = kw(p, "integration_cinsiyet") ?? "";
  if (/kad[ıi]n/i.test(g)) return "kadin";
  if (/erkek/i.test(g)) return "erkek";
  if (/[çc]ocuk|bebek|gen[çc]|k[ıi]z|o[ğg]lan/i.test(g)) return "cocuk";
  return null; // Unisex
}

/** Sizes (and colour names) from Akinon's variant groups, listing or PDP shape. */
export function variantsOf(groups: any[] | undefined): ProductVariants | null {
  const g = (key: string): any[] => (groups ?? []).find((x) => x?.attribute_key === key)?.options ?? [];
  const seen = new Set<string>();
  const sizes: SizeVariant[] = [];
  for (const o of g("integration_beden")) {
    const label = String(o?.label ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: o?.in_stock && o?.is_selectable !== false ? "in_stock" : "out_of_stock" });
  }
  const colors = [
    ...new Set(
      g("integration_renk")
        .map((o: any) => String(o?.label ?? "").trim())
        .filter((x: string) => x && x !== "-"),
    ),
  ] as string[];
  return sizes.length || colors.length ? { colors, sizes } : null;
}

export function mapProduct(p: any): ProductRecord | null {
  const id = colourId(p);
  const price = parseFloat(p?.price);
  if (!id || !p?.name || !Number.isFinite(price) || price <= 0) return null;
  const retail = parseFloat(p.retail_price);
  const all = [...(p.productimage_set ?? [])]
    .filter(Boolean)
    .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
  const shots = all.filter((im: any) => im.status == null || im.status === "active");
  const first = (shots[0] ?? all[0])?.image ?? null;
  const variants = variantsOf(p.extra_data?.variants);
  const sizes = variants?.sizes ?? [];
  const colour = kw(p, "integration_renk_detay");
  return {
    brand: "superstep",
    externalId: id,
    name: String(p.name).replace(/\s+/g, " ").trim(),
    url: p.absolute_url ? `${SITE}${p.absolute_url}` : SITE,
    imageUrl: first,
    images: cleanGallery(
      shots.map((im: any) => im.image).filter((u: unknown) => typeof u === "string" && !/\.(mp4|mov|webm)(\?|$)/i.test(u)),
      first,
    ),
    // Shelf price only. Many /indirim/ rows are there for a basket offer
    // ("SEPETTE %50 İNDİRİM") with price == retail_price; that coupon is not a
    // markdown of the product and is not quoted as one (Boyner's rule).
    price: toMinor(price),
    listPrice: Number.isFinite(retail) && retail > price ? toMinor(retail) : null,
    currency: "TRY",
    inStock: sizes.length > 0 ? sizes.some((s) => s.availability !== "out_of_stock") : p.in_stock !== false,
    // Multi-brand shop: the label goes in category, as for Boyner and Beymen.
    category: kw(p, "integration_marka") ?? kw(p, "integration_alt_marka"),
    gender: genderOf(p),
    // The variant group's colour labels are codes ("4NV"); the detail name reads better.
    variants: variants ? { colors: colour ? [colour] : variants.colors, sizes } : null,
    groupKey: p.base_code ? `superstep:${p.base_code}` : null,
    colorName: colour,
  };
}

export const brand = "superstep";

export async function listProducts(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${SITE}/indirim/?format=json&sorter=number&page_size=${PAGE_SIZE}&page=${page}`;
    const data = await getJson<any>(url, { proxy: true }).catch(() => null);
    const list: any[] = data?.products ?? [];
    for (const p of list) {
      const r = mapProduct(p);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (list.length === 0 || page >= (data?.pagination?.num_pages ?? 1)) break;
  }
  return [...byId.values()];
}
