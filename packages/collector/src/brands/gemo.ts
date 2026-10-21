/**
 * Gémo (France) — Proximis/RBS Change storefront, measured 2026-10-21.
 *
 * gemo.fr answers a plain request (Cloudflare in front, no challenge) from
 * GitHub runners (probe run 39612615563) and from here. Its Algolia search is
 * called server-side (no key reaches the browser), so the product lists come
 * as server-rendered HTML: the promotions hub "sélection promos"
 * (`/sous-categorie/toutes-cibles/selection-promos/cat181124px`, ~40 products,
 * 30 a page, `?pageNumber-2=N` for the next page — block id 2).
 *
 * Each tile has the price paid (`productPrice-value--main`), the struck
 * reference price (`<s class="price-old-value" title="ancien prix">`) and the
 * percentage. Tiles without a struck price are skipped. No sizes on the tile.
 * Gender comes from the product name/URL (femme/homme/fille/garçon/bébé).
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { decodeEntities } from "./_sfcchtml";

export const brand = "gemo";

const HOST = "https://www.gemo.fr";
const LIST = "/sous-categorie/toutes-cibles/selection-promos/cat181124px";
const PER_PAGE = 30;
const MAX_PAGES = 20;

export const gemoListUrl = (page: number): string => `${HOST}${LIST}${page > 1 ? `?pageNumber-2=${page}` : ""}`;

const euros = (s: string | undefined): number => {
  const n = parseFloat(decodeEntities(String(s ?? "")).replace(/[^0-9,]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

export function gemoGender(text: string): ProductRecord["gender"] {
  const t = text.toLowerCase();
  if (/\b(b[eé]b[eé]|fille|gar[cç]on|enfant|junior)\b/.test(t)) return "cocuk";
  if (/\bfemme\b/.test(t)) return "kadin";
  if (/\bhomme\b/.test(t)) return "erkek";
  return null;
}

/** Parse one list page. Pure. Only tiles with a struck "ancien prix" are kept. */
export function parseGemoList(html: string, country: CountryCode = "FR"): ProductRecord[] {
  const out: ProductRecord[] = [];
  for (const raw of html.split('class="productTile" data-product-list-tile').slice(1)) {
    const block = raw.replace(/\s+/g, " ");
    const link = block.match(/<a [^>]*href="(https:\/\/www\.gemo\.fr\/produit\/[^"]+\/GEMO_(\d+))"[^>]*class="[^"]*productTile-linkCover[^"]*">([^<]+)<\/a>/);
    if (!link) continue;
    const paid = euros(block.match(/productPrice-value--main">([^<]+)</)?.[1]);
    const was = euros(block.match(/<s class="price-old-value[^"]*"[^>]*>([^<]+)<\/s>/)?.[1]);
    if (!(paid > 0) || !(was > paid)) continue;
    // Largest rendition from the srcset (e.g. 618/744), then the plain src.
    const srcset = block.match(/<img [^>]*srcset="([^"]+)"/)?.[1] ?? "";
    const sizes = srcset.split(",").map((x) => x.trim().split(/\s+/)[0]).filter((u) => u.startsWith("https://"));
    const lead = sizes[sizes.length - 1] ?? block.match(/<img [^>]*src="(https:\/\/[^"]+)"/)?.[1] ?? null;
    const name = decodeEntities(link[3]).replace(/\s+/g, " ").trim();
    const colours = [...block.matchAll(/colorSwatches-swatch[^>]*>\s*<span class="sr-only">([^<]+)<\/span>/g)].map((m) => decodeEntities(m[1]).trim());
    out.push({
      brand,
      country,
      externalId: link[2],
      name,
      url: link[1],
      imageUrl: lead,
      images: cleanGallery(lead ? [lead] : [], lead),
      price: toMinor(paid),
      listPrice: toMinor(was),
      currency: "EUR",
      inStock: true,
      category: null,
      gender: gemoGender(`${name} ${link[1]}`),
      variants: colours.length ? { colors: colours, sizes: [] } : null,
      groupKey: null,
      colorName: null,
    });
  }
  return out;
}

export async function listGemo(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "FR") return [];
  const byId = new Map<string, ProductRecord>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) await new Promise((r) => setTimeout(r, 700));
    const html = await getText(gemoListUrl(page), { country, timeoutMs: 30000, headers: { "Accept-Language": "fr-FR,fr;q=0.9" } });
    const before = byId.size;
    const tiles = html.split('class="productTile" data-product-list-tile').length - 1;
    for (const r of parseGemoList(html, country)) byId.set(r.externalId, r);
    // A page past the end repeats nothing new (or is empty).
    if (tiles < PER_PAGE || byId.size === before) break;
  }
  return [...byId.values()];
}

export const listProducts = listGemo;
