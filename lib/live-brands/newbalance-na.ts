/**
 * New Balance US / Canada by url (`www.newbalance.com/pd/<slug>/<master>.html
 * ?dwvar_<master>_style=<style>`, `www.newbalance.ca/en_ca/pd/…`). Product
 * pages, `Product-Variation` and OCAPI are Akamai-walled for datacenter egress;
 * the storefront's own search grid (`Search-UpdateGrid?q=<style>`, with
 * `X-Requested-With: XMLHttpRequest`) answers a US runner 200 (probe
 * 39137552738), so the product is read from its search tile — the same tile
 * markup the collector parses (packages/collector/src/brands/newbalance-na.ts):
 * per-colour `data-style-price` {sales, list}, tealium availability. The id is
 * the style code, as the collector's. Geo-walled outside North America, so it
 * fails from Turkey. newbalance.com.tr is another shop and returns null here.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, dispatcher, toMinor } from "../live-http";

const MARKETS = {
  "newbalance.com": { origin: "https://www.newbalance.com", site: "Sites-NBUS-Site", locale: "en_US", country: "US", currency: "USD" },
  "newbalance.ca": { origin: "https://www.newbalance.ca", site: "Sites-NBCA-Site", locale: "en_CA", country: "CA", currency: "CAD" },
} as const;
type Host = keyof typeof MARKETS;

/** {host, master, style} out of a newbalance.com / newbalance.ca product url, or null. */
export function newbalanceNaFromUrl(url: string): { host: Host; master: string; style: string | null } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, "") as Host;
  if (!(host in MARKETS)) return null;
  const master = u.pathname.match(/\/pd\/[^/]+\/([A-Za-z0-9-]+)\.html$/)?.[1];
  if (!master) return null;
  const style = u.searchParams.get(`dwvar_${master}_style`);
  return { host, master, style: style && /^[A-Za-z0-9]{3,20}$/.test(style) ? style : null };
}

const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&");
const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decode(m[1]) : null;
};
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Map a `Search-UpdateGrid?q=` body to the url's product + colour. Pure. */
export function mapNewBalanceNaGrid(html: string, host: Host, master: string, style: string | null): LiveProduct | null {
  const m = MARKETS[host];
  const tiles = html.split(/(?=<div class="pgptiles)/).filter((t) => t.startsWith('<div class="pgptiles'));
  for (const tile of tiles) {
    const raw = tile.match(/data-tealium-product-tile-data="([^"]*)"/)?.[1];
    let td: any = null;
    try { td = raw ? JSON.parse(decode(raw)) : null; } catch { td = null; }
    const id = String(td?.masterProductId ?? tile.match(/class="product[^"]*"[^>]*data-pid="([^"]+)"/)?.[1] ?? "");
    if (id !== master) continue;
    const buttons = (tile.match(/<button data-style="[\s\S]*?<\/button>/g) ?? []).map((b) => ({ b, open: b.slice(0, b.indexOf(">") + 1) }));
    const pick = (style ? buttons.find((x) => attr(x.open, "data-style") === style) : null) ?? buttons[0];
    if (!pick) return null;
    let pr: any = null;
    try { pr = JSON.parse(attr(pick.open, "data-style-price") ?? "null"); } catch { pr = null; }
    const sale = num(pr?.sales?.value);
    if (sale == null || (pr?.sales?.currency && pr.sales.currency !== m.currency)) return null;
    const list = num(pr?.list?.value);
    const img = pick.b.match(/<img[\s\S]*?\/>/)?.[0] ?? "";
    const large = attr(img, "data-large-src");
    const href = attr(pick.open, "href");
    const s = attr(pick.open, "data-style")!;
    const g = String(td?.gender ?? "");
    const avail = String(td?.productAvailability ?? "IN_STOCK").toUpperCase();
    return {
      brand: "newbalance",
      externalId: s,
      name: decode(String(td?.productName ?? "")).replace(/\s+/g, " ").trim() || master,
      url: href ? `${m.origin}${href.startsWith("/") ? "" : "/"}${href}` : `${m.origin}/pd/-/${master}.html?dwvar_${master}_style=${s}`,
      imageUrl: large ? large.replace(/wid=\d+&hei=\d+/, "wid=880&hei=880") : null,
      price: toMinor(sale),
      listPrice: list != null && list > sale ? toMinor(list) : null,
      inStock: avail === "IN_STOCK" || avail === "PREORDER" || avail === "BACKORDER",
      category: decode(tile.match(/<span class="category-name[^"]*">([\s\S]*?)<\/span>/)?.[1] ?? "").replace(/\s+/g, " ").trim() || null,
      type: null,
      gender: /kid|boy|girl|infant|toddler|youth|grade|pre-?school/i.test(g) ? "cocuk" : /women/i.test(g) ? "kadin" : /^\s*men/i.test(g) ? "erkek" : null,
      colorName: attr(img, "data-full-color-name"),
      country: m.country,
      currency: m.currency,
    };
  }
  return null;
}

export async function newbalanceNaUrl(url: string): Promise<LiveProduct | null> {
  const p = newbalanceNaFromUrl(url);
  if (!p) return null;
  const m = MARKETS[p.host];
  const q = encodeURIComponent(p.style ?? p.master);
  const target = `${m.origin}/on/demandware.store/${m.site}/${m.locale}/Search-UpdateGrid?q=${q}&start=0&sz=12`;
  try {
    const r = await fetch(target, {
      headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", Accept: "text/html, */*; q=0.01", "Accept-Language": `en-${m.country},en;q=0.9` },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(countryFor("newbalance", m.country)),
    });
    if (!r.ok) {
      console.warn(`live-lookup: ${new URL(target).host} refused with HTTP ${r.status}`);
      return null;
    }
    return mapNewBalanceNaGrid(await r.text(), p.host, p.master, p.style);
  } catch (err) {
    console.warn(`live-lookup: ${m.origin} unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
