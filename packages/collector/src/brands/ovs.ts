/**
 * OVS (ovs.it) — Italy's biggest clothing chain, EUR. Added 2026-10-21.
 *
 * Salesforce Commerce Cloud (SFRA, site `ovs`). The listing grid answers
 * `Search-UpdateGrid` (the "load more" endpoint, `X-Requested-With:
 * XMLHttpRequest`) from a GitHub runner (probe runs 39635106148,
 * 39635286410, 39638082107: 200) — no proxy. It pages by `page=N`, 24 tiles a
 * page (`start`/`sz` are ignored), ~28 pages for 668 colours. Cloudflare in front
 * challenges a caller that pages too fast (the Mac got a 429 challenge after
 * ~10 quick pages), so pages are spaced and capped.
 *
 * - Locale `en_IT`: the same Italian store and prices, with English names and
 *   category codes the classifier can read. Links are the English PDPs.
 * - Category: the season's sale tree, `OVS_Midseasonsales` (Mid Season Sale,
 *   "fino al -50% su una selezione di capi", automatic — no code).
 * - Each tile carries JSON attributes: `data-price` = the storefront's
 *   `{sales, list}` price model (`list` is the struck price, the tile shows it
 *   in `<del>`), `data-analytics-attributes` (macroCategory = section,
 *   category/subCategory codes, brand), `data-variation-attributes` (colours,
 *   and sizes with `isOutOfStock` / `ATS` stock counts), `data-available`.
 * - One tile = one colour (its own `pid`).
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const SITE = "https://www.ovs.it";
const GRID = `${SITE}/on/demandware.store/Sites-ovs-Site/en_IT/Search-UpdateGrid`;
export const SALE_CGIDS = ["OVS_Midseasonsales"];
/** The grid pages by `page=N` (24 tiles each); `start`/`sz` are ignored. */
const PAGE = 24;
const MAX_PAGES = Number(process.env.OVS_MAX_PAGES ?? 60);
const CAP = 1500;
const PAUSE_MS = 2500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const decode = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&euro;/g, "€")
    .replace(/&amp;/g, "&");

const attrJson = (tile: string, name: string): any => {
  const m = tile.match(new RegExp(`${name}="([^"]*)"`)) ?? tile.match(new RegExp(`${name}='([^']*)'`));
  if (!m) return null;
  try {
    return JSON.parse(decode(m[1]));
  } catch {
    return null;
  }
};

/** Split a grid page into product tiles (one per colour). Pure. */
export function splitTiles(html: string): string[] {
  const idx: number[] = [];
  const re = /<div class="product-tile [^"]*" data-pid="/g;
  for (let m; (m = re.exec(html)); ) idx.push(m.index);
  return idx.map((s, i) => html.slice(s, idx[i + 1] ?? html.length));
}

/** macroCategory (English locale) → our section. */
export function sectionOf(macro: unknown): ProductRecord["gender"] {
  const t = String(macro ?? "").toLowerCase();
  if (/^(women|woman|donna)$/.test(t)) return "kadin";
  if (/^(men|man|uomo)$/.test(t)) return "erkek";
  if (/boy|girl|baby|kid|child|newborn|teen|bambin|ragazz|neonat/.test(t)) return "cocuk";
  return null;
}

