/**
 * Sephora Switzerland (www.sephora.ch), added 2026-10-11. Turkey (sephora.ts,
 * OCAPI on sephora.com.tr) and US/CA (sephora-intl.ts) are untouched.
 *
 * sephora.ch's pages sit behind a bot wall (403 to datacenter IPs), but the
 * SFCC OCAPI shop API on the same host is not walled: a GitHub runner gets
 * SFCC's own JSON back. The Swiss storefront is not a site of its own — it is
 * the `Sephora_DE` site served in the `de_CH` / `fr_CH` locales (the page
 * template reads "Sites-Sephora_DE-Site"), and `locale=de-CH` switches the
 * search to the CHF price book. The client id is the same public OCAPI id the
 * Turkish adapter uses (SEPHORA_CLIENT_ID, a CI secret).
 *
 * The site's own "Rabatt" facet (`c_discountRange`) is the sale filter:
 * ~3,400 discounted masters, 200 per page. Price semantics (verified against
 * the live CH product page, 2026-10-11): `c_salesPrice` / `c_price` are the
 * DEFAULT variant's selling and reference ("Niedrigster Preis") prices, while
 * `price`/`price_max` span every size/shade. Only the default variant's pair
 * is a real markdown; a master whose discount sits on another size reports no
 * `c_salesPrice` and is skipped rather than guessed (the TR −%81 range bug).
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const BASE = "https://www.sephora.ch/s/Sephora_DE/dw/shop/v21_10";
const SITE = "https://www.sephora.ch";
const PAGE = 200;
const MAX_PAGES = Number(process.env.SEPHORA_CH_MAX_PAGES ?? 12);
const PAUSE_MS = Number(process.env.SEPHORA_CH_PAUSE_MS ?? 800);
const CAP = 1500;
/** Every bucket of the site's "Rabatt" facet (5 % steps). */
const DISCOUNT_BUCKETS = Array.from({ length: 19 }, (_, i) => String((i + 1) * 5)).join("|");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clientId = () => {
  const id = process.env.SEPHORA_CLIENT_ID;
  if (!id) throw new Error("SEPHORA_CLIENT_ID is not set — the Sephora CH adapter cannot build a request without it.");
  return id;
};

export function searchUrl(start: number, id = "<client_id>"): string {
  const q = new URLSearchParams({
    refine_1: "cgid=root",
    refine_2: `c_discountRange=${DISCOUNT_BUCKETS}`,
    count: String(PAGE),
    start: String(start),
    expand: "prices,availability,images,variations",
    locale: "de-CH",
    client_id: id,
  });
  return `${BASE}/product_search?${q}`;
}

const tidy = (s: unknown) => (typeof s === "string" ? s.replace(/ /g, " ").replace(/\s+/g, " ").trim() : "");
const NOT_A_PHOTO = /swatch|thumbnail|video|\.(mp4|webm|mov)(\?|$)/i;

/** Shade/size list of the master, with the per-value `orderable` flag. */
export function sephoraChSizes(attrs: unknown): SizeVariant[] {
  const first = Array.isArray(attrs) ? attrs[0] : null;
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const v of Array.isArray(first?.values) ? first.values : []) {
    const label = tidy(v?.name);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, availability: v?.orderable === false ? "out_of_stock" : "in_stock" });
  }
  return out;
}

/** One OCAPI search hit → a record, or null unless the default variant is marked down. Pure. */
export function mapSephoraCh(h: any, country: CountryCode = "CH"): ProductRecord | null {
  const id = typeof h?.product_id === "string" ? h.product_id : "";
  const sale = h?.c_salesPrice;
  const list = h?.c_price;
  if (!id || typeof sale !== "number" || typeof list !== "number") return null;
  if (!(sale > 0 && sale < list)) return null;
  if (h?.currency && h.currency !== "CHF") return null;
  const name = tidy(h.product_name);
  if (!name) return null;
  const img = typeof h.image?.link === "string" ? h.image.link : null;
  const groupImgs: string[] = (Array.isArray(h.c_image_groups) ? h.c_image_groups : [])
    .flatMap((g: any) => (Array.isArray(g?.images) ? g.images : []))
    .map((i: any) => i?.link)
    .filter((l: unknown): l is string => typeof l === "string" && !NOT_A_PHOTO.test(l));
  const web = typeof h.c_webEquivalent === "string" && h.c_webEquivalent.startsWith(SITE) ? h.c_webEquivalent : null;
  const sizes = sephoraChSizes(h.variation_attributes);
  const variant = tidy(h.c_default_variation_attribute_name) || null;
  return {
    brand: "sephora",
    country,
    externalId: id,
    name,
    url: web ?? `${SITE}/search?q=${encodeURIComponent(id)}`,
    imageUrl: img,
    images: cleanGallery(groupImgs, img),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency: "CHF",
    inStock: h.orderable !== false,
    // Same convention as the TR adapter: the brand rides in `category`.
    category: tidy(h.c_brand?.name) || null,
    gender: null,
    variants: sizes.length ? { colors: [], sizes } : null,
    colorName: variant,
  };
}

export async function listSephoraCh(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "CH") return [];
  const id = clientId();
  const byId = new Map<string, ProductRecord>();
  for (let p = 0; p < MAX_PAGES && byId.size < CAP * 1.2; p++) {
    if (p > 0) await sleep(PAUSE_MS);
    const data = await getJson<any>(searchUrl(p * PAGE, id), { country, headers: { "Accept-Language": "de-CH" } }).catch(
      (e) => {
        if (p === 0) throw new Error(`sephora/CH: OCAPI search refused (${e instanceof Error ? e.message : e})`);
        return null;
      },
    );
    const hits: any[] = data?.hits ?? [];
    for (const h of hits) {
      const r = mapSephoraCh(h, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (!data || hits.length < PAGE || (p + 1) * PAGE >= Number(data.total ?? 0)) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const brand = "sephora";
export const listProducts = listSephoraCh;
