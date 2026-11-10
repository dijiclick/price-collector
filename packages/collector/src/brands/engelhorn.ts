/**
 * engelhorn (engelhorn.de) — the Mannheim fashion and sports department store,
 * multi-brand up to luxury (Weekend Max Mara, BOSS, Polo Ralph Lauren, Moncler,
 * adidas, New Balance …). Salesforce Commerce Cloud (SFRA), Cloudflare in front
 * without a challenge. Germany only. Added 2026-11-10.
 *
 * The sale grid is server-rendered:
 *   GET /on/demandware.store/Sites-ENG-DE-Site/de_DE/Search-UpdateGrid?cgid=<id>&page=N&sz=96
 * with the `X-Requested-With: XMLHttpRequest` header the site's own script
 * sends. `sz=96` is honoured (~1.3 MB a page). Paging is `page=` (1-based);
 * `start=` alone is ignored and answers page 1 again. A GitHub runner gets the same
 * grid: probe run 42799416687 (200 via Cloudflare, 230 KB for sz=12, prices in
 * EUR).
 *
 * One tile = one colour (a "variation group", id like `V1127633J`). Its default
 * price block holds the price paid (`sales`), the struck price (`<del>`) and,
 * for most reduced rows, "Niedrigster Preis der letzten 30 Tage". EU Omnibus:
 * a row whose 30-day low is at or below today's price is not a fresh markdown
 * and is dropped (41 of 96 on the first women's page that day), as `_scayle.ts`
 * does. The tile also lists the sizes still sellable.
 *
 * Walk: women's luxury sale first, then the women's sale, then the men's sale
 * (a minority), in the shop's own order; reduced rows only, capped.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { decodeEntities } from "./_sfcchtml";

const ORIGIN = "https://www.engelhorn.de";
const GRID = `${ORIGIN}/on/demandware.store/Sites-ENG-DE-Site/de_DE/Search-UpdateGrid`;
const PAGE = 96;
const CAP = 2000;
const PAUSE_MS = Number(process.env.ENGELHORN_PAUSE_MS ?? 600);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sale trees, in walk order: category id, section, pages of 96, and how many rows it may contribute. */
export const ENGELHORN_TREES: { cgid: string; gender: ProductRecord["gender"]; pages: number; quota: number }[] = [
  { cgid: "damen-sale-luxury", gender: "kadin", pages: 4, quota: 400 },
  { cgid: "damen-sale", gender: "kadin", pages: 18, quota: 1500 },
  { cgid: "herren-sale", gender: "erkek", pages: 8, quota: 500 },
];

/** `page` is 1-based. */
export const gridUrl = (cgid: string, page: number) => `${GRID}?cgid=${encodeURIComponent(cgid)}&page=${page}&sz=${PAGE}`;

/** "1.299,00 €" / "146.85" → 1299 / 146.85. */
export function euro(v: string | null | undefined): number {
  const s = String(v ?? "").replace(/&nbsp;|\s|€|&euro;/g, "");
  if (!s) return NaN;
  const n = /,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s;
  const f = parseFloat(n);
  return Number.isFinite(f) ? f : NaN;
}

const clean = (s: string) => decodeEntities(s).replace(/ /g, " ").replace(/\s+/g, " ").trim();

/** "Damen Sneaker 9060" → "Sneaker": the word after the section word is the product type. */
export function typeOf(name: string): string | null {
  const m = name.match(/^(?:Damen|Herren|Kinder|Unisex|Mädchen|Jungen)\s+([A-Za-zÄÖÜäöüß-]{3,})/);
  return m ? m[1] : null;
}

export interface EngelhornTile {
  id: string;
  href: string;
  maker: string | null;
  name: string;
  image: string | null;
  price: number;
  list: number | null;
  low30: number | null;
  sizes: string[];
}

