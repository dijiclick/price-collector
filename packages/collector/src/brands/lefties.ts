import { gunzipSync } from "node:zlib";
import { cleanGallery, type ProductRecord } from "../types";
import { getJson, getText } from "../http";
import { pickImage, pickImages, pickVariants, anySizeInStock, resolveMarket, type InditexMarket } from "./_inditex";

/**
 * Lefties (Inditex, itxrest brandId 9) — Turkey only.
 *
 * The other Inditex crawls walk the category tree, but on Lefties every
 * category and grid endpoint answers Akamai's 403 page (verified 2026-10-10,
 * with and without appId/CORS headers), while the store list and
 * `productsArray` answer 200. So the product ids come from Lefties' own
 * product sitemap instead (`sitemap-products-lf-tr-*.xml.gz`, ~1,900 unique
 * ids), which also hands us each product's canonical Turkish url.
 *
 * The whole Turkish catalogue fits under the 2,000 cap, so everything is
 * collected — full-price items included — and a markdown shows up as a
 * price_drop on a row we already hold rather than as a new product.
 */
export const brand = "lefties";

const DOMAIN = "www.lefties.com";
const SITE = {
  domain: DOMAIN,
  brandId: 9,
  // Only used if the store list cannot be read (LEFTIES_TR).
  trFallback: { storeId: 94009021, catalogId: 90009064 },
};
const SITEMAP_INDEX = `https://${DOMAIN}/9/info/sitemaps/sitemap-index-products-lf.xml`;
const MAX_PRODUCTS = Number(process.env.LEFTIES_MAX_PRODUCTS ?? 2000);
const CONCURRENCY = Math.min(3, Number(process.env.LEFTIES_CONCURRENCY ?? 3));
// productsArray answers ~60 KB per product; 50 ids keeps a response ~3 MB.
const BATCH = 50;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Product id → canonical url, from sitemap xml. Turkish urls win over `/tr/en/`
 * ones, and slugless `c…p….html?keyWordReplace=` entries (marketing bundles)
 * are skipped. Pure.
 */
export function idsFromSitemap(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const url = m[1].trim().replace(/&amp;/g, "&");
    if (!/^https:\/\/www\.lefties\.com\/tr\//.test(url) || url.includes("?")) continue;
    const id = url.match(/-c\d+p(\d{6,})\.html$/)?.[1];
    if (!id) continue;
    const english = url.includes("/tr/en/");
    if (!out.has(id) || (!english && out.get(id)!.includes("/tr/en/"))) out.set(id, url);
  }
  return out;
}

/**
 * Gender from the url's storefront section (`/tr/kadın/…`, `/tr/en/kids/…`,
 * `/tr/home/…`), else from sectionNameEN (WOMEN / MEN / BOYS & GIRLS). The url
 * wins because home goods carry sectionNameEN "WOMEN". Never read from the
 * slug — "boyfriend jean" is not a kids' item.
 */
