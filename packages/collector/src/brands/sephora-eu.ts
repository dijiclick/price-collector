/**
 * Sephora France, Germany and Italy (2026-10-21) — the SFCC OCAPI shop API on
 * each storefront's own host, exactly the Swiss route (sephora-ch.ts):
 * `https://www.sephora.<cc>/s/Sephora_<CC>/dw/shop/v21_10/product_search`.
 *
 * The French/German/Italian PAGES are walled (Akamai/Cloudflare 403), but the
 * OCAPI path is not: a GitHub runner gets SFCC's own JSON fault back without a
 * client id (probe 39615272052, `MissingClientIdException`), and with the public
 * OCAPI client id Turkey and Switzerland already use (SEPHORA_CLIENT_ID, a CI
 * secret — never in this file or in probe logs) it answers the search.
 *
 * The site's "Rabatt"/discount facet (`c_discountRange`) is the sale filter
 * (FR 1,187 / DE 4,959 / IT 863 discounted masters, 2026-10-21). As in CH,
 * only the DEFAULT variant's `c_salesPrice` < `c_price` pair is a markdown; a
 * master whose discount sits on another size is skipped (the TR −%81 range
 * bug). `c_price` is the strike price the product page shows.
 *
 * Not listed: Spain (Sephora_ES, 9–17 discounted masters — too thin), Portugal
 * (served by Sephora_ES, 12), and the Nordics/Benelux/Ireland/Austria (no
 * Sephora site answers there: SiteNotFound or no host).
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { sephoraChSizes } from "./sephora-ch";

export interface SephoraEuMarket {
  site: string;
  siteId: string;
  locale: string;
}

export const SEPHORA_EU_MARKETS: Partial<Record<CountryCode, SephoraEuMarket>> = {
  FR: { site: "https://www.sephora.fr", siteId: "Sephora_FR", locale: "fr-FR" },
  DE: { site: "https://www.sephora.de", siteId: "Sephora_DE", locale: "de-DE" },
  IT: { site: "https://www.sephora.it", siteId: "Sephora_IT", locale: "it-IT" },
};

const PAGE = 200;
const MAX_PAGES = Number(process.env.SEPHORA_EU_MAX_PAGES ?? 12);
const PAUSE_MS = Number(process.env.SEPHORA_EU_PAUSE_MS ?? 800);
const CAP = 1500;
/** Every bucket of the site's discount facet (5 % steps). */
const DISCOUNT_BUCKETS = Array.from({ length: 19 }, (_, i) => String((i + 1) * 5)).join("|");
const NOT_A_PHOTO = /swatch|thumbnail|video|\.(mp4|webm|mov)(\?|$)/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tidy = (s: unknown) => (typeof s === "string" ? s.replace(/ /g, " ").replace(/\s+/g, " ").trim() : "");

export function sephoraEuSearchUrl(country: CountryCode, start: number, id = "<client_id>"): string {
  const m = SEPHORA_EU_MARKETS[country]!;
  const q = new URLSearchParams({
    refine_1: "cgid=root",
    refine_2: `c_discountRange=${DISCOUNT_BUCKETS}`,
    count: String(PAGE),
    start: String(start),
    expand: "prices,availability,images,variations",
    locale: m.locale,
    client_id: id,
  });
  return `${m.site}/s/${m.siteId}/dw/shop/v21_10/product_search?${q}`;
}

/** One OCAPI search hit → a record, or null unless the default variant is marked down. Pure. */
export function mapSephoraEu(h: any, country: CountryCode): ProductRecord | null {
  const m = SEPHORA_EU_MARKETS[country];
  if (!m) return null;
  const currency = COUNTRIES[country].currency;
  const id = typeof h?.product_id === "string" ? h.product_id : "";
  const sale = h?.c_salesPrice;
  const list = h?.c_price;
  if (!id || typeof sale !== "number" || typeof list !== "number") return null;
  if (!(sale > 0 && sale < list)) return null;
  if (h?.currency && h.currency !== currency) return null;
  const name = tidy(h.product_name);
  if (!name) return null;
  const img = typeof h.image?.link === "string" ? h.image.link : null;
  const groupImgs: string[] = (Array.isArray(h.c_image_groups) ? h.c_image_groups : [])
    .flatMap((g: any) => (Array.isArray(g?.images) ? g.images : []))
    .map((i: any) => i?.link)
    .filter((l: unknown): l is string => typeof l === "string" && !NOT_A_PHOTO.test(l));
  const web = typeof h.c_webEquivalent === "string" && h.c_webEquivalent.startsWith(m.site) ? h.c_webEquivalent : null;
  const sizes = sephoraChSizes(h.variation_attributes);
  const variant = tidy(h.c_default_variation_attribute_name) || null;
  return {
    brand: "sephora",
    country,
    externalId: id,
    name,
    url: web ?? `${m.site}/search?q=${encodeURIComponent(id)}`,
    imageUrl: img,
    images: cleanGallery(groupImgs, img),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency,
    inStock: h.orderable !== false,
    // Same convention as the TR and CH adapters: the brand rides in `category`.
    category: tidy(h.c_brand?.name) || null,
    gender: null,
    variants: sizes.length ? { colors: [], sizes } : null,
    colorName: variant,
  };
}

export async function listSephoraEu(country: CountryCode): Promise<ProductRecord[]> {
  const m = SEPHORA_EU_MARKETS[country];
  if (!m) return [];
  const id = process.env.SEPHORA_CLIENT_ID;
  if (!id) throw new Error(`sephora/${country}: SEPHORA_CLIENT_ID is not set`);
  const byId = new Map<string, ProductRecord>();
  for (let p = 0; p < MAX_PAGES && byId.size < CAP * 1.2; p++) {
    if (p > 0) await sleep(PAUSE_MS);
    const data = await getJson<any>(sephoraEuSearchUrl(country, p * PAGE, id), { country, headers: { "Accept-Language": m.locale } }).catch((e) => {
      // Never echo the request url: it carries the client id.
      if (p === 0) throw new Error(`sephora/${country}: OCAPI search refused (${e instanceof Error ? e.message.replace(id, "<client_id>") : e})`);
      return null;
    });
    const hits: any[] = data?.hits ?? [];
    for (const h of hits) {
      const r = mapSephoraEu(h, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (!data || hits.length < PAGE || (p + 1) * PAGE >= Number(data.total ?? 0)) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
