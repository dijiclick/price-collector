/**
 * New Balance US (newbalance.com) + Canada (newbalance.ca) — the sale grid of
 * NB's own Salesforce (SFRA) storefront, read through `Search-UpdateGrid`, the
 * endpoint the "Load more" button calls. Turkey is a different shop
 * (newbalance.ts) and is untouched.
 *
 * Why this works: Akamai answers every page navigation on both hosts with 403
 * — pages, robots.txt, sitemaps, OCAPI, and the SFCC origin
 * (`production-web-newbalance.demandware.net`, Cloudflare 403) — from GitHub
 * runners, from Turkey and from the Hetzner box (Germany). The grid endpoint
 * answers a US runner 200 when the request carries `X-Requested-With:
 * XMLHttpRequest`, as the site's own XHR does (probe 39136904202 / 39137256578:
 * US 228,502 B, CA 2,048,460 B at sz=200). It is still geo-walled outside
 * North America, so it only works from the collector's US egress.
 *
 * Sale trees: US `cgid=400143` (/sale/), CA `cgid=6000` (/en_ca/sale/), read
 * from the pages' own "Load more" urls. Each tile is one style family
 * (`data-pid` = master) with one swatch button per colour; the swatch carries
 * that colour's price as JSON (`data-style-price`: `sales` and, only when
 * reduced, `list`). One record per reduced colour; full-price colours of a
 * reduced family are dropped. The tile's tealium JSON gives name, gender and
 * product availability. The reduced price is the storefront's shelf price for
 * a guest (pricebook markdown or an automatic, no-code promotion shown on the
 * tile); coupon offers are never on the tile. No per-size stock in the grid.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "newbalance";

export const NB_MARKETS: Partial<Record<CountryCode, { origin: string; site: string; locale: string; cgid: string; currency: string; prefix: string }>> = {
  US: { origin: "https://www.newbalance.com", site: "Sites-NBUS-Site", locale: "en_US", cgid: "400143", currency: "USD", prefix: "" },
  CA: { origin: "https://www.newbalance.ca", site: "Sites-NBCA-Site", locale: "en_CA", cgid: "6000", currency: "CAD", prefix: "/en_ca" },
};

const PAGE = 100;
const MAX_PAGES = 15;
const CAP = 1500;
const PAUSE_MS = Number(process.env.NB_NA_PAUSE_MS ?? 400);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function nbGridUrl(country: CountryCode, start: number, sz = PAGE): string {
  const m = NB_MARKETS[country]!;
  return `${m.origin}/on/demandware.store/${m.site}/${m.locale}/Search-UpdateGrid?cgid=${m.cgid}&start=${start}&sz=${sz}`;
}

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decode(m[1]) : null;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

function genderOf(g: unknown): ProductRecord["gender"] {
  const s = String(g ?? "");
  if (/kid|boy|girl|infant|toddler|youth|grade|pre-?school|little|big/i.test(s)) return "cocuk";
  if (/women/i.test(s)) return "kadin";
  if (/^\s*men/i.test(s)) return "erkek";
  return null;
}

/** The grid HTML split into product tiles. */
export function nbTiles(html: string): string[] {
  return html.split(/(?=<div class="pgptiles)/).filter((t) => t.startsWith('<div class="pgptiles'));
}

/** One grid tile → one record per reduced colour. Pure. */
export function mapNewBalanceTile(tile: string, country: CountryCode): ProductRecord[] {
  const m = NB_MARKETS[country];
  if (!m) return [];
  const raw = tile.match(/data-tealium-product-tile-data="([^"]*)"/)?.[1];
  let td: any = null;
  try { td = raw ? JSON.parse(decode(raw)) : null; } catch { td = null; }
  const master = String(td?.masterProductId ?? td?.productId ?? tile.match(/class="product[^"]*"[^>]*data-pid="([^"]+)"/)?.[1] ?? "");
  const pname = tile.match(/class="link[^"]*pname[^"]*" href="([^"]*)">([^<]*)</);
  const name = decode(String(td?.productName ?? pname?.[2] ?? "")).replace(/\s+/g, " ").trim();
  if (!master || !name) return [];
  const category = decode(tile.match(/<span class="category-name[^"]*">([\s\S]*?)<\/span>/)?.[1] ?? "").replace(/\s+/g, " ").trim() || null;
  const avail = String(td?.productAvailability ?? "IN_STOCK").toUpperCase();
  const inStock = avail === "IN_STOCK" || avail === "PREORDER" || avail === "BACKORDER";
  const out: ProductRecord[] = [];
  for (const b of tile.match(/<button data-style="[\s\S]*?<\/button>/g) ?? []) {
    const open = b.slice(0, b.indexOf(">") + 1);
    const style = attr(open, "data-style");
    let pr: any = null;
    try { pr = JSON.parse(attr(open, "data-style-price") ?? "null"); } catch { pr = null; }
    const sale = num(pr?.sales?.value);
    const list = num(pr?.list?.value);
    if (!style || sale == null || list == null || !(sale < list)) continue;
    if ((pr.sales.currency && pr.sales.currency !== m.currency) || (pr.list.currency && pr.list.currency !== m.currency)) continue;
    const img = b.match(/<img[\s\S]*?\/>/)?.[0] ?? "";
    const big = (u: string | null | undefined) => (u ? u.split(/\s+/)[0].replace(/wid=\d+&hei=\d+/, "wid=880&hei=880") : null);
    const first = big(attr(img, "data-large-src"));
    const next = big(attr(img, "data-large-srcset-next"));
    const href = attr(open, "href") ?? `${m.prefix}/pd/-/${master}.html?dwvar_${master}_style=${style}`;
    const colour = attr(img, "data-full-color-name");
    out.push({
      brand,
      country,
      externalId: style,
      name,
      url: `${m.origin}${href.startsWith("/") ? "" : "/"}${href}`,
      imageUrl: first,
      images: cleanGallery([first, next], first),
      price: toMinor(sale),
      listPrice: toMinor(list),
      currency: m.currency,
      inStock,
      category,
      gender: genderOf(td?.gender),
      variants: colour ? { colors: [colour], sizes: [] } : null,
      groupKey: `nb:${master}`,
      colorName: colour,
    });
  }
  return out;
}

export async function listNewBalanceNa(country: CountryCode): Promise<ProductRecord[]> {
  const m = NB_MARKETS[country];
  if (!m) return [];
  const byId = new Map<string, ProductRecord>();
  const refused: string[] = [];
  let pagesOk = 0;
  let tiles = 0;
  for (let page = 0; page < MAX_PAGES && byId.size < CAP; page++) {
    if (page) await sleep(PAUSE_MS);
    const html = await getText(nbGridUrl(country, page * PAGE), {
      country,
      timeoutMs: 30_000,
      headers: { "X-Requested-With": "XMLHttpRequest", Accept: "text/html, */*; q=0.01", Referer: `${m.origin}${m.prefix}/sale/` },
    }).catch((e) => {
      refused.push(`start ${page * PAGE}: ${String(e?.message ?? e).slice(0, 80)}`);
      return null;
    });
    if (html == null) break;
    pagesOk++;
    const ts = nbTiles(html);
    tiles += ts.length;
    for (const t of ts) for (const r of mapNewBalanceTile(t, country)) if (!byId.has(r.externalId)) byId.set(r.externalId, r);
    if (ts.length < PAGE) break;
  }
  if (refused.length) console.warn(`newbalance/${country}: ${refused.join("; ")}`);
  if (pagesOk === 0) throw new Error(`newbalance/${country}: sale grid refused (${refused.join("; ")})`);
  const rows = [...byId.values()];
  if (!rows.length) throw new Error(`newbalance/${country}: 0 reduced colours in ${tiles} sale tiles — the grid changed shape or the sale ended`);
  rows.sort((a, b) => Number(b.inStock) - Number(a.inStock));
  return rows.slice(0, CAP);
}

export const listProducts = listNewBalanceNa;
