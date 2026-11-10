/**
 * Yves Rocher France — the "Vos produits en promotion" category (2026-11-10).
 *
 * Route: the server-rendered list page
 * `https://www.yves-rocher.fr/vos-produits-en-promotion/c/perm-promotions`,
 * `?currentPage=N` (the site's own pager; 48 cards a page, 30 pages = ~1,440
 * products on 2026-11-10, ~600 KB of HTML each).
 *
 * The site's bot wall answers a desktop-browser User-Agent 403 ("Traitement en
 * cours") from this Mac and from GitHub runners, but lets an app User-Agent
 * through (`okhttp/4.12.0`, playbook §2.2): 200 from a runner for the home page
 * (probe run 42802562380) and for pages 1–2 of this list (run 42803190152).
 *
 * Every card is rendered twice: plain HTML (`yr-product-card__ssr-*`: photo,
 * brand, range, title, volume, current and original price, link) and a JSON
 * payload for the web component, from which `isUnavailable`, `discountState`
 * and the analytics category are read. Kept: cards with an original price above
 * the current price whose discount state is "public" (not a loyalty/member
 * price). Marketplace partner brands ("marques amies": Sun & Sia, Fleurance
 * Nature…) appear in the same list; `maker` is the card's brand.
 *
 * Note: Yves Rocher runs promotions on a large share of its range all year, so
 * a struck price here is the brand's own reference price rather than a rare
 * markdown. France only: the .be/.ch/.de/.it/.es/.nl sites answer the runner
 * the same way but their promotion category codes were not mapped.
 *
 * NOT LISTED in lib/brands.ts / the registry (2026-11-10): ~1,400 products sit in
 * the promotions listing at a median 20% — a standing promotion on most of the
 * range rather than markdowns. Owner's call.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import type { CountryCode } from "../../../../lib/countries";
import { decodeEntities } from "./_sfcchtml";

const LIST = "https://www.yves-rocher.fr/vos-produits-en-promotion/c/perm-promotions";
const APP_UA = "okhttp/4.12.0";
const MAX_PAGES = 32;
const CAP = 1500;
const PAUSE_MS = Number(process.env.YVESROCHER_PAUSE_MS ?? 700);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "1 015,99&amp;nbsp;€" → 101599; null when not a euro amount. */
export function yrCents(s: string): number | null {
  const t = decodeEntities(decodeEntities(s)).replace(/[\s  ]/g, "");
  const m = t.match(/^(\d+)(?:,(\d{1,2}))?€$/);
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0")) : null;
}

/** Every reduced card of a list page. Pure. */
export function parseYvesRocher(html: string): ProductRecord[] {
  const out: ProductRecord[] = [];
  for (const chunk of html.split('data-yr-grid-item="product"').slice(1)) {
    const raw = chunk.replace(/\s+/g, " ");
    const now = raw.match(/class="yr-product-card__ssr-price-current">([^<]+)</)?.[1];
    const orig = raw.match(/class="yr-product-card__ssr-price-original">([^<]+)</)?.[1];
    const link = raw.match(/<a href="(https:\/\/www\.yves-rocher\.fr\/[^"]+\/p\/([A-Za-z0-9_-]+))" class="yr-product-card__ssr-link">/);
    const title = raw.match(/class="yr-product-card__ssr-title"><span>([^<]+)<\/span>(?:<span class="yr-product-card__ssr-description">([^<]*)<\/span>)?/);
    if (!now || !orig || !link || !title) continue;
    const price = yrCents(now);
    const was = yrCents(orig);
    if (price == null || was == null || price <= 0 || !(was > price)) continue;
    const state = raw.match(/"discountState":\s*"([^"]*)"/)?.[1];
    if (state && state !== "public") continue;
    const brand = decodeEntities(raw.match(/class="yr-product-card__ssr-brand">([^<]*)</)?.[1] ?? "").trim() || "Yves Rocher";
    const img = decodeEntities(raw.match(/<img src="(https:\/\/medias\.yves-rocher\.fr\/[^"]+)"[^>]*class="yr-product-card__ssr-image"/)?.[1] ?? "") || null;
    const volume = decodeEntities(raw.match(/class="yr-product-card__ssr-volume">([^<(]+)/)?.[1] ?? "").trim();
    const desc = decodeEntities(title[2] ?? "").trim();
    let name = decodeEntities(title[1]).replace(/\s+/g, " ").trim();
    if (desc && !name.toLowerCase().includes(desc.toLowerCase())) name = `${name} - ${desc}`;
    if (volume) name = `${name} ${volume}`;
    const category = raw.match(/item_category3\\":\\"([^\\]+)\\"/)?.[1] ?? null;
    out.push({
      brand: "yvesrocher",
      country: "FR",
      externalId: link[2],
      name: brand === "Yves Rocher" ? name : `${brand} ${name}`,
      url: link[1],
      imageUrl: img,
      images: cleanGallery([img], img),
      price,
      listPrice: was,
      currency: "EUR",
      inStock: !/"isUnavailable":\s*true/.test(raw),
      category,
      gender: null,
      maker: brand,
      variants: null,
      groupKey: null,
    });
  }
  return out;
}

export async function listYvesRocher(
  country: CountryCode,
  fetchHtml: (u: string) => Promise<string> = (u) => getText(u, { country, timeoutMs: 60_000, headers: { "User-Agent": APP_UA, "Accept-Language": "fr-FR,fr;q=0.9" } }),
): Promise<ProductRecord[]> {
  if (country !== "FR") return [];
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (let page = 1; page <= MAX_PAGES && byId.size < CAP; page++) {
    if (calls++) await sleep(PAUSE_MS);
    let html: string;
    try {
      html = await fetchHtml(page > 1 ? `${LIST}?currentPage=${page}` : LIST);
    } catch (err) {
      if (page === 1) throw err;
      break;
    }
    const cards = html.split('data-yr-grid-item="product"').length - 1;
    const rows = parseYvesRocher(html);
    if (page === 1 && cards > 0 && rows.length === 0) throw new Error("yvesrocher: cards on the promotions page but none parsed (markup changed?)");
    let fresh = 0;
    for (const r of rows) {
      if (byId.has(r.externalId)) continue;
      byId.set(r.externalId, r);
      fresh++;
    }
    if (!cards || !fresh || !html.includes(`currentPage=${page + 1}`)) break;
  }
  const all = [...byId.values()];
  const out = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
  console.log(`yvesrocher/FR: ${calls} pages, ${all.length} reduced, kept ${out.length}`);
  return out;
}
