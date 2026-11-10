/**
 * LUDWIG BECK (ludwigbeck.de) — the Munich department store ("Kaufhaus der
 * Sinne"): premium fashion (Dôen, Polo Ralph Lauren, Marc O'Polo, Max Mara
 * lines), lingerie and a large niche-beauty floor. Magento 2, server-rendered
 * listings, no bot wall. Germany only. Added 2026-11-10.
 *
 * The sale trees are plain category pages:
 *   GET https://www.ludwigbeck.de/sale/<damen|accessoires|beauty|herren>.html?product_list_limit=120&p=N
 * 120 tiles a page is honoured; a page past the end answers the first page
 * again, so the walk stops on a page with no new SKU. A GitHub runner gets the
 * same page (probe run 42799416687: 200, nginx, 850 KB). On 2026-11-10 the
 * sale held 310 women's, 10 accessories, 73 beauty and 23 men's products.
 *
 * A tile carries the brand, name, link, photo, `oldPrice` / `finalPrice`
 * amounts and the shop's "30-Tage-Bestpreis" (EU Omnibus). A row whose 30-day
 * best price is BELOW today's price was cheaper recently and is dropped; one
 * where it equals today's price or the old price is a standing markdown and kept.
 * The listing has no sizes ("teilweise verfügbar" = some sizes gone).
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { decodeEntities } from "./_sfcchtml";

const ORIGIN = "https://www.ludwigbeck.de";
const PER_PAGE = 120;
const MAX_PAGES = 8;
const CAP = 1500;
const PAUSE_MS = Number(process.env.LUDWIGBECK_PAUSE_MS ?? 700);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const LUDWIGBECK_TREES: { path: string; gender: ProductRecord["gender"]; category?: string }[] = [
  { path: "/sale/damen.html", gender: "kadin" },
  { path: "/sale/accessoires.html", gender: "kadin" },
  { path: "/sale/beauty.html", gender: null, category: "Beauty" },
  { path: "/sale/herren.html", gender: "erkek" },
];

export const listUrl = (path: string, page: number) => `${ORIGIN}${path}?product_list_limit=${PER_PAGE}&p=${page}`;

const clean = (s: string) => decodeEntities(s).replace(/ /g, " ").replace(/\s+/g, " ").trim();
/** "1.237,96 €" → 1237.96 */
export const euro = (s: string | undefined): number => {
  const n = parseFloat(String(s ?? "").replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

export interface LbTile {
  sku: string;
  url: string;
  maker: string | null;
  name: string;
  image: string | null;
  price: number;
  old: number | null;
  best30: number | null;
  available: boolean;
}

/** Every product tile of one listing page. Pure. */
export function parseLudwigBeck(html: string): LbTile[] {
  const out: LbTile[] = [];
  for (const raw of html.split('<li class="item product product-item"').slice(1)) {
    const sku = raw.match(/^\s*data-sku="([^"]+)"/)?.[1];
    const url = raw.match(/<a class="product-item-details"\s+href="([^"]+)"/)?.[1];
    const name = raw.match(/class="product-item-link">\s*([\s\S]*?)<\/span>/)?.[1];
    if (!sku || !url || !name) continue;
    const brand = raw.match(/class="product-item-brand"[^>]*>\s*([\s\S]*?)<\/div>/)?.[1];
    // The gross price box comes first; the net ("ohne MwSt.") copy follows it.
    const box = raw.slice(0, raw.indexOf('class="net-price"') > 0 ? raw.indexOf('class="net-price"') : undefined);
    const price = parseFloat(box.match(/data-price-amount="([\d.]+)"\s+data-price-type="finalPrice"/)?.[1] ?? "");
    if (!(price > 0)) continue;
    const old = parseFloat(box.match(/data-price-amount="([\d.]+)"\s+data-price-type="oldPrice"/)?.[1] ?? "");
    const best = euro(box.match(/class="best-price__value">([^<]+)</)?.[1]);
    const img = raw.match(/<img[^>]*class="product-image-photo[^"]*"[^>]*\ssrc="([^"]+)"/)?.[1] ?? raw.match(/\ssrc="(https:\/\/cdn\.ludwigbeck\.de\/[^"]+)"/)?.[1];
    const avail = clean(raw.match(/class="product-item-availability">\s*([^<]*)/)?.[1] ?? "");
    out.push({
      sku,
      url: decodeEntities(url),
      maker: brand ? clean(brand) || null : null,
      name: clean(name),
      image: img ? decodeEntities(img).replace(/[?&]width=\d+&height=\d+/, "").replace(/\?$/, "") : null,
      price,
      old: Number.isFinite(old) ? old : null,
      best30: Number.isFinite(best) ? best : null,
      available: !/nicht (verfügbar|lieferbar)|ausverkauft/i.test(avail),
    });
  }
  return out;
}

/** One tile → a record; null unless reduced and not cheaper within the last 30 days. Pure. */
export function mapLudwigBeck(t: LbTile, gender: ProductRecord["gender"], category: string | null = null): ProductRecord | null {
  if (t.old == null || !(t.old > t.price)) return null;
  if (t.best30 != null && t.best30 < t.price - 0.005) return null;
  const base = t.image ? t.image.split("?")[0] : null;
  const image = base ? `${base}?width=800&height=800` : null;
  return {
    brand: "ludwigbeck",
    country: "DE",
    externalId: t.sku,
    name: t.maker ? `${t.maker} ${t.name}` : t.name,
    url: t.url,
    imageUrl: image,
    images: cleanGallery([image], image),
    price: toMinor(t.price),
    listPrice: toMinor(t.old),
    currency: "EUR",
    inStock: t.available,
    maker: t.maker,
    category: category ?? t.name.split(" ")[0] ?? null,
    gender,
    variants: null,
    groupKey: `ludwigbeck:${t.sku.split("-")[0]}`,
  };
}

export async function listLudwigBeck(country: CountryCode, fetchHtml: (url: string) => Promise<string> = fetchPage): Promise<ProductRecord[]> {
  if (country !== "DE") return [];
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const tree of LUDWIGBECK_TREES) {
    const seen = new Set<string>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (calls++) await sleep(PAUSE_MS);
      let html: string;
      try {
        html = await fetchHtml(listUrl(tree.path, page));
      } catch (err) {
        if (calls === 1) throw err; // first page of the first tree: the route is down
        break;
      }
      const tiles = parseLudwigBeck(html);
      if (calls === 1 && !tiles.length) throw new Error("ludwigbeck/DE: the sale page has no product tiles");
      let fresh = 0;
      for (const t of tiles) {
        if (seen.has(t.sku)) continue;
        seen.add(t.sku);
        fresh++;
        const r = mapLudwigBeck(t, tree.gender, tree.category ?? null);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      // Past the end the shop serves page 1 again: nothing new ends the tree.
      if (fresh === 0 || tiles.length < PER_PAGE) break;
    }
  }
  const all = [...byId.values()];
  const out = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
  console.log(`ludwigbeck/DE: ${calls} pages, kept ${out.length}`);
  return out;
}

function fetchPage(url: string): Promise<string> {
  return getText(url, { country: "DE", retries: 2, timeoutMs: 45_000, headers: { "Accept-Language": "de-DE,de;q=0.9", Accept: "text/html,application/xhtml+xml" } });
}
