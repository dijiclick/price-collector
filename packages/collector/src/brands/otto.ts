/**
 * OTTO (otto.de) — women's and men's reduced fashion, Germany only (2026-11-10).
 *
 * Category, search and product PAGES sit behind Kasada (400 "KPSDK" for a
 * runner and for a home IP alike). The product list's own client script
 * (`static.otto.de/dundee/assets/reptile.dundee.TileList…js`) reads two JSON
 * endpoints that are NOT behind it, and neither needs a cookie or token:
 *
 *  1. `GET /everglades/products?rule=<selection>&intents=ranked&ranked.offset=N
 *     &ranked.limit=120` (`accept: application/json`) — the ranked product ids
 *     of a selection rule, each with its `bestVariationId`. 120 is the largest
 *     page (300 answers 400). Rule language is the site's own "selektion":
 *     `(und.(ist.reduziert).(ist.sortiment.bekleidung.schuhe).(ist.zielgruppe.damen).(~.(v.1)))`.
 *  2. `GET /crocotile/tile/data?variationIds=a,b,…` (headers `crocotile-version: 2`,
 *     `otto-feature: tilelist@RepTile-Dundee`) — the tile data of up to 120
 *     variations in one call: brand, title, photos, colour, price block.
 *
 * Both verified from a GitHub runner (probe run 42802867759: 200, EUR, German
 * texts). Measured 2026-11-10: women 14,100–14,608 reduced products, men 17,575.
 *
 * Price block: `retailPrice` (now), `comparativePrice` (OTTO's own earlier
 * price, shown struck) and/or `suggestedRetailPrice` (the maker's UVP, shown as
 * "UVP"), `sale`, `isStartingPrice` ("ab …" — a range across sizes/sellers).
 * Kept: `sale` rows that are not a starting price, struck against
 * `comparativePrice` when there is one, else the UVP. On a 120-tile sample 43
 * qualified, 13 of them with a comparativePrice — MOST struck prices here are
 * UVPs. Only rows struck against OTTO's own earlier price are kept (as breuninger.ts does);
 * set `OTTO_UVP=1` to also keep UVP-struck rows. A rule's "best variation" is often not the reduced one, which is why
 * only about a third of the tiles survive.
 *
 * Marketplace: ~half the rows are third-party sellers' goods. The tile has no
 * size list (only `multipleSizes`), so no per-size stock. 28 pages × 2 calls =
 * 56 requests a sweep.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";

const SITE = "https://www.otto.de";
export const OTTO_TREES: { rule: string; gender: "kadin" | "erkek"; pages: number }[] = [
  { rule: "(und.(ist.reduziert).(ist.sortiment.bekleidung.schuhe).(ist.zielgruppe.damen).(~.(v.1)))", gender: "kadin", pages: 20 },
  { rule: "(und.(ist.reduziert).(ist.sortiment.bekleidung.schuhe).(ist.zielgruppe.herren).(~.(v.1)))", gender: "erkek", pages: 8 },
];
const PAGE = 120;
const CAP = 1800;
const PAUSE_MS = Number(process.env.OTTO_PAUSE_MS ?? 400);
const ALLOW_UVP = process.env.OTTO_UVP === "1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LANG = { "Accept-Language": "de-DE,de;q=0.9" };

export const listUrl = (rule: string, offset: number) =>
  `${SITE}/everglades/products?intents=ranked&ranked.offset=${offset}&ranked.limit=${PAGE}&rule=${encodeURIComponent(rule).replace(/\(/g, "%28").replace(/\)/g, "%29")}`;
export const tilesUrl = (ids: string[]) => `${SITE}/crocotile/tile/data?variationIds=${ids.map(encodeURIComponent).join(",")}`;

/** "1.299,00" / "60,99" → cents; null for anything else. */
export function euroCents(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, "")) * 100 + Number(m[2]);
  return n > 0 ? n : null;
}

