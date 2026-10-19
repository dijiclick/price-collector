/**
 * Shared collector for Inveon "Phantom" storefronts (Next.js) — Yargıcı and
 * Hotiç (2026-10-11), Columbia Turkey (2026-10-12).
 *
 * The listing grid pages through the storefront's own JSON route:
 *
 *   POST /api/elasticSearch/elasticSearchPostFilter
 *     { slug, selectedFilters:[{filterName:"slug",filterValues:[slug]}], pageIndex, pageSize }
 *
 * The SSR page asks for 12 at a time; the route honours pageSize 100. No proxy:
 * both answered plain requests (Yargıcı and Hotiç are behind Medianova, no
 * challenge) and the GitHub-runner probe reached both home pages.
 *
 * Each row is ONE colour of a model, with `price.oldPrice`/`newPrice` (gross,
 * TRY) and `variants[]` = that colour's sizes, each with a stock `quantity` —
 * so per-size stock needs no second call.
 *
 * IDENTITY. `variantId` is whichever size the row happened to select, so it is
 * not stable. `erpCode` (`25KKPL5017V_059` = model + colour) is; `productId`
 * is shared across colours and is the groupKey. The PDP is `/<slug>`.
 *
 * FULL CATALOGUE (Yargıcı, Hotiç — 2026-10-19). Those shops return every row,
 * discounted or not (full price = `listPrice: null`), because the run's sweep
 * marks every unseen product out of stock. The route honours pageSize 250.
 * Yargıcı's `tum-urunler` tree is the whole range (4,219 rows, a superset of
 * `outlet` 2,226 + `kadin` 915 + `erkek` 105; 17 pages, ~30 s). Hotiç's three
 * departments are its whole range (1,957 rows, all struck on 10-19 — the old
 * 1,500 cap was cutting ~450 of them; 10 pages, ~10 s). Columbia keeps the
 * deals-only walk at its old limits.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export interface PhantomShop {
  brand: string;
  site: string;
  /** Listing slugs to walk, in priority order (an outlet, or the whole range when everything is marked down). */
  slugs: string[];
  /** Return every row of the slugs (not only marked-down ones), 250 a page, without the deals-only caps. */
  fullCatalogue?: boolean;
}

export const PHANTOM_SHOPS: Record<string, PhantomShop> = {
  yargici: { brand: "yargici", site: "https://www.yargici.com", slugs: ["tum-urunler"], fullCatalogue: true },
  // No outlet tree on Hotiç; the three departments are the whole range.
  hotic: { brand: "hotic", site: "https://www.hotic.com.tr", slugs: ["kadin-ayakkabi", "erkek-ayakkabi", "cantaaksesuar"], fullCatalogue: true },
  // Columbia Turkey (2026-10-12): the department trees hold every marked-down
  // row (751 on 10-12, the union of the seasonal "indirim" slugs) and outlive
  // the season names. 17 pages; answers a GitHub runner (probe run 38235646734).
  columbia: { brand: "columbia", site: "https://www.columbia.com.tr", slugs: ["kadin", "erkek", "cocuk"] },
};

const PAGE_SIZE = 100;
const MAX_PRODUCTS = Number(process.env.PHANTOM_MAX_PRODUCTS ?? 1500);
const MAX_PAGES = Number(process.env.PHANTOM_MAX_PAGES ?? 30);
const PAUSE_MS = Number(process.env.PHANTOM_PAUSE_MS ?? 500);
/** Full-catalogue shops: 250 a page, and caps far above the measured ranges (Yargıcı 4,219 on 2026-10-19). */
const FULL_PAGE_SIZE = 250;
const FULL_MAX_PRODUCTS = Number(process.env.PHANTOM_FULL_MAX_PRODUCTS ?? 15000);
const FULL_MAX_PAGES = Number(process.env.PHANTOM_FULL_MAX_PAGES ?? 80);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fold = (s: string) =>
  s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").replace(/[Şş]/g, "s").replace(/[Ğğ]/g, "g").replace(/[Öö]/g, "o").replace(/[Üü]/g, "u").toLowerCase();

export function genderOf(p: any): ProductRecord["gender"] {
  const cats = (p?.categories ?? []).map((c: any) => c?.name ?? "");
  const t = fold([p?.productName ?? "", p?.itemCategory2 ?? "", ...cats].join(" | "));
  if (/\b(cocuk|bebek|kiz cocuk|erkek cocuk)\b/.test(t)) return "cocuk";
  if (/\bkadin\b/.test(t)) return "kadin";
  if (/\berkek\b/.test(t)) return "erkek";
  return null;
}

export function sizesOf(p: any): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const v of [...(p?.variants ?? [])].sort((a, b) => (a?.priority ?? 0) - (b?.priority ?? 0))) {
    const label = String(v?.specValueName ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const q = Number(v?.quantity ?? 0);
    out.push({ label, availability: q > 2 ? "in_stock" : q > 0 ? "low_on_stock" : "out_of_stock" });
  }
  // A lone "STANDART" is a bag or an accessory, not a size anyone waits for.
  if (out.length === 1 && /^(standart|std|tek ebat|tek beden)$/i.test(out[0].label)) return [];
  return out;
}

