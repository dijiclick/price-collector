import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";

/**
 * Derimod — Shopify (`derimod.com.tr`, the www host 301s to the bare one).
 * `/products.json?limit=250&page=N` is the whole catalogue with per-variant
 * `price`, `compare_at_price` and `available`; options are `Renk` / `Beden`.
 *
 * There is an `indirimli-urunler` collection, but it held 291 products while
 * the first 3,750 catalogue rows alone carried 1,646 with a compare-at price
 * (2026-10-10) — so the catalogue is walked and the reduced rows kept.
 *
 * Shopify rate-limits this storefront hard: three back-to-back pages answered
 * `local_rate_limited` on the fourth. Pages are fetched one at a time with a
 * pause, and a refused page waits and is retried rather than ending the walk.
 */
export const SITE = "https://derimod.com.tr";
const MAX_PRODUCTS = Number(process.env.DERIMOD_MAX_PRODUCTS ?? 2000);
const MAX_PAGES = Number(process.env.DERIMOD_MAX_PAGES ?? 60);
const PAUSE_MS = Number(process.env.DERIMOD_PAUSE_MS ?? 1500);

export const brand = "derimod";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fold = (s: string) => s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").toLowerCase();
function genderOf(p: any): ProductRecord["gender"] {
  const tags: string[] = Array.isArray(p?.tags) ? p.tags.map(String) : [];
  const t = fold([...tags, p?.title ?? ""].join(" | "));
  if (/cocuk/.test(t)) return "cocuk";
  if (/feed-gender-female|\bkadin\b/.test(t)) return "kadin";
  if (/feed-gender-male|\berkek\b/.test(t)) return "erkek";
  return null;
}

/** Index of the option whose name matches, as Shopify's `option1..3` key. */
function optionKey(p: any, re: RegExp): string | null {
  const opts: any[] = p?.options ?? [];
  const i = opts.findIndex((o) => re.test(String(typeof o === "string" ? o : o?.name ?? "")));
  return i >= 0 ? `option${i + 1}` : null;
}

/** Map one `/products.json` product. Pure. Prices there are major-unit strings. */
export function mapDerimod(p: any): ProductRecord | null {
  const vs: any[] = p?.variants ?? [];
  if (!p?.id || !p?.title || !vs.length) return null;
  const priced = vs
    .map((v) => ({ v, price: parseFloat(v.price), cmp: parseFloat(v.compare_at_price) }))
    .filter((x) => Number.isFinite(x.price) && x.price > 0);
  if (!priced.length) return null;
  // The price a shopper sees: the cheapest buyable variant, else the cheapest.
  const pick = [...priced].sort((a, b) => Number(b.v.available) - Number(a.v.available) || a.price - b.price)[0];
  const sizeKey = optionKey(p, /beden|size|numara/i);
  const colourKey = optionKey(p, /renk|colou?r/i);
  const seen = new Set<string>();
  const sizes: SizeVariant[] = [];
  if (sizeKey) {
    for (const v of vs) {
      const label = String(v?.[sizeKey] ?? "").trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      sizes.push({ label, availability: v.available ? "in_stock" : "out_of_stock" });
    }
  }
  const colors = colourKey ? [...new Set(vs.map((v) => String(v?.[colourKey] ?? "").trim()).filter(Boolean))] : [];
  const imgs: string[] = (p.images ?? []).map((im: any) => im?.src).filter((u: unknown) => typeof u === "string");
  const type = typeof p.product_type === "string" ? p.product_type.split(">").pop()!.trim() : "";
  return {
    brand,
    country: "TR",
    externalId: String(p.id),
    name: String(p.title).trim(),
    url: `${SITE}/products/${p.handle}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(pick.price),
    listPrice: Number.isFinite(pick.cmp) && pick.cmp > pick.price ? toMinor(pick.cmp) : null,
    currency: "TRY",
    inStock: vs.some((v) => v.available === true),
    category: type || null,
    gender: genderOf(p),
    variants: sizes.length ? { colors, sizes } : null,
    colorName: colors.length === 1 ? colors[0] : null,
  };
}

async function page(n: number): Promise<any[] | null> {
  const url = `${SITE}/products.json?limit=250&page=${n}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const data = await getJson<any>(url, { retries: 0 }).catch(() => null);
    if (Array.isArray(data?.products)) return data.products;
    await sleep(5000 * (attempt + 1));
  }
  return null;
}

export async function listProducts(): Promise<ProductRecord[]> {
  // Walk the whole catalogue, then keep in-stock reductions first: 80% of the
  // compare-at rows are sold-out old seasons (394 of the first 2,000 were
  // buyable, 2026-10-10), and a first-come cap filled up with them.
  const byId = new Map<string, ProductRecord>();
  for (let n = 1; n <= MAX_PAGES; n++) {
    if (n > 1) await sleep(PAUSE_MS);
    const rows = await page(n);
    if (rows === null) {
      // Three refusals in a row: return what we have only if it is a real
      // collection, otherwise surface the failure (the sweep skips a short run).
      if (byId.size === 0) throw new Error(`derimod: products.json page ${n} refused`);
      break;
    }
    if (rows.length === 0) break;
    for (const p of rows) {
      const r = mapDerimod(p);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, MAX_PRODUCTS);
}
