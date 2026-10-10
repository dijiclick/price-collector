/**
 * Nike Turkey by url, through the same public product-feed API the collector
 * reads (packages/collector/src/brands/nike.ts). A PDP url is
 * `/tr/t/<slug>/<STYLE-COLOR>`; links shared without the colour segment
 * (`/tr/t/<slug>`) are looked up by their SEO slug instead.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, json, toMinor } from "../live-http";

const API = "https://api.nike.com/product_feed/threads/v2/";
const CHANNEL = "d9a5bc42-4b9c-4976-858a-f159cf99c647";

/** `{ slug, style }` out of a nike.com/tr product url, or null. */
export function parseNikeUrl(url: string): { slug: string; style: string | null } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)nike\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/\/t\/([^/]+)(?:\/([A-Za-z0-9]{5,}-[A-Za-z0-9]{3}))?\/?$/);
  if (!m) return null;
  return { slug: m[1], style: m[2] ? m[2].toUpperCase() : null };
}

function genderOf(genders: unknown): string | null {
  const g = Array.isArray(genders) ? genders.map(String) : [];
  if (g.length && g.every((x) => x === "BOYS" || x === "GIRLS")) return "cocuk";
  if (g.includes("WOMEN") && !g.includes("MEN")) return "kadin";
  if (g.includes("MEN") && !g.includes("WOMEN")) return "erkek";
  return null;
}

/** One thread's colourway → LiveProduct (exported for fixture tests). */
export function mapNikeThread(thread: any, style: string | null): LiveProduct | null {
  const infos: any[] = thread?.productInfo ?? [];
  const info = (style && infos.find((i) => i?.merchProduct?.styleColor === style)) || infos[0];
  const m = info?.merchProduct;
  const pr = info?.merchPrice;
  const c = info?.productContent ?? {};
  const price = Number(pr?.currentPrice);
  if (!m?.styleColor || !Number.isFinite(price) || price <= 0) return null;
  const full = Number(pr?.fullPrice ?? pr?.msrp);
  const avail: any[] = info.availableSkus ?? [];
  const card = thread?.publishedContent?.properties?.productCard?.properties;
  return {
    brand: "nike",
    externalId: String(m.styleColor),
    name: String(c.fullTitle ?? [c.title, c.subtitle].filter(Boolean).join(" ") ?? m.labelName ?? "").trim(),
    url: c.slug ? `https://www.nike.com/tr/t/${c.slug}/${m.styleColor}` : `https://www.nike.com/tr/t/-/${m.styleColor}`,
    imageUrl: card?.squarishURL ?? info.imageUrls?.productImageUrl ?? null,
    price: toMinor(price),
    listPrice: Number.isFinite(full) && full > price ? toMinor(full) : null,
    inStock: avail.length ? avail.some((a) => a?.available === true) : info.availability?.available === true,
    category: c.subtitle ?? m.productType ?? null,
    type: null,
    gender: genderOf(m.genders),
    colorName: c.colorDescription ?? null,
    country: "TR",
    currency: pr?.currency ?? "TRY",
  };
}

export async function nikeUrl(url: string): Promise<LiveProduct | null> {
  const p = parseNikeUrl(url);
  if (!p) return null;
  const filters = [
    "marketplace(TR)",
    "language(tr)",
    `channelId(${CHANNEL})`,
    p.style ? `productInfo.merchProduct.styleColor(${p.style})` : `seoSlugs(${p.slug})`,
  ];
  const q = filters.map((f) => `filter=${encodeURIComponent(f)}`).join("&");
  const res = await json<any>(`${API}?${q}`, { Accept: "application/json", "User-Agent": UA }, countryFor("nike"));
  const thread = res?.objects?.[0];
  return thread ? mapNikeThread(thread, p.style) : null;
}
