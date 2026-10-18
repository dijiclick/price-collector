/**
 * Sport Chek and Mark's by url (`sportchek.ca/en/pdp/<slug>-<code>.html`,
 * `marks.com/en/pdp/<slug>-<code>.html`, optionally `#COLOUR=COLOUR_<id>`).
 * Both are Canadian Tire banners: the product is read back from the same
 * search gateway the collector uses (packages/collector/src/brands/_ctc.ts),
 * searching for its style code, so the ids are the collector's
 * (`<code>-<colour id>`). The gateway key is public (storefront config).
 */
import type { LiveProduct } from "../live-lookup";
import { countryFor, json } from "../live-http";

type Banner = "sportchek" | "marks";
const BANNERS: Record<Banner, { site: string; api: string; banner: string; client: string; store: string }> = {
  sportchek: { site: "https://www.sportchek.ca", api: "https://apim.sportchek.ca", banner: "SC", client: "sc/web", store: "241" },
  marks: { site: "https://www.marks.com", api: "https://apim.marks.com", banner: "MKS", client: "mks/web", store: "208" },
};
const KEY = "c01ef3612328420c9f5cd9277e815a0e";

export function ctcFromUrl(url: string): { brand: Banner; code: string; colour: string | null; path: string; words: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const brand: Banner | null = /(^|\.)sportchek\.ca$/.test(host) ? "sportchek" : /(^|\.)marks\.com$/.test(host) ? "marks" : null;
  const m = u.pathname.match(/^(\/(?:en|fr)\/pdp\/([^/]*?)-(\d+[a-z]))\.html$/i);
  if (!brand || !m) return null;
  const colour = decodeURIComponent(u.hash).match(/COLOUR=COLOUR_([^&]+)/i)?.[1] ?? null;
  return { brand, code: m[3].toUpperCase(), colour, path: `${m[1]}.html`, words: m[2].replace(/-/g, " ") };
}

const single = (o: any): number | null => {
  if (!o || o.minPrice != null || o.maxPrice != null) return null;
  const n = Number(o.value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

/** Map a search body for one style code. Pure. */
export function mapCtcSearch(body: any, brand: Banner, code: string, colour: string | null): LiveProduct | null {
  const b = BANNERS[brand];
  const p = (Array.isArray(body?.products) ? body.products : []).find((x: any) => String(x?.code ?? "").toUpperCase() === code);
  if (!p?.title) return null;
  const values: any[] = (p.options ?? []).find((o: any) => o?.descriptor === "COLOUR")?.values ?? [];
  const v = (colour && values.find((x) => String(x?.id ?? "").toUpperCase() === `COLOUR_${colour}`.toUpperCase())) ?? values[0];
  const price = single(v?.currentPrice);
  if (!v?.id || price == null) return null;
  const regular = single(v.originalPrice);
  const title = String(p.title).trim();
  const make = String(p?.brand?.label ?? "").trim();
  const img = v.mediaSet?.[0]?.url ?? p.images?.[0]?.url ?? null;
  return {
    brand,
    externalId: `${p.code}-${String(v.id).replace(/^COLOUR_/, "")}`,
    name: make && !title.toLowerCase().startsWith(make.toLowerCase()) ? `${titleCase(make)} ${title}` : title,
    url: `${b.site}${String(p.url ?? "").split(/[?#]/)[0]}`,
    imageUrl: typeof img === "string" ? img : null,
    price,
    listPrice: regular != null && regular > price ? regular : null,
    inStock: v.maxSkuAts == null ? true : Number(v.maxSkuAts) > 0,
    category: null,
    type: null,
    gender: /\bwomen'?s\b/i.test(title) ? "kadin" : /\bmen'?s\b/i.test(title) ? "erkek" : null,
    colorName: v.value ? titleCase(String(v.value)) : null,
    country: "CA",
    currency: "CAD",
  };
}

async function resolve(url: string): Promise<LiveProduct | null> {
  const hit = ctcFromUrl(url);
  if (!hit) return null;
  const b = BANNERS[hit.brand];
  // Searching the bare style code answers a redirect to the product page (no
  // products); the slug's words return the style among the hits.
  const q = new URLSearchParams({ q: hit.words, count: "40", lang: "en_CA", site: "ct", format: "json", store: b.store });
  const body = await json<any>(
    `${b.api}/v1/search/v2/search?${q}`,
    {
      "Ocp-Apim-Subscription-Key": KEY,
      bannerid: b.banner,
      basesiteid: b.banner,
      "service-client": b.client,
      "service-version": "v1",
      lang: "en_CA",
      "x-web-host": new URL(b.site).host,
      Accept: "application/json",
    },
    countryFor(hit.brand, "CA"),
  );
  return body ? mapCtcSearch(body, hit.brand, hit.code, hit.colour) : null;
}

export const sportchekUrl = resolve;
export const marksUrl = resolve;
