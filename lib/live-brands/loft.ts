/**
 * LOFT by url (`loft.com.tr/p/<slug>-<groupcode>`). The shop renders HTML
 * only, so the lookup asks the Insider feed the collector reads
 * (packages/collector/src/brands/loft.ts) for that group: the feed accepts an
 * exact `[groupcode][=][…]` filter and answers from any egress. The id is the
 * groupcode, as the collector stores. The feed only lists IN-STOCK items, so an
 * empty answer means sold out or unknown — reported as a miss.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, json, toMinor } from "../live-http";

export function loftGroupFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!u.hostname.toLowerCase().replace(/^www\./, "").endsWith("loft.com.tr")) return null;
  return u.pathname.match(/^\/p\/[^/]*?-(\d+)\/?$/)?.[1] ?? null;
}

const fold = (s: string) => s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").toLowerCase();

/** Map an Insider body's first row. Pure. */
export function mapLoftFeed(body: any): LiveProduct | null {
  const x = body?.data?.[0];
  const price = Number(x?.price?.TRY);
  if (!x?.groupcode || !x?.name || typeof x.url !== "string" || !Number.isFinite(price) || price <= 0) return null;
  const orig = Number(x.original_price?.TRY);
  const g = fold(String(x.gender ?? ""));
  const cats: string[] = Array.isArray(x.category) ? x.category.map(String) : [];
  return {
    brand: "loft",
    externalId: String(x.groupcode),
    name: String(x.name).replace(/\s+/g, " ").trim(),
    url: x.url.split("#")[0],
    imageUrl: typeof x.image_url === "string" ? x.image_url : null,
    price: toMinor(price),
    listPrice: Number.isFinite(orig) && orig > price ? toMinor(orig) : null,
    inStock: x.in_stock !== 0,
    category: cats.find((c) => !/^(kad[ıi]n|erkek)$/i.test(c.trim())) ?? (typeof x.product_type === "string" ? x.product_type : null),
    type: null,
    gender: /cocuk/.test(g) ? "cocuk" : /kadin/.test(g) ? "kadin" : /erkek/.test(g) ? "erkek" : null,
    colorName: typeof x.color === "string" && x.color.trim() ? x.color.trim() : null,
    country: "TR",
    currency: "TRY",
  };
}

export async function loftUrl(url: string): Promise<LiveProduct | null> {
  const group = loftGroupFromUrl(url);
  if (!group) return null;
  const q = new URLSearchParams({
    details: "true", locale: "tr_TR", currency: "TRY", partnerName: "loft",
    clientId: "g0uSLhenGOKvzAtz", size: "10", filter: `([groupcode][=][${group}])`,
  });
  const body = await json<any>(
    `https://recommendationv2.api.useinsider.com/v2/most-popular?${q}`,
    { Accept: "application/json", "User-Agent": UA },
    countryFor("loft"),
  );
  return mapLoftFeed(body);
}
