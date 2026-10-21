/**
 * TOUS (tous.com) — Spanish jewellery, bags and accessories, Salesforce
 * Commerce Cloud (Sites-tous_eu) behind Cloudflare.
 *
 * The storefront silently drops browser User-Agents from outside a real
 * browser (the connection hangs until timeout — Mac and GitHub runner alike,
 * probe run 39612079467), while a plain `curl/8.0` UA is served the normal
 * HTML. The feed is the "Precios especiales" (markdown) category's listing
 * pages, with SFRA paging (`?start=N&sz=48`) on the listing path.
 *
 * Each tile carries a `data-datalayer` JSON (name, `im_original_price`, size
 * availability codes) and the SFRA price block (`sales` value, struck
 * `strike-through list` value). The listing only shows sellable products;
 * ring sizes come from `im_product_size_avail` / `_no_avail` ("SZ01_14").
 *
 * Shelves: the nav links every leaf of "precios-especiales" (bolsos,
 * accesorios, anillos, pendientes, …); each is read round-robin with its name
 * as the category, then the root as a catch-all.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { attrOf, decodeEntities, jsonOf } from "./_sfcchtml";

const ORIGIN = "https://www.tous.com";
const MARKETS: Partial<Record<CountryCode, string>> = { ES: "/es-es" };
const UA = "curl/8.0";
const PAGE = 48;
const MAX_REQUESTS = 30;
const CAP = 1500;
const PAUSE_MS = Number(process.env.TOUS_PAUSE_MS ?? 500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clean = (s: unknown): string => (typeof s === "string" ? decodeEntities(s).replace(/\s+/g, " ").trim() : "");

/** Markdown shelves linked from the homepage: leaves first, the root last. Pure. */
export function tousShelves(home: string, prefix: string): string[] {
  const all = new Set<string>();
  for (const m of home.matchAll(/href="(?:https:\/\/www\.tous\.com)?(\/[a-z]{2}-[a-z]{2}\/precios-especiales\/(?:[a-z0-9-]+\/)*c\/\d+)"/g)) {
    if (m[1].startsWith(prefix + "/")) all.add(m[1]);
  }
  const list = [...all];
  const base = (p: string) => p.replace(/c\/\d+$/, "");
  const leaves = list.filter((p) => !list.some((q) => q !== p && base(q).startsWith(base(p))));
  const root = list.filter((p) => !leaves.includes(p) && /\/precios-especiales\/c\/\d+$/.test(p));
  return [...leaves.sort(), ...root];
}

/** "/es-es/precios-especiales/joyeria/anillos/c/5538" → "anillos"; the root → null. Pure. */
export function tousShelf(path: string): string | null {
  const seg = path.replace(/\/c\/\d+$/, "").split("/").pop() ?? "";
  return seg && seg !== "precios-especiales" ? seg.replace(/-/g, " ") : null;
}

/** "SZ01_08, SZ01_10" → ["8", "10"]; "U"/"not apply" → []. Pure. */
export function sizeCodes(v: unknown): string[] {
  if (typeof v !== "string" || /^(u|not apply)?$/i.test(v.trim())) return [];
  return v.split(",").map((s) => s.trim().replace(/^SZ\d+_0*/i, "")).filter(Boolean);
}

export function tousTiles(html: string): string[] {
  return html.split('<div class="product js-product"').slice(1).map((t) => '<div class="product js-product"' + t);
}

/** One tile → a record, or null when it has no struck price. Pure. */
export function mapTous(tile: string, shelf: string | null = null, country: CountryCode = "ES"): ProductRecord | null {
  const head = tile.slice(0, tile.indexOf(">") + 1);
  const pid = attrOf(head, "data-pid");
  const d = jsonOf<any>(attrOf(head, "data-datalayer") ?? "")?.data ?? {};
  const price = parseFloat(tile.match(/<span class="sales">\s*<span class="value" content="([0-9.]+)"/)?.[1] ?? "");
  const was = parseFloat(tile.match(/strike-through list">\s*<span class="value" content="([0-9.]+)"/)?.[1] ?? "");
  const name = clean(d.item_name) || clean(tile.match(/<p class="name">([^<]*)<\/p>/)?.[1]);
  if (!pid || !name || !Number.isFinite(price) || price <= 0 || !Number.isFinite(was) || was <= price) return null;
  const href = tile.match(/<a href="([^"]+)" class="js-pdp-url"/)?.[1];
  if (!href) return null;
  const photos = [...tile.matchAll(/<img class="tile-image[^"]*"[^>]*\ssrc="([^"]+)"/g)].map((m) =>
    decodeEntities(m[1]).replace(/\?w=\d+$/, "?w=1000"),
  );
  const images = cleanGallery(photos);
  const sizes: SizeVariant[] = [
    ...sizeCodes(d.im_product_size_avail).map((label) => ({ label, availability: "in_stock" as const })),
    ...sizeCodes(d.im_product_size_no_avail).map((label) => ({ label, availability: "out_of_stock" as const })),
  ];
  return {
    brand: "tous",
    country,
    externalId: pid,
    name,
    url: `${ORIGIN}${decodeEntities(href)}`,
    imageUrl: images?.[0] ?? null,
    images,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: "EUR",
    inStock: sizes.length === 0 || sizes.some((s) => s.availability === "in_stock"),
    category: shelf,
    gender: "kadin",
    variants: sizes.length ? { colors: [], sizes } : null,
    groupKey: null,
    colorName: null,
  };
}

/** Register as `listTous(country)`. ES only. */
export async function listTous(country: CountryCode): Promise<ProductRecord[]> {
  const prefix = MARKETS[country];
  if (!prefix) return [];
  const opts = { country, timeoutMs: 45_000, headers: { "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9" } };
  const shelves = tousShelves(await getText(`${ORIGIN}${prefix}/`, opts), prefix);
  if (!shelves.length) return []; // no markdown running
  const byId = new Map<string, ProductRecord>();
  const next = new Map<string, number>(shelves.map((s) => [s, 0]));
  let requests = 1;
  while (next.size && requests < MAX_REQUESTS && byId.size < CAP) {
    for (const [path, start] of [...next]) {
      if (requests >= MAX_REQUESTS || byId.size >= CAP) break;
      await sleep(PAUSE_MS);
      requests++;
      const tiles = tousTiles(await getText(`${ORIGIN}${path}?start=${start}&sz=${PAGE}`, opts));
      for (const t of tiles) {
        const r = mapTous(t, tousShelf(path), country);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (tiles.length < PAGE) next.delete(path);
      else next.set(path, start + PAGE);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
