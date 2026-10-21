/**
 * Motivi (motivi.com) — Italian women's fashion (Miroglio group), EUR. Added 2026-10-21.
 *
 * Salesforce Commerce Cloud (SFRA, site `motivi_global`). The sale category's
 * grid answers `Search-UpdateGrid` (`X-Requested-With: XMLHttpRequest`) from a
 * GitHub runner (probe run 39635106148: 200), no proxy. `start`/`sz` page it;
 * the "Altro" (load more) button disappears on the last page.
 *
 * - Category `mid-season-sale` (133 colours on 2026-10-21, up to −50%).
 * - Each tile: `data-pid` (one colour), the strike price in
 *   `.strike-through.list .value[content]` and the selling price in
 *   `.sales .value[content]` — the storefront's own price model. Tiles
 *   without a strike price are skipped.
 * - The store is Italian-only (no English locale) and women-only.
 * - The grid lists orderable colours only; per-size stock is not in the tile.
 */
import type { ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const SITE = "https://www.motivi.com";
const GRID = `${SITE}/on/demandware.store/Sites-motivi_global-Site/it_IT/Search-UpdateGrid`;
export const SALE_CGIDS = ["mid-season-sale"];
const PAGE = 48;
const MAX_PAGES = 20;
const CAP = 1500;
const PAUSE_MS = 1200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const decode = (s: string): string =>
  s.replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&euro;/g, "€").trim();

export function splitTiles(html: string): string[] {
  const idx: number[] = [];
  const re = /<div class="product" data-pid="/g;
  for (let m; (m = re.exec(html)); ) idx.push(m.index);
  return idx.map((s, i) => html.slice(s, idx[i + 1] ?? html.length));
}

/** The grid's "Altro" (load more) button is present while pages remain. Pure. */
export const hasMore = (html: string): boolean => /class="btn[^"]*\bmore\b"\s+data-url=/.test(html);

/** Map one tile (deals only). Pure. */
export function mapMotiviTile(tile: string, country: CountryCode = "IT"): ProductRecord | null {
  const pid = tile.match(/data-pid="([^"]+)"/)?.[1];
  const master = tile.match(/data-masterid="([^"]+)"/)?.[1] ?? null;
  const was = Number(tile.match(/strike-through list">[\s\S]*?content="([\d.]+)"/)?.[1]);
  const price = Number(tile.match(/class="sales[^"]*">[\s\S]*?content="([\d.]+)"/)?.[1]);
  const link = tile.match(/<a class="link" href="([^"]+)">([^<]+)<\/a>/);
  if (!pid || !link || !Number.isFinite(price) || price <= 0 || !Number.isFinite(was) || was <= price) return null;
  const imgs = [...tile.matchAll(/<img\s[^>]*class="tile-image"[^>]*\ssrc="([^"]+)"/g)].map((m) => (m[1].startsWith("http") ? m[1] : `${SITE}${m[1]}`));
  const colour =
    [...tile.matchAll(/<a\s+href="([^"]+)"\s+class="color-swatch-link"\s+data-value="([^"]+)"/g)].find((m) => m[1] === link[1])?.[2] ?? null;
  return {
    brand: "motivi",
    country,
    externalId: pid,
    name: decode(link[2]),
    url: `${SITE}${link[1]}`,
    imageUrl: imgs[0] ?? null,
    images: imgs.length ? imgs.slice(0, 6) : null,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: "EUR",
    inStock: true,
    category: null,
    gender: "kadin",
    groupKey: master ? `motivi:${master}` : null,
    colorName: colour,
  };
}

export const gridUrl = (cgid: string, start: number): string => `${GRID}?cgid=${cgid}&start=${start}&sz=${PAGE}`;

/** Register as `listMotivi(country)`. IT only. */
export async function listMotivi(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "IT") return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const cgid of SALE_CGIDS) {
    let done = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      const html = await getText(gridUrl(cgid, page * PAGE), {
        country,
        timeoutMs: 60_000,
        headers: { "X-Requested-With": "XMLHttpRequest", "Accept-Language": "it-IT,it;q=0.9" },
      });
      const tiles = splitTiles(html);
      for (const t of tiles) {
        const r = mapMotiviTile(t, country);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      // A full page with no "more" button, or a short page, is the end.
      if (tiles.length < PAGE || !hasMore(html)) {
        done = true;
        break;
      }
    }
    if (!done) throw new Error(`motivi/${country}: ${cgid} still had pages after ${MAX_PAGES}`);
  }
  return [...byId.values()].slice(0, CAP);
}
