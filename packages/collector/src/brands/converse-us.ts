/**
 * Converse (US) — converse.com's Salesforce sale grid (2026-10-18).
 *
 * converse.com is Akamai: a browser UA and `okhttp` both get "Access Denied"
 * from a GitHub runner. An Apple networking-stack User-Agent
 * (`CFNetwork/… Darwin/…`, what an iOS app's URLSession sends) is let through
 * and gets the normal server-rendered grid — from a runner and from our
 * Hetzner box (probes 39134960170, 39135356161). Turkey keeps converse.ts
 * (converse.com.tr); this file is the US store only.
 *
 * `/shop/sale?format=page-element&start=N&sz=48` returns just the grid (~1 MB
 * per 48 tiles; 445 products on 2026-10-18 → ~10 requests). Each tile is one
 * colour (`data-item-id`), with the SFRA price block
 * `product-price--sales $44.97` + `product-price--standard Was $65.00`. A tile
 * showing only a price RANGE (sizes priced differently) has no single was/now
 * pair and is skipped rather than guessed.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { attrOf, decodeEntities } from "./_sfcchtml";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "converse";

const SITE = "https://www.converse.com";
const PAGE = 48;
const CAP = 1500;
const MAX_REQ = 14;

export const CONVERSE_HEADERS: Record<string, string> = {
  "User-Agent": "CFNetwork/1490.0.4 Darwin/23.2.0",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

export const saleGridUrl = (start: number, sz = PAGE) => `${SITE}/shop/sale?sz=${sz}&start=${start}&format=page-element`;

const money = (s: string | undefined): number | null => {
  const n = parseFloat(String(s ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const strip = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function genderOfBadge(badge: string): ProductRecord["gender"] {
  if (/\b(kid|kids|toddler|infant|baby|youth|big kids|little kids)\b/i.test(badge)) return "cocuk";
  if (/\bwomen'?s\b/i.test(badge)) return "kadin";
  if (/\bmen'?s\b/i.test(badge)) return "erkek";
  return null;
}

/** One `product-tile` chunk → a record, or null when it is not a single was/now markdown. Pure. */
export function mapConverseTile(tile: string): ProductRecord | null {
  const id = attrOf(tile.slice(0, 600), "data-item-id")?.trim();
  if (!id) return null;
  const nameA = tile.match(/<div class="product-tile__name">\s*<a ([^>]*)>([\s\S]*?)<\/a>/);
  const name = nameA ? strip(nameA[2]) : "";
  const href = nameA ? attrOf(`<a ${nameA[1]}>`, "href") ?? "" : "";
  if (!name || !href) return null;
  const priceBlock = tile.match(/data-product-price>([\s\S]*?)<\/div>\s*<\/div>/)?.[1] ?? "";
  if (/product-price--range/.test(priceBlock)) return null;
  const sale = money(priceBlock.match(/product-price--sales[^>]*>([^<]*)</)?.[1]);
  const was = money(priceBlock.match(/product-price--standard[^>]*>(?:\s*<span[^>]*>[^<]*<\/span>)?([^<]*)</)?.[1]);
  if (sale == null || was == null || sale >= was) return null;
  const url = new URL(href, SITE);
  // The colour param is keyed by the id in the PATH (A19713C), which is not
  // always the tile's item id (A19711MP).
  const pathId = url.pathname.match(/\/([A-Za-z0-9]+)\.html$/)?.[1] ?? id;
  const colour = url.searchParams.get(`dwvar_${pathId}_color`);
  url.search = colour ? `?dwvar_${pathId}_color=${encodeURIComponent(colour)}` : "";
  const shots = [...tile.matchAll(/<img[^>]*data-src="([^"]+)"/g)]
    .map((m) => decodeEntities(m[1]).replace(/sw=\d+/, "sw=900"))
    .filter((u) => u.startsWith("http") && !/noimage/.test(u));
  const grid = tile.match(/data-image-type="Gridwall">[\s\S]*?<img[^>]*data-src="([^"]+)"/)?.[1];
  const hero = grid ? decodeEntities(grid).replace(/sw=\d+/, "sw=900") : shots[0] ?? null;
  const badge = strip(tile.match(/product-tile__secondary-badge[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "");
  return {
    brand,
    country: "US",
    externalId: id,
    name,
    url: url.toString(),
    imageUrl: hero,
    images: cleanGallery(shots, hero),
    price: toMinor(sale),
    listPrice: toMinor(was),
    currency: "USD",
    inStock: true,
    category: badge || null,
    gender: genderOfBadge(badge),
    variants: null,
    groupKey: null,
    colorName: colour ? titleCase(colour) : null,
  };
}

export const tilesOf = (html: string): string[] => html.split('<div class="product-tile flex').slice(1);

export async function listConverseUs(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const byId = new Map<string, ProductRecord>();
  for (let start = 0, req = 0; req < MAX_REQ && byId.size < CAP; start += PAGE, req++) {
    if (req) await new Promise((r) => setTimeout(r, 800));
    const html = await getText(saleGridUrl(start), { country, headers: CONVERSE_HEADERS, timeoutMs: 45_000 });
    const tiles = tilesOf(html);
    let seen = 0;
    for (const t of tiles) {
      const id = attrOf(t.slice(0, 600), "data-item-id");
      if (id && !byId.has(id)) seen++;
      const r = mapConverseTile(t);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (tiles.length < PAGE || !seen) break;
  }
  return [...byId.values()].slice(0, CAP);
}
