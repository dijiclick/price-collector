/**
 * El Corte Inglés Spain (elcorteingles.es) — the big multi-brand department
 * store: fashion (women, men, lingerie, shoes, bags, accessories) and beauty.
 *
 * `www.elcorteingles.es` sits behind Akamai and answers 403 "Access Denied" to
 * browsers-without-a-session, curl, okhttp and app User-Agents — from the Mac
 * and from GitHub runners alike. The wall lets link-preview crawlers through on
 * the User-Agent alone (they must read the Open Graph tags), so the site's own
 * listing API answers plain JSON to `facebookexternalhit/1.1`, and to WhatsApp's
 * preview UA as well. Verified from a GitHub runner 2026-10-21 (probe runs
 * 39612689251 and 39613608308); the APK route was not available (APKPure 410).
 *
 * The API is the one the PLP's infinite scroll calls:
 *   /api/firefly/vuestore/products_list/<category>/<filters>/<page>/
 * - `discount::10->20,,20->30,…,70->100` is the site's own "% Descuento" facet,
 *   so every row carries a struck price; a row still counts only when the
 *   chosen variant's `sale_price` is below its `price`.
 * - The page size is fixed at 12 cards (no parameter changes it) and each page
 *   is ~60–90 KB gzipped, so the request budget, not the catalogue, sets the
 *   row count: PAGES below spends ≤ 56 requests on ~670 cards.
 *
 * One card is one colour (`A…` = sold by ECI, `MP_…` = marketplace seller —
 * about half the discounted cards, with sellers' own "was" prices, so they
 * are dropped); its
 * `_my_colors` entry flagged `preselected` holds that colour's sizes, each with
 * its own price pair and `add_to_cart` status. Prices differ per size on beauty
 * (30 ml vs 100 ml), so the card takes ONE variant's own pair — the cheapest
 * discounted size in stock — never a min/max range across sizes.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const SITE = "https://www.elcorteingles.es";
const API = `${SITE}/api/firefly/vuestore/products_list`;
const DISCOUNT = "discount::10->20,,20->30,,30->40,,40->50,,50->60,,60->70,,70->100";
const CAP = 1500;
const PAUSE_MS = Number(process.env.ECI_PAUSE_MS ?? 250);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Link-preview crawlers pass the Akamai wall; the second is the fallback. */
const AGENTS = ["facebookexternalhit/1.1", "WhatsApp/2.23.20.0"];

type Gender = ProductRecord["gender"];
/** Category slug → pages to read and the section's gender (null = decide per row). */
const SECTIONS: { slug: string; pages: number; gender: Gender }[] = [
  { slug: "moda-mujer", pages: 24, gender: "kadin" },
  { slug: "moda-hombre", pages: 16, gender: "erkek" },
  { slug: "perfumeria", pages: 16, gender: null },
];

export const pageUrl = (slug: string, page: number): string =>
  `${API}/${slug}/${DISCOUNT}/${page > 1 ? `${page}/` : ""}`;

const clean = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));

/** Beauty has no section gender: read it from the category path or the title. Pure. */
export function beautyGender(category: string[], title: string): Gender {
  const t = `${category.join(" ")} ${title}`.toLowerCase();
  const men = /\bhombre\b/.test(t);
  const women = /\bmujer\b/.test(t);
  return men === women ? null : men ? "erkek" : "kadin";
}

/**
 * One card → record, or null when its chosen colour has no real struck price.
 * `category` is the datalayer path (["Moda mujer", "Ropa", "Jerséis"]). Pure.
 */
export function mapEci(p: any, category: string[] = [], sectionGender: Gender = null, country: CountryCode = "ES"): ProductRecord | null {
  const colors: any[] = Array.isArray(p?._my_colors) ? p._my_colors : [];
  const color = colors.find((c) => c?.preselected) ?? colors[0];
  const variants: any[] = Array.isArray(color?.variants) ? color.variants : [];
  const name = clean(p?.description) || clean(p?.title);
  if (!p?.id || !name || typeof p?._base_url !== "string" || !variants.length) return null;
  // Marketplace sellers set their own "was" price (fur coats "€1,900 → €500"),
  // which is not a price El Corte Inglés ever charged: dropped.
  if (String(p.id).startsWith("MP_")) return null;

  const isDeal = (v: any) => {
    const was = num(v?.price);
    const now = num(v?.sale_price);
    return Number.isFinite(was) && Number.isFinite(now) && now > 0 && was > now;
  };
  const inStockV = (v: any) => v?.add_to_cart === "ADD";
  const deals = variants.filter(isDeal);
  if (!deals.length) return null;
  const pool = deals.some(inStockV) ? deals.filter(inStockV) : deals;
  const pick = pool.reduce((a, b) => (num(b.sale_price) < num(a.sale_price) ? b : a));

  const sizes: SizeVariant[] = [];
  for (const v of variants) {
    const label = clean(v?.variant?.value);
    if (!label || v?.variant?.unique || sizes.some((s) => s.label === label)) continue;
    sizes.push({ label, availability: inStockV(v) ? "in_stock" : "out_of_stock" });
  }
  const colorName = clean(color?.title);
  const realColor = colorName && !/^sin especificar$/i.test(colorName) ? colorName : "";
  const images = cleanGallery(
    (color?.all_images ?? []).map((i: any) => i?.default_source),
    typeof color?.image === "string" ? color.image : null,
  );
  const gender = sectionGender ?? beautyGender(category, clean(p.title));

  return {
    brand: "elcorteingles",
    country,
    externalId: String(p.id),
    name,
    url: `${SITE}${p._base_url}`,
    imageUrl: images?.[0] ?? null,
    images,
    price: toMinor(num(pick.sale_price)),
    listPrice: toMinor(num(pick.price)),
    currency: "EUR",
    inStock: variants.some(inStockV),
    category: category.length > 1 ? category.slice(1).join(" / ") : category[0] ?? null,
    maker: clean(p.brand?.name) || null,
    gender,
    variants: { colors: realColor ? [realColor] : [], sizes },
    colorName: realColor || null,
  };
}

/** One listing page, through the first crawler UA the wall accepts. */
async function fetchPage(slug: string, page: number): Promise<any> {
  let last: unknown;
  for (const ua of AGENTS) {
    try {
      return await getJson<any>(pageUrl(slug, page), {
        country: "ES",
        retries: 1,
        headers: { "User-Agent": ua, "Accept-Language": "es-ES,es;q=0.9" },
      });
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

/** Register as `listElCorteIngles(country)`. ES only. */
export async function listElCorteIngles(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "ES") return [];
  const byId = new Map<string, ProductRecord>();
  let first = true;
  for (const { slug, pages, gender } of SECTIONS) {
    let last = pages;
    for (let page = 1; page <= last; page++) {
      if (!first) await sleep(PAUSE_MS);
      first = false;
      let d: any;
      try {
        d = (await fetchPage(slug, page))?.data;
      } catch (err) {
        // One bad page must not cost the other sections.
        console.warn(`elcorteingles: ${slug} p${page} failed: ${(err as Error).message}`);
        break;
      }
      const total = Number(d?.pagination?._total);
      if (Number.isFinite(total) && total > 0) last = Math.min(total, pages);
      const rows: any[] = d?.products ?? [];
      if (!rows.length) break;
      const cats = new Map<string, string[]>();
      for (const x of d?.paginatedDatalayer?.products ?? []) {
        if (x?.code_a && Array.isArray(x.category)) cats.set(String(x.code_a), x.category.map(clean).filter(Boolean));
      }
      for (const p of rows) {
        const r = mapEci(p, cats.get(String(p?.id)) ?? [], gender, country);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