export function leftiesGender(section: string | null | undefined, url = ""): ProductRecord["gender"] {
  const seg = decodeURIComponentSafe(url).toLowerCase().match(/\/tr\/(?:en\/)?([^/]+)\/[^/]+\//)?.[1] ?? "";
  if (/^(çocuk|kids|bebek|baby)$/.test(seg)) return "cocuk";
  if (/^(kadın|woman|women)$/.test(seg)) return "kadin";
  if (/^(erkek|man|men)$/.test(seg)) return "erkek";
  if (seg === "home") return null;
  const s = String(section ?? "").toUpperCase();
  if (/\b(BOYS?|GIRLS?|BABY|KIDS?)\b/.test(s)) return "cocuk";
  if (/\bWOMEN\b/.test(s)) return "kadin";
  if (/\bMEN\b/.test(s)) return "erkek";
  return null;
}

function decodeURIComponentSafe(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * Lefties serves about half its media with a RELATIVE `url`
 * (`assets/public/…/01350311620-P.jpg`) and the absolute one only in
 * `extraInfo.deliveryUrl`. The shared Inditex pickers read `url` first and
 * drop a non-http one, which left ~45% of products imageless — so hand them a
 * copy with every media url made absolute.
 */
export function withAbsoluteMedia(detail: any): any {
  if (!Array.isArray(detail?.xmedia)) return detail;
  const abs = (m: any) => {
    const u = m?.url;
    if (typeof u === "string" && /^https?:\/\//.test(u)) return m;
    const d = m?.extraInfo?.deliveryUrl;
    const fixed = typeof d === "string" && /^https?:\/\//.test(d)
      ? d
      : typeof u === "string" && u.startsWith("assets/") ? `https://static.lefties.com/${u}` : u;
    return { ...m, url: fixed };
  };
  return {
    ...detail,
    xmedia: detail.xmedia.map((x: any) => ({
      ...x,
      xmediaItems: (x?.xmediaItems ?? []).map((it: any) => ({ ...it, medias: (it?.medias ?? []).map(abs) })),
    })),
  };
}

/** "L3O:SNEAKERS" → "SNEAKERS"; trims; empty → null. */
export function leftiesCategory(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/^[A-Z0-9]{2,4}:/, "").trim();
  return s || null;
}

/**
 * One productsArray entry. Bundles wrap the sellable product in
 * bundleProductSummaries[0]; some are marketing shells whose own name/url is
 * junk (`-l93428730669BSBS`, "lang.search.input.placeholder"), so everything is
 * read from the inner product. The stored id is that product's id — the
 * `p{id}` of its url — so a pasted link maps straight to the row.
 */
export function mapProduct(
  m: Pick<InditexMarket, "urlPrefix" | "currency">,
  p: any,
  urls: Map<string, string>,
): ProductRecord | null {
  const real = p?.bundleProductSummaries?.[0] ?? p;
  const id = real?.id != null ? String(real.id) : "";
  const detail = real?.detail;
  const color = detail?.colors?.[0];
  const name = String(real?.name ?? "").trim();
  if (!id || !color || !name) return null;

  let price = Infinity;
  let listPrice: number | null = null;
  for (const s of color.sizes ?? []) {
    const v = Number(s?.price); // integer minor units already: "119000" = ₺1.190,00
    if (!Number.isFinite(v) || v <= 0 || v >= price) continue;
    price = v;
    const old = s?.oldPrice == null ? NaN : Number(s.oldPrice);
    listPrice = Number.isFinite(old) && old > v ? old : null;
  }
  if (!Number.isFinite(price)) return null;

  const slug = String(real.productUrl ?? "");
  const url =
    urls.get(id) ??
    urls.get(String(p.id)) ??
    `${m.urlPrefix}/${encodeURI(slug.replace(/-l\d+$/, ""))}-c0p${id}.html`;
  const ref = String(detail?.displayReference ?? "").replace(/\D/g, "");
  const media = withAbsoluteMedia(detail);
  const imageUrl = pickImage(media, color.id);
  return {
    brand,
    country: "TR",
    externalId: id,
    // The tag's article number, so a scanned label resolves (as Bershka does).
    barcodes: ref.length >= 6 ? [ref] : null,
    name,
    url,
    imageUrl,
    images: cleanGallery(pickImages(media, color.id), imageUrl),
    price,
    listPrice,
    currency: m.currency,
    inStock: p.isBuyable !== false && anySizeInStock(color.sizes),
    category: leftiesCategory(p.subFamilyName || p.familyName || real.familyName),
    gender: leftiesGender(p.sectionNameEN ?? real.sectionNameEN, url),
    variants: pickVariants(detail),
    colorName: color.name ?? null,
  };
}

async function sitemapXml(url: string): Promise<string> {
  if (!url.endsWith(".gz")) return getText(url);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Served as a .gz file, not with Content-Encoding — gunzip it ourselves.
  return buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
}

export async function listProducts(): Promise<ProductRecord[]> {
  const m = await resolveMarket(SITE, "TR");
  const index = await getText(SITEMAP_INDEX);
  const maps = [...index.matchAll(/<loc>([^<]*sitemap-products-lf-tr-\d+\.xml(?:\.gz)?)<\/loc>/g)].map((x) => x[1]);
  const urls = new Map<string, string>();
  for (const sm of maps) for (const [id, u] of idsFromSitemap(await sitemapXml(sm))) urls.set(id, u);
  const ids = [...urls.keys()];

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH) chunks.push(ids.slice(i, i + BATCH));
  const byId = new Map<string, ProductRecord>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, async () => {
      while (next < chunks.length && byId.size < MAX_PRODUCTS) {
        const chunk = chunks[next++];
        try {
          const data = await getJson<any>(
            `https://${DOMAIN}/itxrest/3/catalog/store/${m.storeId}/${m.catalogId}/productsArray` +
              `?productIds=${chunk.join(",")}&languageId=${m.languageId}&appId=1`,
            { headers: { Referer: `${m.urlPrefix}/` } },
          );
          for (const p of data?.products ?? []) {
            const rec = mapProduct(m, p, urls);
            if (rec && !byId.has(rec.externalId)) byId.set(rec.externalId, rec);
          }
        } catch {
          // skip a failing chunk; keep going
        }
      }
    }),
  );
  return [...byId.values()].slice(0, MAX_PRODUCTS);
}
