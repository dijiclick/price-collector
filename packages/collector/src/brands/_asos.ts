/**
 * Shared mapping for ASOS-platform listings (asos.com's product-search API and
 * Topshop's "ASOS Chameleon" PLP `plpData`, which is the same object shape):
 *
 *   { id, name, price: { current, previous, rrp, currency }, colour, groupId,
 *     url: "<brand>/<slug>/prd/<id>#colourWayId-…", imageUrl, additionalImageUrls }
 *
 * Image and video urls come with or without the scheme depending on the host.
 * The listing carries no stock or sizes.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export interface AsosMapOpts {
  brand: string;
  country: CountryCode;
  gender: ProductRecord["gender"];
  /** Builds the PDP link from the listing's relative `url` and product id. */
  pdp: (url: string, id: string) => string;
}

export const asosImage = (u: unknown): string | null => {
  if (typeof u !== "string" || !u) return null;
  const abs = /^https?:\/\//.test(u) ? u : `https://${u.replace(/^\/+/, "")}`;
  return `${abs}?$n_640w$&wid=640&fit=constrain`;
};

/** Map one listing product. Pure; null unless it is marked down in the market's currency. */
export function mapAsosProduct(p: any, o: AsosMapOpts): ProductRecord | null {
  const price = Number(p?.price?.current?.value);
  const was = Number(p?.price?.previous?.value ?? p?.price?.rrp?.value);
  if (!p?.id || !p?.name || !(price > 0) || !(was > price)) return null;
  const currency = COUNTRIES[o.country].currency;
  if (p?.price?.currency && p.price.currency !== currency) return null;
  const first = asosImage(p.imageUrl);
  const gallery = [first, ...(Array.isArray(p.additionalImageUrls) ? p.additionalImageUrls : []).map(asosImage)];
  return {
    brand: o.brand,
    country: o.country,
    externalId: String(p.id),
    name: String(p.name).trim(),
    url: o.pdp(String(p.url ?? "").split("#")[0], String(p.id)),
    imageUrl: first,
    images: cleanGallery(gallery, first),
    price: toMinor(price),
    listPrice: toMinor(was),
    currency,
    inStock: true,
    category: null,
    gender: o.gender,
    variants: null,
    groupKey: p.groupId ? `${o.brand}:${p.groupId}` : null,
    colorName: typeof p.colour === "string" && p.colour.trim() ? p.colour.trim() : null,
  };
}
