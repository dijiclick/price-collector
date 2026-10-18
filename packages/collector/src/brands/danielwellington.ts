import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { mapShopify, marketHeaders, type ShopifyStore } from "./_shopify";

/**
 * Daniel Wellington Türkiye — its own Shopify store, `tr.danielwellington.com`
 * (`/meta.json`: country TR, currency TRY). The global `danielwellington.com`
 * prices in EUR and has no `/tr` path; its hreflang `tr-TR` points here.
 * `/products.json` answers a GitHub runner directly (probe run 39124158963).
 * ~800 products in 4 pages, 2026-10-18.
 *
 * Every compare-at price on 2026-10-18 (94 of 94) was a GIFT SET whose
 * "was" price is the sum of its parts bought separately ("Petite Melrose &
 * Classic Bracelet Set", 14.940 → 12.700). That is a bundle saving, not a
 * markdown, and is never quoted (playbook: drop gift-set "worth" values and
 * multi-buy prices). So this adapter returns nothing until DW runs a real sale
 * (Black Friday, season end) — then reduced watches and jewellery flow in.
 */
export const SITE = "https://tr.danielwellington.com";
export const brand = "danielwellington";

export const STORE: ShopifyStore = { brand, sites: { TR: SITE }, maxProducts: 800 };

/** DW's English product types, as the Turkish shelf names the classifier reads. */
const SHELF: Record<string, string> = {
  watch: "Saat",
  "smartwatch strap": "Saat Kordonu",
  strap: "Saat Kordonu",
  "watch-charm": "Saat Aksesuarı",
  "watch case": "Saat Kutusu",
  bracelet: "Bileklik",
  necklace: "Kolye",
  earrings: "Küpe",
  ring: "Yüzük",
  charm: "Charm",
  "jewelry box": "Takı Kutusu",
};

/** A gift set / bundle: its compare-at is the parts' total, not a former price. */
export function isBundle(p: any): boolean {
  const tags: string[] = Array.isArray(p?.tags) ? p.tags.map((t: unknown) => String(t).toLowerCase()) : [];
  const type = String(p?.product_type ?? p?.type ?? "").toLowerCase();
  return (
    /gift ?set|bundle/.test(type) ||
    tags.includes("bundle") ||
    (p?.variants ?? []).some((v: any) => String(v?.sku ?? "").includes("|"))
  );
}

/** Map one `/products.json` product. Pure. */
export function mapDanielWellington(p: any): ProductRecord | null {
  const r = mapShopify(STORE, "TR", SITE, p);
  if (!r) return null;
  const type = String(p?.product_type ?? "").trim().toLowerCase();
  // DW titles never say what the thing is ("Petite Melrose Rose Gold"), and the
  // subtype (Saat vs Takı) is read from the NAME — so a watch says so.
  const name = type === "watch" && !/watch|saat/i.test(r.name) ? `${r.name} Kol Saati` : r.name;
  return {
    ...r,
    name,
    category: SHELF[type] ?? r.category,
    listPrice: isBundle(p) ? null : r.listPrice,
  };
}

const MAX_PAGES = 8;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function listProducts(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  for (let n = 1; n <= MAX_PAGES; n++) {
    if (n > 1) await sleep(1200);
    const data = await getJson<any>(`${SITE}/products.json?limit=250&page=${n}`, {
      headers: marketHeaders("TR"),
      timeoutMs: 20_000,
    });
    const rows: any[] = Array.isArray(data?.products) ? data.products : [];
    if (rows.length === 0) break;
    for (const p of rows) {
      const r = mapDanielWellington(p);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, STORE.maxProducts);
}
