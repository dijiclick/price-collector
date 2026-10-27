/**
 * Etam group storefronts (Undiz, Etam) — Salesforce Commerce Cloud (SFRA),
 * sites `UNDIZ_FR` / `ETAM_FR`. Measured 2026-10-21:
 *
 * - Both answer a plain request (Cloudflare in front, no challenge) from GitHub
 *   runners and from here (probe run 39612615563).
 * - The grid is `Search-UpdateGrid?cgid=…&start=N&sz=N` with the XHR header the
 *   site's own script sends; `sz` up to 300 is honoured.
 * - A tile shows the price paid (`u-promo-color`) and, only when the product is
 *   genuinely reduced, the struck reference price (`tuileProductPrice -crossed`).
 *   Tiles without a crossed price are skipped — Etam's "derniers prix" and
 *   "promotions" pages carry none (multi-buy offers and last-chance prices with
 *   no reference), so Etam returns nothing outside the sales.
 * - The tile's quick-add panel lists every size with `data-available`, which is
 *   real per-size stock (restock alerts).
 * - Undiz's markdowns live in "archives" (`1-archives`, ~430 colours during
 *   the sale); its men's slice (`2-archives-homme`) is read first so those rows
 *   are tagged `erkek`. Everything else is women's lingerie/swim/nightwear.
 *   The categories were renamed on 2026-10-26 (`1-ventes-archives` and
 *   `2-promotion-homme` now answer an empty grid).
 * - Between sales (2026-10-27: 194 archive tiles, not one crossed price) the
 *   run is topped up to the cap with in-stock full-price rows from the
 *   site's `full` categories (`listPrice: null`), as Gullfunn and COS do —
 *   collecting nothing would leave last sale's rows live at their old prices
 *   and trip the zero-rows alarm. A full-price row later reduced is a real drop.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { decodeEntities } from "./_sfcchtml";

export type EtamBrand = "undiz" | "etam";

interface Cat { cgid: string; gender: ProductRecord["gender"] }
interface Site { host: string; site: string; locale: string; path: string; cats: Cat[]; full?: Cat[] }

export const ETAM_SITES: Record<EtamBrand, Partial<Record<CountryCode, Site>>> = {
  undiz: {
    FR: {
      host: "https://www.undiz.com", site: "UNDIZ_FR", locale: "fr_FR", path: "/fr",
      cats: [{ cgid: "2-archives-homme", gender: "erkek" }, { cgid: "1-archives", gender: "kadin" }],
      full: [{ cgid: "1-homme", gender: "erkek" }, { cgid: "1-bain", gender: "kadin" }, { cgid: "1-lingerie", gender: "kadin" }],
    },
  },
  etam: {
    FR: {
      host: "https://www.etam.com", site: "ETAM_FR", locale: "fr_FR", path: "",
      cats: [{ cgid: "DP", gender: "kadin" }, { cgid: "LIN_promotion", gender: "kadin" }],
    },
  },
};

const PAGE = 300;
const MAX_PAGES = 6;
const CAP = 1500;

export function etamGridUrl(brand: EtamBrand, country: CountryCode, cgid: string, start: number): string | null {
  const s = ETAM_SITES[brand][country];
  if (!s) return null;
  return `${s.host}/on/demandware.store/Sites-${s.site}-Site/${s.locale}/Search-UpdateGrid?cgid=${encodeURIComponent(cgid)}&start=${start}&sz=${PAGE}`;
}

/** "11,99 €" → 11.99 */
const euros = (s: string): number => {
  const n = parseFloat(decodeEntities(s).replace(/[^0-9,.]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Parse one grid page. Pure. Only tiles with a struck reference price are kept,
 * unless `fullPrice` (the between-sales top-up): then an unreduced tile is kept
 * too, with `listPrice: null`.
 */
export function parseEtamGrid(
  brand: EtamBrand, country: CountryCode, html: string, gender: ProductRecord["gender"], { fullPrice = false } = {},
): ProductRecord[] {
  const s = ETAM_SITES[brand][country];
  if (!s) return [];
  const out: ProductRecord[] = [];
  for (const raw of html.split(/class="pageDesigner__product productCard product-tile[^"]*"/).slice(1)) {
    const block = raw.replace(/\s+/g, " ");
    const pid = block.match(/^ ?data-pid="([^"]+)"/)?.[1] ?? block.match(/data-pid="([^"]+)"/)?.[1];
    if (!pid) continue;
    const was = euros(block.match(/tuileProductPrice -crossed[^"]*">([^<]+)</)?.[1] ?? "");
    const paid = euros(block.match(/tuileProductPrice u-promo-color">([^<]+)</)?.[1] ?? block.match(/tuileProductPrice">([^<]+)</)?.[1] ?? "");
    const reduced = was > paid;
    if (!(paid > 0) || !(reduced || fullPrice)) continue;
    const link = block.match(/<a href="([^"]+)" class="js-productLink productCard__nameTitleLink[^"]*"[^>]*>([^<]+)<\/a>/);
    if (!link) continue;
    const href = link[1];
    const name = decodeEntities(link[2]).replace(/\s+/g, " ").trim();
    // Every photo of the tile's slider, in order (the first is the packshot/on-model lead).
    const imgs = [...new Set([...block.matchAll(/(https:\/\/[^"\s,]+?\/on\/demandware\.static\/[^"\s,]+?\.jpg)/g)].map((m) => m[1]))].map(
      (u) => `${u}?sw=800&sh=952`,
    );
    const colour = block.match(/colorBubble -default -selected [^"]*" data-color="([^"]+)"/)?.[1] ?? null;
    const sizes: SizeVariant[] = [];
    for (const m of block.matchAll(/js-quickAddToCartSize[^"]*"[^>]*data-available="(true|false)"[^>]*>\s*<span class="sizeButton__content[^"]*">([^<]+)<\/span>/g)) {
      const label = decodeEntities(m[2]).trim();
      if (label && !sizes.some((x) => x.label === label)) sizes.push({ label, availability: m[1] === "true" ? "in_stock" : "out_of_stock" });
    }
    out.push({
      brand,
      country,
      externalId: pid,
      name,
      url: href.startsWith("http") ? href : `${s.host}${href}`,
      imageUrl: imgs[0] ?? null,
      images: cleanGallery(imgs, imgs[0] ?? null),
      price: toMinor(paid),
      listPrice: reduced ? toMinor(was) : null,
      currency: "EUR",
      inStock: sizes.length ? sizes.some((x) => x.availability === "in_stock") : true,
      category: null,
      gender,
      variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
      groupKey: null,
      colorName: colour,
    });
  }
  return out;
}

async function grid(brand: EtamBrand, country: CountryCode, s: Site, cgid: string, page: number): Promise<{ html: string; tiles: number }> {
  const html = await getText(etamGridUrl(brand, country, cgid, page * PAGE)!, {
    country,
    headers: { "X-Requested-With": "XMLHttpRequest", "Accept-Language": "fr-FR,fr;q=0.9", Referer: `${s.host}${s.path}/` },
  });
  return { html, tiles: html.split("js-productCard\"").length - 1 };
}

const pause = () => new Promise((r) => setTimeout(r, 600));

export async function listEtamGroup(brand: EtamBrand, country: CountryCode): Promise<ProductRecord[]> {
  const s = ETAM_SITES[brand][country];
  if (!s) return [];
  const byId = new Map<string, ProductRecord>();
  for (const cat of s.cats) {
    for (let page = 0; page < MAX_PAGES; page++) {
      if (byId.size || page) await pause();
      const { html, tiles } = await grid(brand, country, s, cat.cgid, page);
      for (const r of parseEtamGrid(brand, country, html, cat.gender)) if (!byId.has(r.externalId)) byId.set(r.externalId, r);
      if (tiles < PAGE) break;
    }
  }
  const all = [...byId.values()];
  const sale = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
  if (sale.length >= CAP || !s.full) return sale;

  // Top up with in-stock full-price rows (see the header).
  const full = new Map<string, ProductRecord>();
  for (const cat of s.full) {
    for (let page = 0; page < MAX_PAGES && sale.length + full.size < CAP; page++) {
      await pause();
      const { html, tiles } = await grid(brand, country, s, cat.cgid, page);
      for (const r of parseEtamGrid(brand, country, html, cat.gender, { fullPrice: true })) {
        if (r.inStock && !byId.has(r.externalId) && !full.has(r.externalId)) full.set(r.externalId, r);
      }
      if (tiles < PAGE) break;
    }
  }
  return [...sale, ...full.values()].slice(0, CAP);
}