/** The best-variation ids of one everglades page, organic rows only, in rank order. */
export function variationIds(res: any): string[] {
  const ranked = (Array.isArray(res?.intents) ? res.intents : []).find((i: any) => i?.intent === "ranked");
  const out: string[] = [];
  for (const p of Array.isArray(ranked?.products) ? ranked.products : []) {
    if (p?.productType !== "organic") continue;
    if (typeof p.bestVariationId === "string" && p.bestVariationId) out.push(p.bestVariationId);
  }
  return [...new Set(out)];
}

/** One crocotile tile → a record; null unless it is a reduced, single-priced row. */
export function toRecord(t: any, gender: ProductRecord["gender"], allowUvp: boolean = ALLOW_UVP): ProductRecord | null {
  const id = typeof t?.variationId === "string" ? t.variationId : "";
  const link = typeof t?.detailPageLink === "string" ? t.detailPageLink : "";
  const name = typeof t?.title?.full === "string" ? t.title.full.trim() : "";
  if (!id || !name || !/^\/p\/[^/]+\//.test(link)) return null;
  const p = t.price ?? {};
  if (p.sale !== true || p.isStartingPrice === true) return null;
  const price = euroCents(p.retailPrice);
  const own = euroCents(p.comparativePrice);
  const uvp = allowUvp ? euroCents(p.suggestedRetailPrice) : null;
  const listPrice = own && price && own > price ? own : uvp;
  if (!price || !listPrice || listPrice <= price) return null;

  const imgs: (string | null)[] = (Array.isArray(t.images) ? t.images : []).map((i: any) =>
    typeof i?.id === "string" && i.id ? `https://i.otto.de/i/otto/${i.id}?w=800&h=1000&fmt=jpg` : null,
  );
  const colour = t.colors?.[id]?.name;
  return {
    brand: "otto",
    country: "DE",
    externalId: id,
    name,
    url: `${SITE}${link}`,
    imageUrl: imgs.find(Boolean) ?? null,
    images: cleanGallery(imgs),
    price,
    listPrice,
    currency: "EUR",
    inStock: t.availability?.state === "AVAILABLE",
    category: typeof t.pbk === "string" && t.pbk ? t.pbk : null,
    maker: typeof t.brand === "string" && t.brand.trim() ? t.brand.trim() : null,
    gender,
    variants: null,
    groupKey: null,
    colorName: typeof colour === "string" && colour ? colour : null,
  };
}

export async function listOtto(
  country: CountryCode,
  fetchJson: (u: string, headers: Record<string, string>) => Promise<any> = (u, headers) =>
    getJson(u, { country, timeoutMs: 45_000, headers: { ...LANG, ...headers } }),
): Promise<ProductRecord[]> {
  if (country !== "DE") throw new Error(`otto: no market ${country}`);
  const byId = new Map<string, ProductRecord>();
  let first = true;
  for (const tree of OTTO_TREES) {
    for (let page = 0; page < tree.pages; page++) {
      let ids: string[];
      let tiles: any;
      try {
        ids = variationIds(await fetchJson(listUrl(tree.rule, page * PAGE), {}));
        if (first && !ids.length) throw new Error("otto: empty first page");
        if (!ids.length) break;
        tiles = await fetchJson(tilesUrl(ids), { "crocotile-version": "2", "otto-feature": "tilelist@RepTile-Dundee" });
      } catch (e) {
        if (first) throw e;
        break;
      }
      first = false;
      for (const t of Array.isArray(tiles) ? tiles : []) {
        const rec = toRecord(t, tree.gender);
        if (rec && !byId.has(rec.externalId)) byId.set(rec.externalId, rec);
      }
      if (ids.length < PAGE / 2) break;
      await sleep(PAUSE_MS);
    }
  }
  const rows = [...byId.values()];
  return [...rows.filter((r) => r.inStock), ...rows.filter((r) => !r.inStock)].slice(0, CAP);
}
