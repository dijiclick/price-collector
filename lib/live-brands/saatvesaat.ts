/**
 * Saat&Saat by url (`saatvesaat.com.tr/<url_key>`, e.g.
 * `/guess-kadin-kol-saati-p-guw0911l3`). The SKU sits after `-p-` in the
 * url key; the site's own Elasticsearch proxy (`/elastic.php?q=<sku>`) answers
 * the product with list price, shelf price and stock — the same source the
 * collector walks, so the id (the SKU) and the prices match it. Magento's
 * `/graphql` is NOT used: Cloudflare 403s it from US datacenter egress.
 *
 * The index carries in-stock products only, so a sold-out link falls back to
 * the product page: its JSON-LD gives name, image and availability, and
 * `product:price:amount` the shelf price. The page renders the list price in
 * JS only, so that path quotes no listPrice. JSON-LD's `price` is the basket
 * ("Sepette") price and is never used.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, dispatcher, json } from "../live-http";

const SITE = "https://www.saatvesaat.com.tr";
const IMAGE_PREFIX = "https://cdn.saatvesaat.com.tr/mnresize/740/-/media/catalog/product";

export function saatvesaatKeyFromUrl(url: string): { urlKey: string; sku: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!u.hostname.toLowerCase().endsWith("saatvesaat.com.tr")) return null;
  const urlKey = decodeURIComponent(u.pathname.replace(/^\/+|\/+$/g, "").replace(/\.html$/, ""));
  if (!urlKey || urlKey.includes("/")) return null;
  const sku = urlKey.match(/-p-([a-z0-9._-]+)$/i)?.[1];
  return sku ? { urlKey, sku: sku.toUpperCase() } : null;
}

const fold = (s: string) =>
  s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").replace(/[Şş]/g, "s").toLowerCase();
const num = (v: unknown) => (typeof v === "number" ? v : parseFloat(String(v ?? "")));

function genderOf(g: unknown): string | null {
  const gs = Array.isArray(g) ? g.map((x) => fold(String(x))) : [];
  if (gs.includes("cocuk")) return "cocuk";
  if (gs.includes("kadin") && !gs.includes("erkek")) return "kadin";
  if (gs.includes("erkek") && !gs.includes("kadin")) return "erkek";
  return null;
}

function categoryOf(s: any): string | null {
  const ptype = typeof s?.ptype === "string" ? s.ptype.trim() : "";
  if (ptype === "Set") return /saat/.test(fold(String(s?.name ?? ""))) ? "Saat Seti" : "Takı Seti";
  if (ptype === "Saat") {
    try {
      const crumbs = JSON.parse(s?.breadcrumb ?? "[]");
      const leaf = Array.isArray(crumbs) ? crumbs[crumbs.length - 1]?.name : null;
      if (typeof leaf === "string" && /saat/.test(fold(leaf))) return leaf.trim();
    } catch { /* fall through */ }
    return "Saat";
  }
  return ptype || null;
}

function withBrand(name: string, brand: unknown): string {
  const n = name.replace(/\s+/g, " ").trim();
  const b = typeof brand === "string" ? brand.trim() : "";
  return b && !fold(n).startsWith(fold(b)) ? `${b} ${n}` : n;
}

/** Map one elastic `_source`. Pure. Prices are major-unit TRY. */
export function mapSaatvesaatSource(s: any): LiveProduct | null {
  if (!s?.sku || !s?.url_key || !s?.name) return null;
  const list = num(s.price);
  const special = num(s.special_price);
  if (!Number.isFinite(list) || list <= 0) return null;
  const price = Number.isFinite(special) && special > 0 && special < list ? special : list;
  const dial = Array.isArray(s.kadran_renk) ? s.kadran_renk.filter(Boolean) : [];
  return {
    brand: "saatvesaat",
    externalId: String(s.sku),
    name: withBrand(String(s.name), s.brand),
    url: `${SITE}/${s.url_key}`,
    imageUrl: typeof s.image === "string" && s.image.startsWith("/") ? `${IMAGE_PREFIX}${s.image}` : null,
    price: Math.round(price * 100),
    listPrice: price < list ? Math.round(list * 100) : null,
    inStock: Number(s.is_in_stock) === 1,
    category: categoryOf(s),
    type: null,
    gender: genderOf(s.gender),
    colorName: dial.length === 1 ? String(dial[0]) : null,
    country: "TR",
    currency: "TRY",
  };
}

/** Map a product page (the sold-out fallback). Pure. */
export function mapSaatvesaatHtml(html: string, urlKey: string): LiveProduct | null {
  const amount = html.match(/<meta property="product:price:amount" content="([\d.]+)"/)?.[1];
  const price = num(amount);
  if (!Number.isFinite(price) || price <= 0) return null;
  let ld: any = null;
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]);
      const p = [j, ...(Array.isArray(j?.["@graph"]) ? j["@graph"] : [])].find((x) => x?.["@type"] === "Product");
      if (p) { ld = p; break; }
    } catch { /* not JSON */ }
  }
  if (!ld?.sku || !ld?.name) return null;
  const img = Array.isArray(ld.image) ? ld.image[0] : ld.image;
  const n = fold(String(ld.name));
  return {
    brand: "saatvesaat",
    externalId: String(ld.sku),
    name: withBrand(String(ld.name), ld.brand?.name),
    url: `${SITE}/${urlKey}`,
    imageUrl: typeof img === "string" ? img : null,
    price: Math.round(price * 100),
    listPrice: null,
    inStock: /InStock/.test(String(ld.offers?.availability ?? "")),
    category: /saat/.test(n) ? "Saat" : null,
    type: null,
    gender: /\bkadin\b/.test(n) ? "kadin" : /\berkek\b/.test(n) ? "erkek" : null,
    colorName: null,
    country: "TR",
    currency: "TRY",
  };
}

export async function saatvesaatUrl(url: string): Promise<LiveProduct | null> {
  const key = saatvesaatKeyFromUrl(url);
  if (!key) return null;
  const country = countryFor("saatvesaat");
  const data = await json<any>(
    `${SITE}/elastic.php?categoryId=2&q=${encodeURIComponent(key.sku)}&order=position&direction=desc`,
    { Accept: "application/json", "X-Requested-With": "XMLHttpRequest", "User-Agent": UA },
    country,
  );
  const hits: any[] = data?.product?.hits?.hits ?? [];
  const hit = hits.map((h) => h?._source).find((s) => s?.url_key === key.urlKey);
  if (hit) return mapSaatvesaatSource(hit);
  try {
    const r = await fetch(`${SITE}/${key.urlKey}`, {
      headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "tr-TR,tr;q=0.9" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(country),
    });
    if (!r.ok) {
      console.warn(`live-lookup: www.saatvesaat.com.tr refused with HTTP ${r.status}`);
      return null;
    }
    return mapSaatvesaatHtml(await r.text(), key.urlKey);
  } catch (err) {
    console.warn(`live-lookup: www.saatvesaat.com.tr unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
