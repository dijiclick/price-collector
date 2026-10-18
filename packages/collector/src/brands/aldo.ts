import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { genderOf as shopifyGender, mapShopify } from "./_shopify";

/**
 * ALDO Turkey — Shopify (`www.aldoshoes.com.tr`, shop `uyjyuj-v1`, currency
 * TRY, ships to TR only). A separate shop from aldoshoes.com (US/CA, read
 * through the Storefront API in storefront-stores.ts), so it has its own ids.
 *
 * `/products.json?limit=250&page=N` is the whole catalogue (~2,450 products,
 * 10 pages) with per-variant `price` / `compare_at_price` / `available`. The
 * only option is `size` (shoe numbers, or `Standart` for bags and jewellery).
 * On 2026-10-18 a sitewide campaign had 2,146 of 2,208 rows reduced, 30–80%,
 * and the product page showed the same strike prices.
 *
 * A GitHub runner gets the same TRY catalogue as a Turkish line (probe runs
 * 39123985400 / 39124174501), so no proxy and no market cookie is needed; the
 * cookie is sent anyway, as the shared Shopify adapter does.
 *
 * Gender lives in `product_type`, a path like `Kadın > Ayakkabılar > Botlar`
 * or `Aksesuarlar > Erkek > Kemerler`; titles repeat it ("AELLAX Kadın Sarı
 * Çanta"). Shoe-care items carry neither and stay null.
 */
export const SITE = "https://www.aldoshoes.com.tr";
const MAX_PRODUCTS = Number(process.env.ALDO_TR_MAX_PRODUCTS ?? 1500);
const MAX_PAGES = Number(process.env.ALDO_TR_MAX_PAGES ?? 20);
const PAUSE_MS = Number(process.env.ALDO_TR_PAUSE_MS ?? 1200);

export const brand = "aldo";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fold = (s: string) =>
  s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").replace(/[Şş]/g, "s").toLowerCase();

export function aldoTrGender(p: any): ProductRecord["gender"] {
  const segs = String(p?.product_type ?? "").split(">").map((s) => fold(s.trim()));
  for (const s of segs) {
    if (/^(cocuk|kiz cocuk|erkek cocuk)$/.test(s)) return "cocuk";
    if (s === "kadin") return "kadin";
    if (s === "erkek") return "erkek";
  }
  const t = fold(String(p?.title ?? ""));
  if (/\bunisex\b/.test(t)) return null;
  if (/\bcocuk\b/.test(t)) return "cocuk";
  if (/\bkadin\b/.test(t)) return "kadin";
  if (/\berkek\b/.test(t)) return "erkek";
  return shopifyGender({ tags: p?.tags, title: "" });
}

/** Map one `/products.json` product. Pure. */
export function mapAldoTr(p: any): ProductRecord | null {
  const r = mapShopify({ brand, sites: { TR: SITE } }, "TR", SITE, p);
  return r ? { ...r, gender: aldoTrGender(p) } : null;
}

async function page(n: number): Promise<any[] | null> {
  const url = `${SITE}/products.json?limit=250&page=${n}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const data = await getJson<any>(url, {
      retries: 0,
      country: "TR",
      headers: { cookie: "localization=TR; cart_currency=TRY" },
    }).catch(() => null);
    if (Array.isArray(data?.products)) return data.products;
    // Shopify answers 429 / `local_rate_limited` when paged too fast: back off.
    await sleep(4000 * (attempt + 1));
  }
  return null;
}

export async function listProducts(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  for (let n = 1; n <= MAX_PAGES; n++) {
    if (n > 1) await sleep(PAUSE_MS);
    const rows = await page(n);
    if (rows === null) {
      if (byId.size === 0) throw new Error(`aldo/TR: products.json page ${n} refused`);
      break;
    }
    if (rows.length === 0) break;
    for (const p of rows) {
      const r = mapAldoTr(p);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
    if (rows.length < 250) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, MAX_PRODUCTS);
}
