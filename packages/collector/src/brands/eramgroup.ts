/**
 * Groupe Éram shoe storefronts — Eram (eram.fr) and Bocage (bocage.fr), the
 * permanent OUTLET trees, France (2026-11-10).
 *
 * Both run the same Magento 2 build (same theme, same tile markup). The list
 * pages are server-rendered and unwalled: 200 from a GitHub runner (probe run
 * 42802562380, `?p=2` of each) and from the Mac. 24 tiles a page, `?p=N`.
 * `product_list_limit` is ignored, and a page past the end answers page 1 again
 * — so a walk ends at the first page that brings no new product.
 *
 * A tile (`<li class="item product product-item">`) holds the product id
 * (`product-item-info_<id>`), link, name, colour, photos, the size list with
 * `in-stock` / `out-of-stock` per size, and the Magento price box:
 * `data-price-type="finalPrice"` and, only when reduced, `"oldPrice"`. Tiles
 * without an old price above the final price are skipped.
 *
 * EUR, France only (no BE/CH storefronts on these hosts). ~750 KB of HTML a
 * page; ≤ 30 women + ≤ 10 men pages a brand.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { decodeEntities } from "./_sfcchtml";

export type EramBrand = "eram" | "bocage";
interface Tree { path: string; gender: "kadin" | "erkek"; pages: number }
export const ERAM_SITES: Record<EramBrand, { host: string; trees: Tree[] }> = {
  eram: {
    host: "https://www.eram.fr",
    trees: [
      { path: "/outlet/femme.html", gender: "kadin", pages: 30 },
      { path: "/outlet/homme.html", gender: "erkek", pages: 10 },
    ],
  },
  bocage: {
    host: "https://www.bocage.fr",
    trees: [
      { path: "/femme/outlet.html", gender: "kadin", pages: 30 },
      { path: "/homme/outlet.html", gender: "erkek", pages: 10 },
    ],
  },
};
const CAP = 1500;
const PAUSE_MS = Number(process.env.ERAM_PAUSE_MS ?? 600);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Every reduced tile of a list page. Pure. */
export function parseEramGrid(brand: EramBrand, html: string, gender: ProductRecord["gender"]): ProductRecord[] {
  const out: ProductRecord[] = [];
  for (const raw of html.split('<li class="item product product-item">').slice(1)) {
    const t = raw.replace(/\s+/g, " ");
    const id = t.match(/id="product-item-info_(\d+)"/)?.[1];
    const link = t.match(/<a class="product-item-link" href="(https:\/\/[^"]+)">([^<]+)<\/a>/);
    const price = Number(t.match(/data-price-amount="([\d.]+)" data-price-type="finalPrice"/)?.[1] ?? NaN);
    const was = Number(t.match(/data-price-amount="([\d.]+)" data-price-type="oldPrice"/)?.[1] ?? NaN);
    if (!id || !link || !(price > 0) || !(was > price)) continue;
    const imgs = [
      ...new Set(
        [...t.matchAll(/class="product-image-photo[^"]*"[^>]*?(?:src|data-lazy)="(https:\/\/[^"?]+\/media\/catalog\/product\/[^"?]+)\?/g)].map(
          (m) => `${m[1]}?width=1040&height=1040&canvas=1040,1040&optimize=medium&bg-color=255,255,255&fit=bounds`,
        ),
      ),
    ];
    const sizes: SizeVariant[] = [];
    const list = t.match(/<div class="size-list-wrapper">(.*?)<\/div>/)?.[1] ?? "";
    for (const m of list.matchAll(/<span class="option (in-stock|out-of-stock)[^"]*">\s*([^<]+?)\s*<\/span>/g)) {
      const label = decodeEntities(m[2]).trim();
      if (label && !sizes.some((s) => s.label === label)) sizes.push({ label, availability: m[1] === "in-stock" ? "in_stock" : "out_of_stock" });
    }
    const colour = t.match(/<div class="swatch-option current" >\s*<span class="swatch-label">\s*([^<]+?)\s*<\/span>/)?.[1] ?? null;
    out.push({
      brand,
      country: "FR",
      externalId: id,
      name: decodeEntities(link[2]).replace(/\s+/g, " ").trim(),
      url: link[1],
      imageUrl: imgs[0] ?? null,
      images: cleanGallery(imgs, imgs[0] ?? null),
      price: toMinor(price),
      listPrice: toMinor(was),
      currency: "EUR",
      inStock: sizes.length ? sizes.some((s) => s.availability === "in_stock") : true,
      category: null,
      gender,
      variants: sizes.length ? { colors: colour ? [decodeEntities(colour)] : [], sizes } : null,
      groupKey: null,
      colorName: colour ? decodeEntities(colour) : null,
    });
  }
  return out;
}

export async function listEramGroup(
  brand: EramBrand,
  country: CountryCode,
  fetchHtml: (u: string) => Promise<string> = (u) => getText(u, { country, timeoutMs: 60_000, headers: { "Accept-Language": "fr-FR,fr;q=0.9" } }),
): Promise<ProductRecord[]> {
  const site = ERAM_SITES[brand];
  if (country !== "FR" || !site) return [];
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const tree of site.trees) {
    const seen = new Set<string>();
    for (let page = 1; page <= tree.pages; page++) {
      if (calls++) await sleep(PAUSE_MS);
      let html: string;
      try {
        html = await fetchHtml(`${site.host}${tree.path}${page > 1 ? `?p=${page}` : ""}`);
      } catch (err) {
        if (byId.size === 0 && page === 1 && tree === site.trees[0]) throw err;
        break;
      }
      // Every tile id of the page (reduced or not): a page past the end repeats page 1.
      const ids = [...html.matchAll(/id="product-item-info_(\d+)"/g)].map((m) => m[1]);
      const fresh = ids.filter((i) => !seen.has(i));
      if (!fresh.length) break;
      for (const i of ids) seen.add(i);
      for (const r of parseEramGrid(brand, html, tree.gender)) if (!byId.has(r.externalId)) byId.set(r.externalId, r);
      if (ids.length < 24) break;
    }
  }
  const all = [...byId.values()];
  const out = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
  console.log(`${brand}/FR: ${calls} pages, ${all.length} reduced, kept ${out.length}`);
  return out;
}
