/**
 * Primor (primor.eu) — Spain's second perfumery chain, Magento (Hyvä) storefront.
 *
 * The storefront's search runs on Empathy.co (`x.empathy.co/x-primor/app.js`),
 * whose public query API (`api.empathy.co/search/v1/query/primor/search`)
 * answers plain JSON with no key and no wall — 200 from a GitHub runner
 * (probe run 39612079467, 2026-10-21). Magento's own GraphQL/REST on
 * www.primor.eu is switched off ("Desactivado Temporalmente").
 *
 * The instance has no browse endpoint and `*` matches nothing, so the catalogue
 * is read through a handful of broad Spanish terms (perfume, maquillaje,
 * facial, …) filtered to `facetAvailability:true`, deduplicated by variant.
 * 100 rows a page (the API allows 500), one page per term per round,
 * round-robin so every shelf is represented, until the
 * cap.
 *
 * Prices: a product with variants (volumes or shades) carries, per variant,
 * `salePrice` and `price` — the struck "PVR" (the supplier's recommended
 * retail price, which Primor prints crossed out and labels as such). A product
 * WITHOUT variants carries only `salePrice` and a rounded `discountPct`; its
 * PVR is not in the feed and is not guessed, so those rows are skipped. Rows
 * flagged `ocultarPvr` / `hideDiscountPrice` (the site hides the struck price)
 * are skipped too.
 *
 * One record per variant (each volume/shade has its own price and stock), all
 * of a product's variants grouped by `productId`. Volumes ("30 ml") are sizes,
 * anything else is a shade.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const API = "https://api.empathy.co/search/v1/query/primor/search";
/** Broad terms, in priority order; together they cover the beauty catalogue. */
export const PRIMOR_TERMS = ["perfume", "maquillaje", "facial", "cabello", "corporal", "estuche", "hombre"];
const ROWS = 100;
const MAX_REQUESTS = 40;
const CAP = 1500;
const PAUSE_MS = Number(process.env.PRIMOR_PAUSE_MS ?? 300);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const primorUrl = (term: string, start: number): string =>
  `${API}?query=${encodeURIComponent(term)}&lang=es&rows=${ROWS}&start=${start}&filter=facetAvailability:true`;

const clean = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
const AMOUNT = /^(recarga\s+)?\d[\d.,]*\s*(ml|l|cl|g|gr|kg|mg|ud\.?|uds\.?|unidades?)\b/i;

/** "Perfumes de Hombre" → erkek, "Perfumes de Mujer" → kadin, kids → cocuk, else unisex. Pure. */
export function primorGender(categories: unknown): ProductRecord["gender"] {
  const c = (Array.isArray(categories) ? categories : []).join(" | ").toLowerCase();
  if (/beb[eé]s|niñ[oa]s|infantil/.test(c)) return "cocuk";
  const w = /\bmujer\b/.test(c);
  const m = /\bhombre\b/.test(c);
  if (w && !m) return "kadin";
  if (m && !w) return "erkek";
  return null;
}

/** The most specific category: the longest name that is not a top-level shelf. Pure. */
export function primorCategory(categories: unknown): string | null {
  const list = (Array.isArray(categories) ? categories : []).map(clean).filter(Boolean);
  if (!list.length) return null;
  const generic = /^(perfumes|maquillaje|cosm[eé]tica|estuches|gratis shops|primor farma)$/i;
  const specific = list.filter((c) => !generic.test(c));
  return (specific.length ? specific : list).sort((a, b) => b.length - a.length)[0];
}

/** One Empathy product → one record per real struck-price variant. Pure. */
export function mapPrimor(p: any, country: CountryCode = "ES"): ProductRecord[] {
  if (!p?.productId || !Array.isArray(p.variants) || !p.variants.length) return [];
  if (p.ocultarPvr || p.hideDiscountPrice || p.ocultarDtoPvr) return [];
  const brand = clean(p.brand);
  const title = clean(p.title);
  if (!title) return [];
  const name = brand && !title.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${title}` : title;
  const category = primorCategory(p.categories);
  const gender = primorGender(p.categories);
  const out: ProductRecord[] = [];
  for (const v of p.variants) {
    const price = Number(v?.salePrice);
    const was = Number(v?.price);
    if (!v?.variantId || !Number.isFinite(price) || price <= 0) continue;
    if (!Number.isFinite(was) || was <= price) continue;
    const url = typeof v.link === "string" && v.link.startsWith("https://www.primor.eu/") ? v.link : null;
    if (!url) continue;
    const inStock = String(v.availability) === "true";
    const label = clean(v.variantValue);
    const isAmount = AMOUNT.test(label);
    const images = cleanGallery([v.imageLink || p.imageLink]);
    out.push({
      brand: "primor",
      country,
      externalId: String(v.variantId),
      name,
      url,
      imageUrl: images?.[0] ?? null,
      images,
      price: toMinor(price),
      listPrice: toMinor(was),
      currency: "EUR",
      inStock,
      category,
      maker: brand || null,
      gender,
      variants: label
        ? {
            colors: isAmount ? [] : [label],
            sizes: isAmount ? [{ label, availability: inStock ? "in_stock" : "out_of_stock" }] : [],
          }
        : null,
      groupKey: `primor-${p.productId}`,
      colorName: label || null,
    });
  }
  return out;
}

/** Register as `listPrimor(country)`. ES only (primor.eu/es_es). */
export async function listPrimor(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "ES") return [];
  const byId = new Map<string, ProductRecord>();
  const next = new Map<string, number>(PRIMOR_TERMS.map((t) => [t, 0]));
  let requests = 0;
  let inStock = 0;
  while (next.size && requests < MAX_REQUESTS && inStock < CAP) {
    for (const [term, start] of [...next]) {
      if (requests >= MAX_REQUESTS || inStock >= CAP) break;
      if (requests > 0) await sleep(PAUSE_MS);
      requests++;
      const d = await getJson<any>(primorUrl(term, start), {
        country,
        headers: { "Accept-Language": "es-ES,es;q=0.9", Origin: "https://www.primor.eu", Referer: "https://www.primor.eu/" },
      });
      const rows: any[] = d?.catalog?.content ?? [];
      const total = Number(d?.catalog?.numFound) || 0;
      for (const p of rows) {
        for (const r of mapPrimor(p, country)) {
          if (byId.has(r.externalId)) continue;
          byId.set(r.externalId, r);
          if (r.inStock) inStock++;
        }
      }
      if (!rows.length || start + ROWS >= total) next.delete(term);
      else next.set(term, start + ROWS);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
