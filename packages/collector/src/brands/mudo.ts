import { cleanGallery, type ProductRecord, type ProductVariants, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";

/**
 * Mudo (mudo.com.tr) is an Akinon storefront, like Koton: every category page
 * answers JSON with `?format=json`, and every product page does too.
 *
 * Mudo is half a homeware shop; only the two clothing roots are walked
 * (kadin-giyim includes bags, accessories and the outlet). FULL CATALOGUE
 * (2026-10-19): every row of both roots is kept — discounted rows with their
 * retail price as listPrice, full-price rows with `listPrice: null` — so the
 * collector's missing-product sweep sees the whole brand. 1,445 + 1,337 rows,
 * 29 requests of 100 (measured 2026-10-19).
 *
 * Identity: a listing row is ONE SIZE of one colour (its pk, url and sku all
 * name the size), and which size represents the colour can change between
 * runs. `erp_VaryantNo` ("1262665-413" = model + colour) is what every size of
 * a colour shares, so that is the stored id — the resolver reads the same field.
 */
const SITE = "https://www.mudo.com.tr";
const CATS: { slug: string; gender: ProductRecord["gender"] }[] = [
  { slug: "kadin-giyim", gender: "kadin" },
  { slug: "erkek-giyim", gender: "erkek" },
];
const PAGE_SIZE = 100;
// Headroom over the ~2.8k-row / 29-page catalogue: a cap must never cut it.
const MAX_PAGES = Number(process.env.MUDO_MAX_PAGES ?? 200);
const MAX_PRODUCTS = Number(process.env.MUDO_MAX_PRODUCTS ?? 20000);
const DETAIL_LIMIT = Number(process.env.MUDO_DETAIL_LIMIT ?? 500);
const CONCURRENCY = 3;

export function mudoId(p: any): string | null {
  const a = p?.attributes ?? {};
  if (a.erp_VaryantNo) return String(a.erp_VaryantNo);
  if (p?.base_code && a.variant_renk) return `${p.base_code}-${a.variant_renk}`;
  return p?.pk != null ? String(p.pk) : null;
}

const genderOf = (v: unknown, fallback: ProductRecord["gender"]): ProductRecord["gender"] => {
  const s = String(v ?? "").toLocaleLowerCase("tr");
  if (/çocuk|kız|bebek/.test(s)) return "cocuk";
  if (s.startsWith("kad")) return "kadin";
  if (s.startsWith("erkek")) return "erkek";
  return fallback;
};

export function mapProduct(p: any, fallback: ProductRecord["gender"]): ProductRecord | null {
  const id = mudoId(p);
  const price = parseFloat(p?.price);
  if (!id || !Number.isFinite(price) || price <= 0) return null;
  const retail = parseFloat(p?.retail_price);
  const a = p.attributes ?? {};
  const shots = [...(p.productimage_set ?? [])]
    .filter((im: any) => im && (im.status == null || im.status === "active") && typeof im.image === "string")
    .sort((x: any, y: any) => (x.order ?? 0) - (y.order ?? 0))
    .map((im: any) => im.image as string)
    .filter((u) => !/\.(mp4|mov|webm)(\?|$)/i.test(u));
  return {
    brand: "mudo",
    country: "TR",
    externalId: id,
    name: String(p.name ?? "").trim(),
    url: p.absolute_url ? `${SITE}${p.absolute_url}` : SITE,
    imageUrl: shots[0] ?? null,
    images: cleanGallery(shots),
    price: toMinor(price),
    listPrice: Number.isFinite(retail) && retail > price ? toMinor(retail) : null,
    currency: "TRY",
    inStock: p.in_stock === true,
    // Class + sub-class ("ETEK / MİNİ", "KAZAK & HIRKA / KAZAK"): the sub-class
    // alone is often a cut, not a product type.
    category: [a.erp_MalSinifAdi ?? a.integration_MalSinifAdi, a.erp_MalAltSinifAdi ?? a.integration_MalAltSinifAdi]
      .filter(Boolean).join(" / ") || null,
    gender: genderOf(a.cinsiyet ?? a.integration_Cinsiyet, fallback),
    // base_code is the model; each colour of it is a separate row.
    groupKey: p.base_code ? `mudo:${p.base_code}` : null,
    colorName: a.variant_renk ?? a.renk ?? null,
  };
}

/** Sizes (each its own pk) and colours from a product page's `variants[]`. */
export function parseVariants(data: any): ProductVariants | null {
  const groups: any[] = data?.variants ?? [];
  const opts = (key: string): any[] => groups.find((g) => g?.attribute_key === key)?.options ?? [];
  const seen = new Set<string>();
  const sizes: SizeVariant[] = [];
  for (const o of opts("beden")) {
    const label = String(o?.label ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: o?.in_stock ? "in_stock" : "out_of_stock" });
  }
  const colors = [...new Set(opts("variant_renk").map((o) => String(o?.label ?? "").trim()).filter(Boolean))];
  return sizes.length || colors.length ? { colors, sizes } : null;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

export const brand = "mudo";

export async function listProducts(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  for (const { slug, gender } of CATS) {
    const take = (list: any[]) => {
      for (const p of list) {
        const rec = mapProduct(p, gender);
        if (!rec || byId.has(rec.externalId)) continue;
        byId.set(rec.externalId, rec);
      }
    };
    const url = (page: number) => `${SITE}/${slug}/?format=json&page_size=${PAGE_SIZE}&page=${page}`;
    const first = await getJson<any>(url(1)).catch(() => null);
    if (!first) throw new Error(`mudo: ${slug} page 1 failed — partial catalogue refused`);
    take(first.products ?? []);
    const last = Number(first.pagination?.num_pages ?? 1);
    // A cap that cut pages would let the delist sweep mark their rows sold out: refuse instead.
    if (last > MAX_PAGES) throw new Error(`mudo: ${slug} has ${last} pages, over the cap of ${MAX_PAGES}`);
    // null = the page failed (after getJson's own retries).
    const fetchList = (k: number): Promise<any[] | null> =>
      getJson<any>(url(k)).then((d) => (Array.isArray(d?.products) ? d.products : null)).catch(() => null);
    const failed: number[] = [];
    for (let page = 2; page <= last; page += CONCURRENCY) {
      const batch = Array.from({ length: Math.min(CONCURRENCY, last - page + 1) }, (_, k) => page + k);
      const lists = await Promise.all(batch.map(fetchList));
      lists.forEach((list, k) => (list ? take(list) : failed.push(batch[k])));
    }
    // A lost page is 100 rows the collector would mark sold out: one more try
    // each, then refuse a partial catalogue rather than return it.
    for (const k of failed) {
      const list = await fetchList(k);
      if (!list) throw new Error(`mudo: ${slug} page ${k} failed — partial catalogue refused`);
      take(list);
    }
  }

  if (byId.size > MAX_PRODUCTS) throw new Error(`mudo: ${byId.size} products, over the cap of ${MAX_PRODUCTS}`);

  // Per-size stock needs the product page (~60 KB JSON). Cover a rotating
  // random subset per run; the upsert keeps earlier captures.
  const records = [...byId.values()];
  const pick = [...records];
  for (let j = pick.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [pick[j], pick[k]] = [pick[k], pick[j]];
  }
  await pool(pick.slice(0, DETAIL_LIMIT), CONCURRENCY, async (r) => {
    const path = new URL(r.url).pathname;
    const d = await getJson<any>(`${SITE}${path}?format=json`, { retries: 0 }).catch(() => null);
    const v = parseVariants(d);
    if (!v) return;
    r.variants = v;
    if (v.sizes.length) r.inStock = v.sizes.some((s) => s.availability !== "out_of_stock");
  });
  return records;
}
