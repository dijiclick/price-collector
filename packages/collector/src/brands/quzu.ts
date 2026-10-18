import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { mapShopify } from "./_shopify";

/**
 * QUZU — Shopify (`quzu.com.tr`, shop `quzu-offical`, currency TRY, ships to
 * TR only). Women's clothing only: every one of the 936 products is tagged
 * `gender_kadin/kiz` (2026-10-18), so gender is fixed to `kadin`. The shared
 * tag/title heuristic must NOT run here: Turkish length words in product
 * types ("Mini Boy Etek", "Midi Boy Elbise") read as English "boy" = kidswear.
 *
 * `/products.json?limit=250&page=N` is the whole catalogue (4 pages); options
 * are `Renk` / `Beden`, prices are major-unit TRY strings. 599 of 936 rows
 * were reduced on 2026-10-18, every one in stock. A GitHub runner gets the
 * same TRY catalogue as a Turkish line (probe runs 39123985400 / 39124174501).
 */
export const SITE = "https://quzu.com.tr";
const MAX_PRODUCTS = Number(process.env.QUZU_MAX_PRODUCTS ?? 1500);
const MAX_PAGES = Number(process.env.QUZU_MAX_PAGES ?? 12);
const PAUSE_MS = Number(process.env.QUZU_PAUSE_MS ?? 1200);

export const brand = "quzu";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Map one `/products.json` product. Pure. */
export function mapQuzu(p: any): ProductRecord | null {
  const r = mapShopify({ brand, sites: { TR: SITE } }, "TR", SITE, p);
  return r ? { ...r, gender: "kadin" } : null;
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
      if (byId.size === 0) throw new Error(`quzu: products.json page ${n} refused`);
      break;
    }
    if (rows.length === 0) break;
    for (const p of rows) {
      const r = mapQuzu(p);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
    if (rows.length < 250) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, MAX_PRODUCTS);
}
