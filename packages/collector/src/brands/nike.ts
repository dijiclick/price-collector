import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

/**
 * Nike Turkey through the public product-feed API nike.com's own web app reads
 * (no key, no cookie). One `threads/v2` page carries price, every size with
 * its live availability, photos and copy, so the whole sale is a handful of
 * requests — no per-product detail call.
 *
 * Filters, measured 2026-10-10: `merchPrice.discounted(true)` alone matches
 * ~17k threads, most of them retired (`merchProduct.status` INACTIVE) colourways
 * the site no longer sells. Adding `status(ACTIVE)` brings it to ~226, which
 * lines up with the ~182 cards on nike.com/tr/w/seri-sonu (the web wall groups
 * a few colourways per card). Sold-out actives are kept on purpose: they are
 * exactly the rows a size restock will light up.
 */
const API = "https://api.nike.com/product_feed/threads/v2/";
const CHANNEL = "d9a5bc42-4b9c-4976-858a-f159cf99c647"; // Nike.com consumer channel
const PAGE = 50;
const MAX_PAGES = Number(process.env.NIKE_MAX_PAGES ?? 40); // 2,000 products

/**
 * Markets, 2026-10-11. The feed answers any marketplace without a key; the
 * language decides how much it returns — `en` gives GB/CA/AU nothing, `en-GB`
 * gives the most (measured: US 10,834 sale threads, NO 2,427, GB 2,626, CH
 * 2,378, AU 91, CA 10). AE/SA answer too, but nike.ae/nike.sa are separate
 * franchise shops, so a nike.com url there would not be the shop's price.
 */
export const NIKE_MARKETS: Partial<Record<CountryCode, { language: string; site: string }>> = {
  TR: { language: "tr", site: "https://www.nike.com/tr" },
  US: { language: "en", site: "https://www.nike.com" },
  GB: { language: "en-GB", site: "https://www.nike.com/gb" },
  CA: { language: "en-GB", site: "https://www.nike.com/ca" },
  AU: { language: "en-GB", site: "https://www.nike.com/au" },
  CH: { language: "en-GB", site: "https://www.nike.com/ch" },
  NO: { language: "en-GB", site: "https://www.nike.com/no" },
};

export function threadsUrl(extra: string[], anchor = 0, count = PAGE, country: CountryCode = "TR"): string {
  const m = NIKE_MARKETS[country] ?? NIKE_MARKETS.TR!;
  const base = [`marketplace(${country})`, `language(${m.language})`, `channelId(${CHANNEL})`, "exclusiveAccess(true,false)"];
  const f = [...base, ...extra].map((x) => `filter=${encodeURIComponent(x)}`).join("&");
  return `${API}?${f}&anchor=${anchor}&count=${count}`;
}

function genderOf(genders: unknown): ProductRecord["gender"] {
  const g = Array.isArray(genders) ? genders.map(String) : [];
  if (g.length === 0) return null;
  if (g.every((x) => x === "BOYS" || x === "GIRLS")) return "cocuk";
  const men = g.includes("MEN");
  const women = g.includes("WOMEN");
  if (women && !men) return "kadin";
  if (men && !women) return "erkek";
  return null; // unisex
}

/** Sizes in the order Nike lists them, each with its live availability. */
export function sizesOf(info: any, country: CountryCode = "TR"): SizeVariant[] {
  const avail = new Map<string, any>();
  for (const a of info?.availableSkus ?? []) if (a?.skuId) avail.set(String(a.skuId), a);
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const s of info?.skus ?? []) {
    const spec = (s?.countrySpecifications ?? []).find((c: any) => c?.country === country) ?? s?.countrySpecifications?.[0];
    const label = String(spec?.localizedSize ?? s?.nikeSize ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const a = avail.get(String(s.id));
    const availability: SizeVariant["availability"] = !a?.available
      ? "out_of_stock"
      : a.level === "LOW"
        ? "low_on_stock"
        : "in_stock";
    out.push({ label, availability });
  }
  return out;
}

