/**
 * Courir (France, sneakers) — Salesforce Commerce Cloud (SFRA), site `Courir-FR`.
 * Measured 2026-10-21:
 *
 * - courir.com sits behind Cloudflare + an IP reputation rule: this Mac's line
 *   gets 403 after one request, while GitHub runners get 200 on every page
 *   (probe runs 39612615563, 39615099908, 39615294904). So the collector, which
 *   runs on those runners, reads it directly; no proxy.
 * - The markdowns are the "promotions en cours" category (`PROMOTIONS-EN-COURS`,
 *   ~60 styles). Its grid is `Search-UpdateGrid?cgid=…&start=N&sz=36` with the
 *   site's XHR header. Each tile has the struck price
 *   (`js-product__default-price is-replaced` data-value "EUR 120.00") and the
 *   price paid (`js-product__promotional-price` data-value "EUR 95.00"), plus a
 *   `data-gtm` JSON with brand, name and the department path
 *   (FEMME-/HOMME-/ENFANT-…).
 * - The "outlet"/"bons plans" category (`BONSPLANS`) is NOT used: its tiles are
 *   last-chance prices with no reference price (`discount: 0`).
 * - Tiles carry no size list (quick-buy loads it per product), so no sizes.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { decodeEntities, jsonOf } from "./_sfcchtml";

export const brand = "courir";

const HOST = "https://www.courir.com";
const CGID = "PROMOTIONS-EN-COURS";
const PAGE = 36;
const MAX_PAGES = 15;
const CAP = 1500;

export const courirGridUrl = (start: number): string =>
  `${HOST}/on/demandware.store/Sites-Courir-FR-Site/fr_FR/Search-UpdateGrid?cgid=${CGID}&start=${start}&sz=${PAGE}`;

const eur = (v: string | undefined): number => {
  const n = parseFloat(String(v ?? "").replace(/^EUR\s*/, ""));
  return Number.isFinite(n) ? n : NaN;
};

function genderOf(category: string): ProductRecord["gender"] {
  const top = category.split("-")[0];
  if (top === "FEMME") return "kadin";
  if (top === "HOMME") return "erkek";
  if (top === "ENFANT" || top === "JUNIOR" || top === "BEBE") return "cocuk";
  return null;
}

const titleCase = (s: string): string => s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());

/** Parse one grid page. Pure. Only tiles with a struck reference price are kept. */
export function parseCourirGrid(html: string, country: CountryCode = "FR"): ProductRecord[] {
  const out: ProductRecord[] = [];
  for (const raw of html.split('js-product-tile"').slice(1)) {
    const block = raw.replace(/\s+/g, " ");
    const id = block.match(/^ ?data-itemid="([^"]+)"/)?.[1];
    if (!id) continue;
    const gtm = jsonOf<any>(decodeEntities(block.match(/data-gtm="([^"]+)"/)?.[1] ?? "")) ?? {};
    const was = eur(block.match(/js-product__default-price"[^>]*data-value="([^"]+)"/)?.[1]);
    const paid = eur(block.match(/js-product__promotional-price"[^>]*data-value="([^"]+)"/)?.[1]);
    if (!(paid > 0) || !(was > paid)) continue;
    const href = block.match(/href="(\/fr\/p\/[^"]+\.html)"/)?.[1];
    if (!href) continue;
    const imgs = [...new Set([...block.matchAll(/(\/on\/demandware\.static\/-\/Sites-master-catalog-courir\/[^"?\s]+\.jpg)/g)].map((m) => m[1]))].map(
      (p) => `${HOST}${p}?sw=800&sh=800&sm=fit`,
    );
    const make = decodeEntities(block.match(/js-product-name_brand">([^<]+)</)?.[1] ?? String(gtm.brand ?? "")).trim();
    const model = decodeEntities(block.match(/js-product-name_product">([^<]+)</)?.[1] ?? String(gtm.name ?? "")).trim();
    const category = String(gtm.category ?? block.match(/data-product-category="([^"]+)"/)?.[1] ?? "");
    out.push({
      brand,
      country,
      externalId: id,
      name: [titleCase(make), titleCase(model)].filter(Boolean).join(" "),
      url: `${HOST}${href}`,
      imageUrl: imgs[0] ?? null,
      images: cleanGallery(imgs, imgs[0] ?? null),
      price: toMinor(paid),
      listPrice: toMinor(was),
      currency: "EUR",
      inStock: true,
      category: category.split("-").slice(1).join(" ").toLowerCase() || null,
      maker: make ? titleCase(make) : null,
      gender: genderOf(category),
      variants: null,
      groupKey: null,
      colorName: null,
    });
  }
  return out;
}

export async function listCourir(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "FR") return [];
  const byId = new Map<string, ProductRecord>();
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page) await new Promise((r) => setTimeout(r, 700));
    const html = await getText(courirGridUrl(page * PAGE), {
      country,
      timeoutMs: 30000,
      headers: { "X-Requested-With": "XMLHttpRequest", "Accept-Language": "fr-FR,fr;q=0.9", Referer: `${HOST}/fr/c/promotions-en-cours/` },
    });
    const tiles = html.split('js-product-tile"').length - 1;
    for (const r of parseCourirGrid(html, country)) byId.set(r.externalId, r);
    // A page can hold one tile fewer than `sz` (a content slot), so stop on an empty page.
    if (tiles === 0) break;
  }
  return [...byId.values()].slice(0, CAP);
}

export const listProducts = listCourir;