/** Map one tile (deals only). Pure. */
export function mapOvsTile(tile: string, country: CountryCode = "IT"): ProductRecord | null {
  const pid = tile.match(/data-pid="([^"]+)"/)?.[1];
  const price = attrJson(tile, "data-price");
  const a = attrJson(tile, "data-analytics-attributes") ?? {};
  const sales = Number(price?.sales?.value);
  const list = Number(price?.list?.value);
  if (!pid || !Number.isFinite(sales) || sales <= 0 || !Number.isFinite(list) || list <= sales) return null;
  const title = decode(tile.match(/\btitle="([^"]+)"/)?.[1] ?? "").trim();
  const href = tile.match(/href="([^"]*\/p\/[^"]+\.html)"/)?.[1];
  if (!title || !href) return null;
  const va: any[] = attrJson(tile, "data-variation-attributes") ?? [];
  const sizeAttr = va.find((x) => x?.attributeId === "size");
  const colourAttr = va.find((x) => x?.attributeId === "color");
  const sizes: SizeVariant[] = [];
  for (const v of sizeAttr?.values ?? []) {
    const label = String(v?.displayValue ?? "").trim();
    if (!label) continue;
    const ats = Number(v?.ATS);
    const out = v?.isOutOfStock === true || v?.selectable === false || ats === 0;
    sizes.push({ label, availability: out ? "out_of_stock" : v?.lowAvailability === true || (ats > 0 && ats <= 2) ? "low_on_stock" : "in_stock" });
  }
  const selected = (colourAttr?.values ?? []).find((v: any) => v?.selected) ?? null;
  const colour = typeof selected?.displayValue === "string" ? selected.displayValue : null;
  const imgs = [...tile.matchAll(/(?:src|data-src)="(https:\/\/[^"]+\/media\/products\/[^"]+?\.jpg)[^"]*"/g)].map((m) => `${decode(m[1])}?sw=900&sh=1200`);
  const images = cleanGallery(imgs.filter((u) => u.includes(pid)));
  const available = tile.match(/data-available="([^"]+)"/)?.[1];
  const brand = String(a?.brand ?? "").toLowerCase();
  const cat = String(a?.subCategory || a?.category || "").replace(/_/g, " ").trim();
  return {
    brand: "ovs",
    country,
    externalId: pid,
    name: title,
    url: `${SITE}${decode(href).split("?")[0]}`,
    imageUrl: images?.[0] ?? null,
    images,
    price: toMinor(sales),
    listPrice: toMinor(list),
    currency: String(price?.sales?.currency ?? "EUR"),
    inStock: available === "true" && (sizes.length === 0 || sizes.some((s) => s.availability !== "out_of_stock")),
    category: cat || null,
    maker: brand && brand !== "ovs" ? brand.replace(/_/g, " ") : null,
    gender: sectionOf(a?.macroCategory),
    variants: sizes.length || colour ? { colors: colour ? [colour] : [], sizes } : null,
    colorName: colour,
  };
}

export const gridUrl = (cgid: string, page: number): string => `${GRID}?cgid=${cgid}&showmorecheck=true&page=${page}`;

/** "668 products" in the grid's result count. Pure. */
export const totalOf = (html: string): number | null => {
  const m = html.match(/([\d.,]+)\s+(?:products|results|prodotti|risultati)\b/);
  return m ? Number(m[1].replace(/[.,]/g, "")) : null;
};

/** Register as `listOvs(country)`. IT only. */
export async function listOvs(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "IT") return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const cgid of SALE_CGIDS) {
    let pages = 1;
    for (let page = 1; page <= pages; page++) {
      if (page > MAX_PAGES) throw new Error(`ovs/${country}: ${cgid} needs ${pages} pages, budget ${MAX_PAGES}`);
      if (requests++ > 0) await sleep(PAUSE_MS);
      const html = await getText(gridUrl(cgid, page), {
        country,
        timeoutMs: 60_000,
        headers: { "X-Requested-With": "XMLHttpRequest", Accept: "text/html, */*; q=0.01", "Accept-Language": "en-IT,en;q=0.9,it;q=0.8" },
      });
      const tiles = splitTiles(html);
      if (page === 1) {
        const total = totalOf(html);
        if (total == null) throw new Error(`ovs/${country}: ${cgid} has no result count`);
        pages = Math.ceil(total / PAGE);
      }
      if (!tiles.length && page < pages) throw new Error(`ovs/${country}: ${cgid} page ${page} of ${pages} came back empty`);
      for (const t of tiles) {
        const r = mapOvsTile(t, country);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
