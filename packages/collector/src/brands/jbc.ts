/**
 * JBC (jbc.be) — Belgian family fashion chain on Salesforce Commerce Cloud
 * (SFRA), Belgium only. Both endpoints below answer a GitHub runner through
 * Cloudflare with a plain browser UA (probe run 39636006759, 2026-10-21).
 *
 * The grid is lazy: `Search-UpdateGrid` returns only skeleton placeholders
 * (`data-skeleton-product-id`), and the storefront then fills them in
 * batches through `Tile-ShowChunk?chunkData=<[{pid,cgid},…]>` — the same
 * call is used here, 50 tiles per request.
 *
 * Markdown shelf: "Solden" (`cgid=178613`, the /nl-be/solden/ page; 1,648
 * items on 2026-10-21). Each tile shows a `text-decoration-strike-through
 * list` price and a `sales` price (both `data-price`), plus an analytics
 * meta with the category path ("Dames/Kleding/Shorts"), department (D/H/M/J/B)
 * and `discount`. Only list > sales is kept. One tile = one style in one
 * colour (`321072BLD`); the grid lists only sellable styles.
 *
 * Tile-ShowChunk is slow (~10 s per 50 tiles), so chunks run four at a time.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { decodeEntities, jsonOf } from "./_sfcchtml";
import { nlType } from "./_nltypes";

const ORIGIN = "https://www.jbc.be";
const BASE = `${ORIGIN}/on/demandware.store/Sites-JBC-Webshop-BE-Site/nl_BE`;
const CGID = "178613";
const GRID_PAGE = 100;
const MAX_GRID_PAGES = 20;
const CHUNK = 50;
const PARALLEL = 4;
const CAP = 1500;
const PAUSE_MS = Number(process.env.JBC_PAUSE_MS ?? 400);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const jbcGridUrl = (start: number): string => `${BASE}/Search-UpdateGrid?cgid=${CGID}&start=${start}&sz=${GRID_PAGE}`;

/** The storefront double-encodes chunkData (encodeURIComponent, then jQuery's own encoding). */
export const jbcChunkUrl = (pids: string[]): string =>
  `${BASE}/Tile-ShowChunk?chunkData=${encodeURIComponent(encodeURIComponent(JSON.stringify(pids.map((pid) => ({ pid, cgid: CGID })))))}`;

/** Skeleton product ids on a grid page, in order. Pure. */
export function jbcGridPids(html: string): string[] {
  return [...html.matchAll(/data-skeleton-product-id="([^"]+)"/g)].map((m) => m[1]);
}

/** "100 van 1.648 items" → 1648. */
export function jbcTotal(html: string): number {
  const m = html.match(/data-results-count="[^"]*?van ([0-9.]+)/);
  return m ? Number(m[1].replace(/\./g, "")) : NaN;
}

/** Split a chunk response into product tiles. Pure. */
export function jbcTiles(html: string): string[] {
  return html.split(/<article class="product-tile/).slice(1).map((t) => '<article class="product-tile' + t);
}

const GENDER: Record<string, ProductRecord["gender"]> = { D: "kadin", H: "erkek", M: "cocuk", J: "cocuk", B: "cocuk" };

/** One tile → a record, or null when it carries no struck price. Pure. */
export function mapJbcTile(tile: string, country: CountryCode = "BE"): ProductRecord | null {
  const pid = tile.match(/data-pid="([^"]+)"/)?.[1];
  const meta = jsonOf<any>(decodeEntities(tile.match(/<meta itemprom="analytics" content="([^"]+)"/)?.[1] ?? "")) ?? {};
  const was = parseFloat(tile.match(/text-decoration-strike-through list[^"]*" data-price="([0-9.]+)"/)?.[1] ?? "");
  const price = parseFloat(tile.match(/class="sales[^"]*" data-price="([0-9.]+)"/)?.[1] ?? "");
  if (!pid || !Number.isFinite(price) || price <= 0 || !Number.isFinite(was) || was <= price) return null;
  const href = tile.match(/<a class="product-tile-name-pdp-link" href="([^"]+)"/)?.[1] ?? tile.match(/href="([^"]+)" data-encoded-product-id/)?.[1];
  const name = decodeEntities(tile.match(/<h3[^>]*>([^<]*)<\/h3>/)?.[1] ?? String(meta.name ?? "")).trim();
  if (!href || !name) return null;
  const maker = decodeEntities(tile.match(/class="product-tile-brand[^"]*"[^>]*>\s*([^<]+?)\s*<\/a>/)?.[1] ?? "").trim() || null;
  // Tile images are 300 px renditions on ImageKit; ask for 1200.
  const imgs = [...tile.matchAll(/data-src="(https:\/\/media\.jbc\.be\/[^"]+)"/g)].map((m) => decodeEntities(m[1]).replace(/,w-\d+\//, ",w-1200/"));
  const images = cleanGallery(imgs);
  const path = String(meta.category ?? "");
  const colour = typeof meta.variant === "string" && meta.variant ? meta.variant : null;
  const style = pid.replace(/[A-Z]{3}$/, "");
  return {
    brand: "jbc",
    country,
    externalId: pid,
    name,
    url: `${ORIGIN}${decodeEntities(href)}`,
    imageUrl: images?.[0] ?? null,
    images,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: "EUR",
    inStock: true,
    category: nlType(meta.detailedprodgroup, path.split("/").pop(), name) ?? (String(meta.detailedprodgroup ?? "") || null),
    maker: maker && !/^jbc$/i.test(maker) ? maker : null,
    gender: GENDER[String(meta.department ?? "")] ?? null,
    groupKey: style && style !== pid ? `jbc-${style}` : null,
    colorName: colour,
  };
}

/** Register as `listJbc(country)`. BE only. */
export async function listJbc(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "BE") return [];
  const pids: string[] = [];
  let total = NaN;
  for (let page = 0; pids.length < CAP; page++) {
    if (page >= MAX_GRID_PAGES) throw new Error(`jbc: more than ${MAX_GRID_PAGES} grid pages`);
    if (page) await sleep(PAUSE_MS);
    const html = await getText(jbcGridUrl(page * GRID_PAGE), { country, timeoutMs: 60_000 });
    if (page === 0) total = jbcTotal(html);
    const got = jbcGridPids(html);
    for (const p of got) if (!pids.includes(p)) pids.push(p);
    if (got.length < GRID_PAGE || pids.length >= total) break;
  }
  if (!pids.length) throw new Error("jbc: Solden grid is empty");
  const want = pids.slice(0, CAP);
  const chunks: string[][] = [];
  for (let i = 0; i < want.length; i += CHUNK) chunks.push(want.slice(i, i + CHUNK));
  const byId = new Map<string, ProductRecord>();
  let tilesSeen = 0;
  for (let i = 0; i < chunks.length; i += PARALLEL) {
    if (i) await sleep(PAUSE_MS);
    const pages = await Promise.all(chunks.slice(i, i + PARALLEL).map((c) => getText(jbcChunkUrl(c), { country, timeoutMs: 90_000 })));
    for (const html of pages) {
      for (const t of jbcTiles(html)) {
        tilesSeen++;
        const r = mapJbcTile(t, country);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
    }
  }
  // A chunk that silently came back short would drop products without a trace.
  if (tilesSeen < want.length * 0.9) throw new Error(`jbc: asked for ${want.length} tiles, got ${tilesSeen}`);
  return [...byId.values()];
}
