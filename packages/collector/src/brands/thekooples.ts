/**
 * The Kooples — the "Archives" (permanent outlet) trees, FR DE ES PT CH (2026-11-10).
 *
 * Route: the server-rendered list pages of www.thekooples.com (own platform,
 * nginx, no bot wall — 200 from a GitHub runner: probe runs 42802562380 FR,
 * 42803190152 CH/DE/ES/PT). 50 tiles a page, `?page=N`, the total in
 * `data-total-products`. Measured 2026-11-10: women 351 styles in every market,
 * 53 of the 51 tiles + colour blocks on page 1 carry a struck price. ~1.4 MB of
 * HTML a page; ≤ 8 women + ≤ 6 men pages a market.
 *
 * A tile (`<div class="item-product" data-itemid=…>`) holds the link, title,
 * photos, colour, every size (`no-stock` on the label = sold out) with its EAN,
 * and two price spans: `is-sale-price` and `is-crossed`. Each span carries
 * `data-fp`, the fixed price per price zone (`{'FR':'110','DK':'880.00'}`); the
 * visible text is always the page's euro zone. Tiles without `is-crossed` are
 * skipped.
 *
 * Markets and their price-zone key: FR `/fr/fr` (FR), DE `/de/de` (DE),
 * ES `/es/es` (ES), PT `/pt/en` (ES — Portugal is served the Spanish price
 * list), CH `/ch/fr` (CH, in CHF). /be /it /nl /at redirect to /fr/fr — no
 * local storefront. FRAGILE (CH): the CHF amount is read from the `CH` entry of
 * `data-fp`; the server HTML itself prints the euro price and the site's script
 * swaps it in the browser. If the `CH` entry is missing the tile is skipped.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { decodeEntities } from "./_sfcchtml";

const SITE = "https://www.thekooples.com";
interface Market { prefix: string; zone: string; currency: string; lang: string; women: string; men: string }
export const KOOPLES_MARKETS: Partial<Record<CountryCode, Market>> = {
  FR: { prefix: "/fr/fr", zone: "FR", currency: "EUR", lang: "fr-FR,fr;q=0.9", women: "archives/femme.html", men: "archives/homme.html" },
  DE: { prefix: "/de/de", zone: "DE", currency: "EUR", lang: "de-DE,de;q=0.9", women: "archiv/damen.html", men: "archiv/herren.html" },
  ES: { prefix: "/es/es", zone: "ES", currency: "EUR", lang: "es-ES,es;q=0.9", women: "archivos/mujeres.html", men: "archivos/hombres.html" },
  PT: { prefix: "/pt/en", zone: "ES", currency: "EUR", lang: "en-PT,en;q=0.9", women: "archives/women.html", men: "archives/men.html" },
  CH: { prefix: "/ch/fr", zone: "CH", currency: "CHF", lang: "fr-CH,fr;q=0.9", women: "archives/femme.html", men: "archives/homme.html" },
};
const WOMEN_PAGES = 8;
const MEN_PAGES = 6;
const CAP = 1500;
const PAUSE_MS = Number(process.env.KOOPLES_PAUSE_MS ?? 700);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `{'FR':'110','DK':'880.00'}` + zone → 110; NaN when the zone is absent. */
export function zonePrice(fp: string, zone: string): number {
  const m = fp.match(new RegExp(`'${zone}'\\s*:\\s*'([\\d.]+)'`));
  return m ? Number(m[1]) : NaN;
}