/** Map one listing row. Pure. */
export function mapPhantom(shop: PhantomShop, p: any): ProductRecord | null {
  const now = Number(p?.price?.newPrice);
  const was = Number(p?.price?.oldPrice);
  if (!p?.productName || !p?.slug || !Number.isFinite(now) || now <= 0) return null;
  const imgs: string[] = (p.pictures ?? [])
    .filter((m: any) => m?.mediaType == null || m.mediaType === 1)
    .map((m: any) => m?.url)
    .filter((u: unknown): u is string => typeof u === "string");
  const sizes = sizesOf(p);
  const cats: string[] = (p.categories ?? []).map((c: any) => String(c?.name ?? "")).filter(Boolean);
  const category = p.itemCategory3 ?? cats.filter((c) => !/outlet|öne çıkan|indirim/i.test(c)).pop() ?? null;
  const colour = typeof p.color === "string" && p.color.trim() ? p.color.trim() : null;
  return {
    brand: shop.brand,
    country: "TR",
    externalId: String(p.erpCode || p.variantId),
    name: String(p.productName).trim(),
    url: `${shop.site}/${p.slug}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(now),
    listPrice: Number.isFinite(was) && was - now > 0.005 ? toMinor(was) : null,
    currency: p.price?.currencyCode === "TRY" || !p.price?.currencyCode ? "TRY" : String(p.price.currencyCode),
    inStock: Number(p.totalStock ?? 0) > 0,
    category,
    gender: genderOf(p),
    variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: p.productId != null ? `${shop.brand}:${p.productId}` : null,
    colorName: colour,
  };
}

export function filterBody(slug: string, pageIndex: number, pageSize = PAGE_SIZE) {
  return {
    slug,
    orderbyList: [],
    selectedFilters: [{ filterName: "slug", filterValues: [slug], isRequireParent: false, isRangeFilter: false }],
    pageIndex,
    pageSize,
    currentCategoryId: "",
    lastSelectedFilter: "",
  };
}

export async function listPhantom(shop: PhantomShop, country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (country !== "TR") return [];
  const full = shop.fullCatalogue === true;
  const pageSize = full ? FULL_PAGE_SIZE : PAGE_SIZE;
  const maxPages = full ? FULL_MAX_PAGES : MAX_PAGES;
  const maxProducts = full ? FULL_MAX_PRODUCTS : MAX_PRODUCTS;
  const byId = new Map<string, ProductRecord>();
  const perSlug: ProductRecord[][] = [];
  let requests = 0;
  for (const slug of shop.slugs) {
    const mine: ProductRecord[] = [];
    perSlug.push(mine);
    for (let pg = 0; requests < maxPages || full; pg++) {
      // A full-catalogue walk cut by the page budget would be swept as sold out: refuse instead.
      if (requests >= maxPages) throw new Error(`${shop.brand}: over ${maxPages} pages — raise PHANTOM_FULL_MAX_PAGES`);
      if (requests > 0) await sleep(PAUSE_MS);
      requests++;
      const j = await getJson<any>(`${shop.site}/api/elasticSearch/elasticSearchPostFilter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filterBody(slug, pg, pageSize)),
        retries: full ? 2 : 1,
      }).catch((e) => {
        // A full-catalogue run must see every page: a gap would be swept as sold out.
        if (full) throw new Error(`${shop.brand}: ${slug} page ${pg} failed (${e?.message ?? e})`);
        if (byId.size === 0 && requests === 1) throw e;
        return null;
      });
      const rows: any[] = j?.products?.data ?? [];
      for (const p of rows) {
        const r = mapPhantom(shop, p);
        if (r && (full || r.listPrice != null) && !byId.has(r.externalId)) {
          byId.set(r.externalId, r);
          mine.push(r);
        }
      }
      if (!rows.length || !j?.products?.hasNextPage) break;
      if (!full && byId.size >= maxProducts * 1.3) break;
    }
  }
  if (process.env.PHANTOM_DEBUG) console.error(`${shop.brand}: ${requests} requests, ${byId.size} rows`);
  // Round-robin across the walked slugs so the cap never goes all to the first department.
  const all: ProductRecord[] = [];
  for (let i = 0; perSlug.some((l) => i < l.length); i++) for (const l of perSlug) if (i < l.length) all.push(l[i]);
  if (full && all.length > maxProducts) throw new Error(`${shop.brand}: ${all.length} products, over the cap of ${maxProducts}`);
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, maxProducts);
}

/** Registry entry point: `listPhantomBrand("yargici", "TR")`. */
export function listPhantomBrand(slug: string, country: CountryCode): Promise<ProductRecord[]> {
  const shop = PHANTOM_SHOPS[slug];
  if (!shop) throw new Error(`unknown Phantom shop ${slug}`);
  return listPhantom(shop, country);
}
