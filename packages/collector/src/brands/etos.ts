/**
 * Etos (etos.nl) — Dutch drugstore chain (Ahold Delhaize), Netherlands only,
 * on Salesforce Commerce Cloud (SFRA). HOST-RUN: GitHub runners get a 403
 * from the site's WAF on every controller (probe run 39636006759), while the
 * Hetzner box in Germany gets 200 for the same `Search-UpdateGrid` call
 * (2026-10-21). Category pages (/aanbiedingen/…) 403 everywhere; the grid
 * controller does not.
 *
 * Most Etos offers are multi-buy ("1+1 GRATIS", "2e HALVE PRIJS") or the
 * "10% KORTING" Mijn Etos member discount — none of those is a price drop on
 * one item, and none is read. What is read are the single-item percentage
 * promotions: the "aanbiedingen" category refined by `applicablePromos =
 * "<n>% korting"` for n = 15…70. Their tiles show "van €22.95 voor €18.36":
 * a `price__item--strike-through` (list) and a `price__item--sales` price.
 * Only list > sales is kept. Measured 2026-10-21: 20% 129, 25% 79, 30% 27,
 * 35% 14, 40% 28, 50% 185, 60% 67 items.
 *
 * Scope: beauty and personal care. Health (Gezondheid: medicines,
 * supplements), home & travel, baby and food sections are dropped by the
 * tile's own `item_category`.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { decodeEntities, jsonOf } from "./_sfcchtml";

const ORIGIN = "https://www.etos.nl";
const BASE = `${ORIGIN}/on/demandware.store/Sites-etos-nl-Site/nl_NL`;
const PERCENTS = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70];
const PAGE = 200;
const MAX_PAGES = 4; // per promotion
const CAP = 1500;
const PAUSE_MS = Number(process.env.ETOS_PAUSE_MS ?? 600);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const etosGridUrl = (pct: number, start: number): string =>
  `${BASE}/Search-UpdateGrid?cgid=aanbiedingen&prefn1=applicablePromos&prefv1=${encodeURIComponent(`${pct}% korting`)}&start=${start}&sz=${PAGE}`;

/** Sections that are not beauty/personal care (medicines and supplements live in Gezondheid). */
const NOT_BEAUTY = /gezondheid|thuis|reis|baby|zwanger|kind|voeding|vitamine|supplement|huishoud|dier|cadeaukaart|seksualiteit|incontinentie/i;

/** Electric appliances (toothbrushes, shavers, stylers) — electronics, not cosmetics. */
const ELECTRIC = /elektrisch|apparat|scheerapparaat|f[oö]hn|stijltang|krultang|tondeuse|epilator|trimmer|monddouche|opzetborstel/i;

/** Split a grid into tiles. Pure. */
export function etosTiles(html: string): string[] {
  return html.split(/<div class="c-product-tile/).slice(1).map((t) => '<div class="c-product-tile' + t);
}

/** "8 van 129" in the grid footer → 129. */
export function etosTotal(html: string): number {
  const m = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").match(/(\d+) van ([0-9.]+)/);
  return m ? Number(m[2].replace(/\./g, "")) : NaN;
}

const priceIn = (tile: string, cls: string): number => {
  const i = tile.indexOf(cls);
  if (i < 0) return NaN;
  return parseFloat(tile.slice(i).match(/class="price__value"[^>]*content="([0-9.]+)"/)?.[1] ?? "");
};

/** One tile → a record, or null when it is not a single-item markdown or not beauty. Pure. */
export function mapEtosTile(tile: string, country: CountryCode = "NL"): ProductRecord | null {
  const d = jsonOf<any>(decodeEntities(tile.match(/data-product="([^"]*)"/)?.[1] ?? "")) ?? {};
  const id = String(d.item_id ?? "");
  const name = String(d.item_name ?? "").trim();
  const promo = String(d.item_discount_name ?? "");
  if (!id || !name) return null;
  if (/gratis|halve prijs|voor €|\+/i.test(promo)) return null; // multi-buy riding along
  if (NOT_BEAUTY.test(String(d.item_category ?? ""))) return null;
  if (ELECTRIC.test([d.item_category2, d.item_category3, d.item_category4, name].join(" "))) return null;
  const was = priceIn(tile, "price__item--strike-through");
  const price = priceIn(tile, "price__item--sales");
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(was) || was <= price) return null;
  const href = tile.match(/<a\s+href="([^"]+)"\s+class="product-tile__title/)?.[1];
  if (!href) return null;
  const img = tile.match(/<img\s+class="image-item"\s+src="([^"]+)"/)?.[1];
  const imageUrl = img ? decodeEntities(img).replace(/\?sw=\d+/, "?sw=800") : null;
  const sub = [d.item_category4, d.item_category3, d.item_category2].find((x) => typeof x === "string" && x);
  return {
    brand: "etos",
    country,
    externalId: id,
    name,
    url: `${ORIGIN}${decodeEntities(href)}`,
    imageUrl,
    images: cleanGallery([imageUrl]),
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: "EUR",
    // item_stockstatus_level: 2 = in stock, 1 = low, 0 = sold out (grid lists sellable items).
    inStock: Number(d.item_stockstatus_level ?? 1) > 0,
    category: sub ?? (typeof d.item_category === "string" ? d.item_category : null),
    maker: typeof d.item_brand === "string" && d.item_brand.trim() ? d.item_brand.trim() : null,
    gender: null,
  };
}

/** Register as `listEtos(country)`. NL only — host-run (not from GitHub runners). */
export async function listEtos(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "NL") return [];
  const byId = new Map<string, ProductRecord>();
  let first = true;
  let tilesSeen = 0;
  for (const pct of PERCENTS) {
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) throw new Error(`etos: ${pct}% korting has more than ${MAX_PAGES} pages`);
      if (!first) await sleep(PAUSE_MS);
      first = false;
      const html = await getText(etosGridUrl(pct, page * PAGE), { country, timeoutMs: 60_000 });
      const tiles = etosTiles(html);
      tilesSeen += tiles.length;
      for (const t of tiles) {
        const r = mapEtosTile(t, country);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      const total = etosTotal(html);
      if (tiles.length < PAGE || !Number.isFinite(total) || (page + 1) * PAGE >= total) break;
    }
  }
  if (!tilesSeen) throw new Error("etos: every promotion grid came back empty");
  return [...byId.values()].slice(0, CAP);
}