/** Product photos of this colourway, in thread order, videos dropped. */
function photosOf(thread: any): string[] {
  const nodes: any[] = thread?.publishedContent?.nodes?.[0]?.nodes ?? [];
  return nodes
    .filter((n) => n?.subType === "image")
    .map((n) => n?.properties?.squarishURL ?? n?.properties?.portraitURL)
    .filter((u): u is string => typeof u === "string");
}

/** One thread → one record per colourway it carries (in practice exactly one). */
export function mapThread(thread: any, country: CountryCode = "TR"): ProductRecord[] {
  const SITE = (NIKE_MARKETS[country] ?? NIKE_MARKETS.TR!).site;
  const out: ProductRecord[] = [];
  for (const info of thread?.productInfo ?? []) {
    const m = info?.merchProduct;
    const pr = info?.merchPrice;
    const c = info?.productContent ?? {};
    const style = m?.styleColor;
    const price = Number(pr?.currentPrice);
    if (!style || !Number.isFinite(price) || price <= 0) continue;
    const full = Number(pr?.fullPrice ?? pr?.msrp);
    const sizes = sizesOf(info, country);
    const photos = photosOf(thread);
    const card = thread?.publishedContent?.properties?.productCard?.properties;
    const first = card?.squarishURL ?? photos[0] ?? info?.imageUrls?.productImageUrl ?? null;
    const name = String(c.fullTitle ?? [c.title, c.subtitle].filter(Boolean).join(" ") ?? m.labelName ?? "").trim();
    out.push({
      brand: "nike",
      ...(country === "TR" ? {} : { country }),
      externalId: String(style),
      name,
      url: c.slug ? `${SITE}/t/${c.slug}/${style}` : `${SITE}/t/-/${style}`,
      imageUrl: first,
      images: cleanGallery(photos, first),
      price: toMinor(price),
      listPrice: Number.isFinite(full) && full > price ? toMinor(full) : null,
      currency: pr?.currency ?? COUNTRIES[country].currency,
      inStock: sizes.length > 0 ? sizes.some((s) => s.availability !== "out_of_stock") : info?.availability?.available === true,
      // The subtitle is Nike's own product-type line ("Kadın Koşu Ayakkabısı"),
      // which is what the type classifier reads best.
      category: c.subtitle ?? m.productType ?? null,
      gender: genderOf(m.genders),
      variants: sizes.length || c.colorDescription
        ? { colors: c.colorDescription ? [String(c.colorDescription)] : [], sizes }
        : null,
      barcodes: (() => {
        const g = (info?.skus ?? []).map((s: any) => String(s?.gtin ?? "").replace(/^0+(?=\d{13}$)/, "")).filter((x: string) => /^\d{12,14}$/.test(x));
        return g.length ? [...new Set<string>(g)] : null;
      })(),
      // Colourways of one style share the style code (IO3384-012 / -001 …).
      groupKey: m.styleCode ? `nike:${m.styleCode}` : null,
      colorName: c.colorDescription ?? null,
    });
  }
  return out;
}

export const brand = "nike";

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (!NIKE_MARKETS[country]) return [];
  const byId = new Map<string, ProductRecord>();
  const filters = ["productInfo.merchPrice.discounted(true)", "productInfo.merchProduct.status(ACTIVE)"];
  for (let page = 0; page < MAX_PAGES; page++) {
    // The proxy is a FALLBACK for Turkey only (after a refused direct call);
    // other markets never touch it — owner rule 2026-10-11.
    const data = await getJson<any>(threadsUrl(filters, page * PAGE, PAGE, country), { proxy: country === "TR" }).catch(() => null);
    const objects: any[] = data?.objects ?? [];
    for (const t of objects) for (const r of mapThread(t, country)) byId.set(r.externalId, r);
    if (objects.length < PAGE || !data?.pages?.next) break;
  }
  return [...byId.values()];
}
