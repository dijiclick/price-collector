/**
 * Gymshark UK (uk.gymshark.com) — headless Shopify behind a Next.js storefront.
 * `/products.json` answers 403, but the collection pages are server-rendered
 * from Algolia and carry the hits in `__NEXT_DATA__` (`pageProps.ssrQuery`):
 * price, compareAtPrice, every size with `inStock`, photos, gender. The
 * "outlet" collection is the sale (≈850 colourways, 60 per page, measured
 * 2026-10-11 from a plain request).
 *
 * Page 0 is read from the HTML (it also gives the Next build id); later pages
 * use the JSON data route `/_next/data/<buildId>/collections/outlet.json?page=N`,
 * half the bytes. If the build id rolls mid-run the HTML page is used instead.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson, getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const SITES: Partial<Record<CountryCode, string>> = { GB: "https://uk.gymshark.com" };
const COLLECTION = "outlet";
const MAX_PAGES = 25;
const PAUSE_MS = Number(process.env.GYMSHARK_PAUSE_MS ?? 800);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function genderOf(g: unknown): ProductRecord["gender"] {
  const gs = (Array.isArray(g) ? g : [g]).map((x) => String(x ?? "").toLowerCase());
  const f = gs.includes("f");
  const m = gs.includes("m");
  if (f && !m) return "kadin";
  if (m && !f) return "erkek";
  return null;
}

/** One Algolia hit from `ssrQuery.hits` → record. Pure. Prices are major units. */
export function mapGymsharkHit(hit: any, country: CountryCode = "GB"): ProductRecord | null {
  const site = SITES[country] ?? SITES.GB!;
  const price = Number(hit?.price);
  const cmp = Number(hit?.compareAtPrice);
  if (!hit?.id || !hit?.title || !hit?.handle || !Number.isFinite(price) || price <= 0) return null;
  const sizes: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const s of hit.availableSizes ?? []) {
    const label = String(s?.size ?? "").trim().toUpperCase();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: s.inStock ? "in_stock" : "out_of_stock" });
  }
  const imgs: string[] = [hit.featuredMedia?.src, ...(hit.media ?? []).map((m: any) => m?.src)].filter(
    (u): u is string => typeof u === "string",
  );
  const colour = typeof hit.colour === "string" && hit.colour.trim() ? hit.colour.trim() : null;
  const type = typeof hit.type === "string" ? hit.type.split(">").filter(Boolean) : [];
  return {
    brand: "gymshark",
    country,
    externalId: String(hit.id),
    name: String(hit.title).trim(),
    url: `${site}/products/${hit.handle}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: Number.isFinite(cmp) && cmp > price ? toMinor(cmp) : null,
    currency: COUNTRIES[country].currency,
    inStock: sizes.length ? sizes.some((s) => s.availability === "in_stock") : hit.inStock !== false,
    category: type.length >= 3 ? type[2].replace(/_/g, " ") : type.at(-1) ?? null,
    gender: genderOf(hit.gender),
    variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: hit.sku ? `gymshark:${hit.sku}` : null,
    colorName: colour,
  };
}

/** `__NEXT_DATA__` from a page's HTML, or null. */
export function nextData(html: string): any | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  try {
    return m ? JSON.parse(m[1]) : null;
  } catch {
    return null;
  }
}

/** Register as `listGymshark(country)`. GB only for now. */
export async function listGymshark(country: CountryCode): Promise<ProductRecord[]> {
  const site = SITES[country];
  if (!site) return [];
  const cap = 1500;
  const first = nextData(await getText(`${site}/collections/${COLLECTION}`, { country }));
  const q0 = first?.props?.pageProps?.ssrQuery;
  if (!q0?.hits) throw new Error(`gymshark/${country}: no ssrQuery on the ${COLLECTION} page`);
  const buildId: string | undefined = first?.buildId;
  const pages = Math.min(Number(q0.nbPages) || 1, MAX_PAGES);
  const byId = new Map<string, ProductRecord>();
  const take = (hits: any[]) => {
    for (const h of hits ?? []) {
      const r = mapGymsharkHit(h, country);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
  };
  take(q0.hits);
  for (let p = 1; p < pages && byId.size < cap; p++) {
    await sleep(PAUSE_MS);
    let q: any = null;
    if (buildId) {
      const d = await getJson<any>(`${site}/_next/data/${buildId}/collections/${COLLECTION}.json?page=${p}`, { country, retries: 0 }).catch(() => null);
      q = d?.pageProps?.ssrQuery;
    }
    if (!q?.hits) q = nextData(await getText(`${site}/collections/${COLLECTION}?page=${p}`, { country }))?.props?.pageProps?.ssrQuery;
    if (!q?.hits?.length) break;
    take(q.hits);
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
}
