/**
 * Dune London (dunelondon.com) — shoes and bags, GBP. Added 2026-11-10.
 *
 * Salesforce Commerce Cloud. `Search-UpdateGrid?cgid=<womens-sale|mens-sale>
 * &start=N&sz=96` is the listing's own server-rendered fragment and answers a
 * GitHub runner (probe run 42803687149). Every tile is a
 * `<div class="product" data-pid data-jsondata="{…}">` whose JSON has `price`
 * (charged), `original_price` (struck), `name` ("TAYLA - BROWN"), `name2`
 * ("Stretch Knee-High Boots"), `colour`, the category levels and `brand` (Dune
 * London also sells its Dune Black / Head Over Heels labels). The tile's
 * `stock_availability` is "0%" on every row, sold or not, so it is ignored:
 * the grid lists orderable styles. No sizes on the tile.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { attrOf, decodeEntities, jsonOf } from "./_sfcchtml";

const SITE = "https://www.dunelondon.com";
const GRID = `${SITE}/on/demandware.store/Sites-DuneUK-Site/en_GB/Search-UpdateGrid`;
const SECTIONS: [cgid: string, gender: ProductRecord["gender"], cap: number][] = [
  ["womens-sale", "kadin", 1100],
  ["mens-sale", "erkek", 300],
];
const PAGE = 96;
const MAX_CALLS = Number(process.env.DUNE_MAX_CALLS ?? 16);
const PAUSE_MS = Number(process.env.DUNE_PAUSE_MS ?? 900);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

/** Each product tile's HTML. Pure. */
export function duneTiles(html: string): string[] {
  return html.split(/(?=<div class="product[^"]*" data-pid=)/).filter((p) => p.startsWith('<div class="product'));
}

/** One tile → record, or null. Pure. */
export function mapDuneTile(tile: string, gender: ProductRecord["gender"], country: CountryCode = "GB"): ProductRecord | null {
  const head = tile.slice(0, tile.indexOf(">") + 1);
  const j = jsonOf<any>(attrOf(head, "data-jsondata") ?? "");
  if (!j?.id || !j?.name) return null;
  const price = Number(j.price);
  const was = Number(j.original_price);
  const href = /<a href="([^"]+\.html)"/.exec(tile)?.[1];
  if (!href || !Number.isFinite(price) || price <= 0) return null;
  const [style, colourRaw] = String(j.name).split(" - ").map((p) => p.trim());
  const colour = (colourRaw ?? String(j.colour ?? "")).trim();
  const type = String(j.name2 ?? "").trim();
  const imgs = ["data-original-img", "data-model-img"].map((a) => new RegExp(`${a}="([^"]+)"`).exec(tile)?.[1]).filter((u): u is string => !!u).map((u) => decodeEntities(u).replace("/t_dl_medium/", "/t_dl_large/"));
  const maker = String(j.brand ?? "").trim();
  return {
    brand: "dune",
    country,
    externalId: String(j.id),
    name: [titleCase(style), type, colour ? `- ${titleCase(colour)}` : ""].filter(Boolean).join(" "),
    url: `${SITE}${decodeEntities(href)}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: Number.isFinite(was) && was > price ? toMinor(was) : null,
    currency: COUNTRIES[country].currency,
    inStock: true,
    category: String(j.category_level_3 ?? j.category_level_2 ?? "").replace(/^(Women's|Men's)\s+/i, "") || null,
    maker: maker && !/^dune london$/i.test(maker) ? maker : null,
    gender,
    variants: null,
    colorName: colour ? titleCase(colour) : null,
  };
}

export async function listDune(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "GB") return [];
  const out: ProductRecord[] = [];
  const ids = new Set<string>();
  let calls = 0;
  for (const [cgid, gender, cap] of SECTIONS) {
    let taken = 0;
    pages: for (let start = 0; calls < MAX_CALLS; start += PAGE) {
      if (calls++ > 0) await sleep(PAUSE_MS);
      const html = await getText(`${GRID}?cgid=${cgid}&start=${start}&sz=${PAGE}`, { country, timeoutMs: 45_000 });
      const tiles = duneTiles(html);
      if (!tiles.length) {
        if (start === 0 && !out.length) throw new Error(`dune: sale grid ${cgid} came back without tiles`);
        break;
      }
      for (const t of tiles) {
        const r = mapDuneTile(t, gender, country);
        if (!r || r.listPrice == null || ids.has(r.externalId)) continue;
        ids.add(r.externalId);
        out.push(r);
        if (++taken >= cap) break pages;
      }
      if (tiles.length < PAGE - 4) break;
    }
  }
  return out;
}
