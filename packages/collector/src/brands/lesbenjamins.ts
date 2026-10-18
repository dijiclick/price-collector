import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { genderOf as shopifyGender, mapShopify } from "./_shopify";

/**
 * Les Benjamins — Istanbul streetwear, Shopify (`lesbenjamins.com`, shop
 * `lesbenjamins`, currency TRY, ships to TR only — the .com is the Turkish
 * shop, not a global EUR one). `/products.json?limit=250&page=N` is the whole
 * catalogue (3,251 products, 14 pages, 2026-10-18); options are `Color` /
 * `Size`, prices major-unit TRY strings. 763 rows were reduced, 337 of them
 * buyable — the rest are sold-out old seasons, so in-stock goes first.
 *
 * Gender is in plain tags: `women`, `men`, `unisex`, `kids`. 224 products
 * carry BOTH `men` and `women` (the unisex line), which the shared heuristic
 * would call women's — those stay null. Product types are English ("Short
 * Sleeve Tees", "Zip Hoodies").
 *
 * A GitHub runner gets the same TRY catalogue as a Turkish line (probe runs
 * 39123985400 / 39124174501). The 20,000-unit gift-card guard in `_shopify.ts`
 * drops a few full-price leather jackets; none of them was reduced.
 */
export const SITE = "https://lesbenjamins.com";
const MAX_PRODUCTS = Number(process.env.LESBENJAMINS_MAX_PRODUCTS ?? 1500);
const MAX_PAGES = Number(process.env.LESBENJAMINS_MAX_PAGES ?? 25);
const PAUSE_MS = Number(process.env.LESBENJAMINS_PAUSE_MS ?? 1200);

export const brand = "lesbenjamins";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function lesBenjaminsGender(p: any): ProductRecord["gender"] {
  const raw: string[] = Array.isArray(p?.tags) ? p.tags : typeof p?.tags === "string" ? p.tags.split(",") : [];
  const tags = new Set(raw.map((t) => String(t).trim().toLowerCase()));
  if (tags.has("kids")) return "cocuk";
  const w = tags.has("women");
  const m = tags.has("men");
  if (tags.has("unisex") || (w && m)) return null;
  if (w) return "kadin";
  if (m) return "erkek";
  return shopifyGender({ title: p?.title ?? "" });
}

/** Map one `/products.json` product. Pure. */
export function mapLesBenjamins(p: any): ProductRecord | null {
  const r = mapShopify({ brand, sites: { TR: SITE } }, "TR", SITE, p);
  return r ? { ...r, gender: lesBenjaminsGender(p) } : null;
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
      if (byId.size === 0) throw new Error(`lesbenjamins: products.json page ${n} refused`);
      break;
    }
    if (rows.length === 0) break;
    for (const p of rows) {
      const r = mapLesBenjamins(p);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
    if (rows.length < 250) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, MAX_PRODUCTS);
}