/** Every reduced tile of a list page. Pure. */
export function parseKooples(html: string, country: CountryCode, gender: ProductRecord["gender"]): ProductRecord[] {
  const mk = KOOPLES_MARKETS[country];
  if (!mk) return [];
  const out: ProductRecord[] = [];
  for (const raw of html.split(/<div class="item-product[ "]/).slice(1)) {
    const t = raw.replace(/\s+/g, " ");
    const id = t.match(/data-itemid="(\d+)"/)?.[1];
    const href = t.match(/<a href="(\/[a-z]{2,3}\/[a-z]{2}\/p\/[^"]+\.html)"/)?.[1];
    const title = t.match(/class="product-title">([^<]+)</)?.[1];
    const sale = t.match(/data-ge-price is-sale-price data-fp="([^"]+)"/)?.[1];
    const crossed = t.match(/data-ge-price is-crossed data-fp="([^"]+)"/)?.[1];
    if (!id || !href || !title || !sale || !crossed) continue;
    const price = zonePrice(sale, mk.zone);
    const was = zonePrice(crossed, mk.zone);
    if (!(price > 0) || !(was > price)) continue;
    const imgs = [...new Set([...t.matchAll(/(?:src|data-src)="(\/[a-z]{2,3}\/[a-z]{2}\/phototheque\/[^"?]+\/)mini(\/[^"?]+\.jpg)/g)].map((m) => `${SITE}${m[1]}large${m[2]}`))];
    const sizes: SizeVariant[] = [];
    const barcodes: string[] = [];
    for (const m of t.matchAll(/name="prod_size" value="[^"]*" data-nom="([^"]+)"[^>]*?(?:data-ean="(\d*)")?\s*\/> <label[^>]*class="product-size-label"([^>]*)>/g)) {
      const label = decodeEntities(m[1]).trim();
      if (!label || sizes.some((s) => s.label === label)) continue;
      sizes.push({ label, availability: /no-stock/.test(m[3]) ? "out_of_stock" : "in_stock" });
      if (m[2] && /^\d{12,13}$/.test(m[2])) barcodes.push(m[2]);
    }
    const colour = t.match(/name="prod_color" value="[^"]*" data-nom="([^"]+)"[^>]*checked/)?.[1] ?? t.match(/name="prod_color" value="[^"]*" data-nom="([^"]+)"/)?.[1] ?? null;
    out.push({
      brand: "thekooples",
      country,
      externalId: id,
      name: decodeEntities(title).replace(/\s+/g, " ").trim(),
      url: `${SITE}${href}`,
      imageUrl: imgs[0] ?? null,
      images: cleanGallery(imgs, imgs[0] ?? null),
      price: toMinor(price),
      listPrice: toMinor(was),
      currency: mk.currency,
      inStock: sizes.length ? sizes.some((s) => s.availability === "in_stock") : true,
      barcodes: barcodes.length ? barcodes : null,
      category: null,
      gender,
      variants: sizes.length ? { colors: colour ? [decodeEntities(colour)] : [], sizes } : null,
      groupKey: null,
      colorName: colour ? decodeEntities(colour) : null,
    });
  }
  return out;
}

export const kooplesTotal = (html: string): number => Number(html.match(/data-total-products="(\d+)"/)?.[1] ?? 0);

export async function listTheKooples(
  country: CountryCode,
  fetchHtml: (u: string) => Promise<string> = (u) => getText(u, { country, timeoutMs: 60_000, headers: { "Accept-Language": KOOPLES_MARKETS[country]?.lang ?? "fr-FR" } }),
): Promise<ProductRecord[]> {
  const mk = KOOPLES_MARKETS[country];
  if (!mk) return [];
  const trees: { path: string; gender: "kadin" | "erkek"; pages: number }[] = [
    { path: mk.women, gender: "kadin", pages: WOMEN_PAGES },
    { path: mk.men, gender: "erkek", pages: MEN_PAGES },
  ];
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const tree of trees) {
    for (let page = 1; page <= tree.pages; page++) {
      if (calls++) await sleep(PAUSE_MS);
      let html: string;
      try {
        html = await fetchHtml(`${SITE}${mk.prefix}/${tree.path}${page > 1 ? `?page=${page}` : ""}`);
      } catch (err) {
        if (byId.size === 0 && page === 1 && tree === trees[0]) throw err;
        break;
      }
      const tiles = html.split(/<div class="item-product[ "]/).length - 1;
      const rows = parseKooples(html, country, tree.gender);
      if (page === 1 && tree === trees[0] && tiles > 0 && rows.length === 0 && /is-crossed/.test(html)) {
        throw new Error("thekooples: tiles with a crossed price but none parsed (markup changed?)");
      }
      let fresh = 0;
      for (const r of rows) {
        if (byId.has(r.externalId)) continue;
        byId.set(r.externalId, r);
        fresh++;
      }
      if (!tiles || (!fresh && page > 1) || page * 50 >= kooplesTotal(html)) break;
    }
  }
  const all = [...byId.values()];
  const out = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
  console.log(`thekooples/${country}: ${calls} pages, ${all.length} reduced, kept ${out.length}`);
  return out;
}
