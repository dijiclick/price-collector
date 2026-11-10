/**
 * Ted Baker (tedbaker.com) — United Kingdom, GBP. Added 2026-11-10.
 *
 * One Shopify store (ted-baker-com) serves the US and the UK through Shopify
 * Markets: `/products.json` and `/meta.json` price in USD whatever is asked,
 * so the UK is read through the Storefront API with `@inContext(country: GB)`
 * (tokenless; `localization` answers GB / GBP) — the `sale` collection, which
 * is the UK one (the US collections are suffixed `-us`). `toProductsJson`
 * drops any row still priced in another currency.
 *
 * Titles are the house style "HAMONDA | BLACK": style name, bar, colour. The
 * product type ("Slippers") is what a shopper would search for, so the name
 * becomes "Ted Baker Hamonda Slippers Black" and the colour is kept apart.
 * The feed has no gender; the product page URL is the same for every market
 * and prices by the visitor's country.
 */
import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { listStorefront, type StorefrontStore } from "./_storefront";

export const TEDBAKER: StorefrontStore = {
  brand: "tedbaker",
  host: "www.tedbaker.com",
  collection: "sale",
  sites: { GB: "https://www.tedbaker.com" },
};

const cap = (s: string) => s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

/** "HAMONDA | BLACK" + "Slippers" → name and colour. Pure. */
export function tedBakerName(title: string, type: string | null): { name: string; colour: string | null } {
  const [style, colour] = title.split("|").map((p) => p.trim());
  if (!colour) return { name: title.trim(), colour: null };
  const t = type && !/^web$/i.test(type) ? ` ${type}` : "";
  return { name: `Ted Baker ${cap(style)}${t} ${cap(colour)}`.replace(/\s+/g, " ").trim(), colour: cap(colour) };
}

export async function listTedBaker(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "GB") return [];
  const rows = await listStorefront(TEDBAKER, country);
  return rows.map((r) => {
    const { name, colour } = tedBakerName(r.name, r.category ?? null);
    return { ...r, name, colorName: r.colorName ?? colour };
  });
}