/** Every tile of one grid response. Pure. */
export function parseEngelhornGrid(html: string): EngelhornTile[] {
  const out: EngelhornTile[] = [];
  for (const raw of html.split('class="product-search-hit js-tile"').slice(1)) {
    const id = raw.match(/data-pid="([^"]+)"/)?.[1];
    const link = raw.match(/<a class="product-tile__link[^"]*" href="([^"]+)">([\s\S]*?)<\/a>/);
    if (!id || !link) continue;
    const text = clean(link[2].replace(/<[^>]+>/g, " "));
    const cut = text.indexOf("|");
    const maker = cut > 0 ? text.slice(0, cut).trim() : null;
    const name = cut > 0 ? text.slice(cut + 1).trim() : text;
    if (!name) continue;
    // The default price block sits between the name and the first hidden per-colour copy.
    const from = raw.indexOf('class="product-tile__name"');
    const hidden = raw.indexOf("product-tile__data-hidden", from);
    const block = raw.slice(from, hidden > from ? hidden : undefined);
    const price = euro(block.match(/class="sales">\s*<span class="value" content="([\d.]+)"/)?.[1]);
    if (!(price > 0)) continue;
    const list = euro(block.match(/<del>[\s\S]*?content="([\d.]+)"/)?.[1]);
    const low = euro(block.match(/30daymin-price-information">[\s\S]*?strike-through">([^<]+)</)?.[1]);
    const img = raw.match(/<source data-srcset="(https:[^"?]+\.(?:jpe?g|png|webp))"/i)?.[1] ?? raw.match(/data-srcset="(https:[^"?]+\.(?:jpe?g|png|webp))/i)?.[1] ?? null;
    // Sizes of THIS colour: the hidden block tagged with the tile's own group id.
    const sizesAt = raw.indexOf(`available-sizes" data-variation-group-id="${id}"`);
    const sizesEnd = sizesAt >= 0 ? raw.indexOf("</div>\n</div>", sizesAt) : -1;
    const sizeHtml = sizesAt >= 0 ? raw.slice(sizesAt, sizesEnd > sizesAt ? sizesEnd : sizesAt + 4000) : "";
    const sizes = [...sizeHtml.matchAll(/available-sizes__item[^"]*">([^<]+)</g)].map((m) => clean(m[1])).filter(Boolean);
    out.push({
      id,
      href: decodeEntities(link[1]),
      maker,
      name,
      image: img,
      price,
      list: Number.isFinite(list) ? list : null,
      low30: Number.isFinite(low) ? low : null,
      sizes: [...new Set(sizes)],
    });
  }
  return out;
}

/** One tile → a record, or null unless it is a fresh markdown. Pure. */
export function mapEngelhorn(t: EngelhornTile, gender: ProductRecord["gender"]): ProductRecord | null {
  if (t.list == null || !(t.list > t.price)) return null;
  // Omnibus: already this cheap (or cheaper) within 30 days → not a new markdown.
  if (t.low30 != null && t.low30 <= t.price) return null;
  const image = t.image ? `${t.image}?sw=800` : null;
  const sizes: SizeVariant[] = t.sizes.map((label) => ({ label, availability: "in_stock" }));
  return {
    brand: "engelhorn",
    country: "DE",
    externalId: t.id,
    name: t.maker ? `${t.maker} ${t.name}` : t.name,
    url: `${ORIGIN}${t.href.split("?")[0]}`,
    imageUrl: image,
    images: cleanGallery([image], image),
    price: toMinor(t.price),
    listPrice: toMinor(t.list),
    currency: "EUR",
    inStock: true,
    maker: t.maker,
    category: typeOf(t.name),
    gender: /^Kinder|^Mädchen|^Jungen/.test(t.name) ? "cocuk" : gender,
    variants: sizes.length ? { colors: [], sizes } : null,
    sizesInStockOnly: true,
  };
}

export async function listEngelhorn(country: CountryCode, fetchHtml: (url: string) => Promise<string> = fetchGrid): Promise<ProductRecord[]> {
  if (country !== "DE") return [];
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const tree of ENGELHORN_TREES) {
    let took = 0;
    const seen = new Set<string>();
    for (let page = 0; page < tree.pages && took < tree.quota && byId.size < CAP; page++) {
      if (calls++) await sleep(PAUSE_MS);
      let html: string;
      try {
        html = await fetchHtml(gridUrl(tree.cgid, page + 1));
      } catch (err) {
        // The very first page failing means the route is down: throw, the stored rows stay.
        if (byId.size === 0 && calls === 1) throw err;
        break;
      }
      const tiles = parseEngelhornGrid(html);
      if (!tiles.length) {
        if (byId.size === 0 && calls === 1) throw new Error("engelhorn/DE: the sale grid has no tiles");
        break;
      }
      let fresh = 0;
      for (const t of tiles) {
        if (!seen.has(t.id)) fresh++;
        seen.add(t.id);
        const r = mapEngelhorn(t, tree.gender);
        if (r && !byId.has(r.externalId) && took < tree.quota) {
          byId.set(r.externalId, r);
          took++;
        }
      }
      // A page of nothing new means the grid served an earlier page again.
      if (tiles.length < PAGE || fresh === 0) break;
    }
  }
  const out = [...byId.values()].slice(0, CAP);
  console.log(`engelhorn/DE: ${calls} pages, kept ${out.length}`);
  return out;
}

function fetchGrid(url: string): Promise<string> {
  return getText(url, {
    country: "DE",
    retries: 2,
    timeoutMs: 45_000,
    headers: { "X-Requested-With": "XMLHttpRequest", "Accept-Language": "de-DE,de;q=0.9", Accept: "text/html, */*; q=0.01" },
  });
}
