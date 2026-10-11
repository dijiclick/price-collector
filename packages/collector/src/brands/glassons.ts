/**
 * Glassons (glassons.com) — NZ/AU young-women's label, Australia + US.
 *
 * The site's Varnish edge answers 406 to anything that LOOKS like a browser
 * but isn't one (a Chrome User-Agent without the rest of a browser's
 * fingerprint), and lets plain HTTP clients through. The category grid is
 * filled from the storefront's own JSON route, `/api/collection/<locale>`
 * (`cid=446` = SALE in every locale; the locale path picks currency and
 * assortment). Verified from a GitHub runner, probe run 38134258794, no proxy.
 *
 * The page size is fixed at 24 server-side, so a full sale (AU ~880, US ~870
 * colourways) is ~37 requests of ~260 KB. Every variant carries both prices
 * (`unitprice` now, `baseunitprice` was) and a stock status ("" in stock,
 * "limitedstock", "disabled" = sold out), which gives per-size restock data.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "glassons";

const SITE = "https://www.glassons.com";
/** Not a browser UA on purpose: a fake Chrome UA is exactly what the edge rejects. */
const UA = "ModaDropCollector/1.0 (+https://modadrop.vercel.app)";
const SALE_CID = 446;
const PER_PAGE = 24;
const MAX_PAGES = 55;
const PAUSE_MS = 600;
const CAP = 1500;

export const GLASSONS_MARKETS: Partial<Record<CountryCode, string>> = { AU: "au", US: "us" };

export function pageUrl(locale: string, page: number): string {
  return `${SITE}/api/collection/${locale}?p=${page}&cid=${SALE_CID}&s%5Brelevance%5D=desc`;
}

/** `/p/x` → `/au/p/x` (sets the AU locale); the US API already returns `/us/p/x`. */
export function productUrl(locale: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return p.startsWith(`/${locale}/`) ? `${SITE}${p}` : `${SITE}/${locale}${p}`;
}

const num = (v: unknown): number => (typeof v === "number" ? v : parseFloat(String(v ?? "")));

function availabilityOf(status: unknown): SizeVariant["availability"] {
  const s = String(status ?? "").toLowerCase();
  if (s === "disabled" || s === "soldout" || s === "outofstock") return "out_of_stock";
  if (s === "limitedstock") return "low_on_stock";
  return "in_stock";
}

/** Map one collection item (one style in one colour). Pure; null unless reduced. */
export function mapGlassons(item: any, country: CountryCode): ProductRecord | null {
  const locale = GLASSONS_MARKETS[country];
  const sc = item?.stylecolour;
  const vs: any[] = sc?.variants ?? [];
  if (!locale || !sc?.stylecolourid || !item?.description || !sc?.url || !vs.length) return null;
  const currency = COUNTRIES[country].currency;
  const priced = vs
    .map((v) => ({ v, price: num(v?.unitprice), was: num(v?.baseunitprice), avail: availabilityOf(v?.status) }))
    .filter((x) => String(x.v?.currency ?? currency) === currency && Number.isFinite(x.price) && x.price > 0);
  if (!priced.length) return null;
  const pick = [...priced].sort(
    (a, b) => Number(a.avail === "out_of_stock") - Number(b.avail === "out_of_stock") || a.price - b.price,
  )[0];
  if (!(Number.isFinite(pick.was) && pick.was > pick.price) || pick.v?.hidewasprice === true) return null;

  const sizes: SizeVariant[] = [...priced]
    .sort((a, b) => num(a.v?.sizesequence) - num(b.v?.sizesequence))
    .map((x) => ({ label: String(x.v?.sizeraw || x.v?.size || "").trim(), availability: x.avail }))
    .filter((s) => s.label && !/^one ?size$/i.test(s.label));
  const photos: string[] = [sc?.primaryimage, ...(sc?.images ?? [])]
    .map((i: any) => i?.src)
    .filter((u: unknown): u is string => typeof u === "string");
  const colour = String(sc.colour ?? "").trim();
  const title = String(item.description).trim();

  return {
    brand,
    country,
    externalId: String(sc.stylecolourid),
    name: title,
    url: productUrl(locale, String(sc.url)),
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price: toMinor(pick.price),
    listPrice: toMinor(pick.was),
    currency,
    inStock: priced.some((x) => x.avail !== "out_of_stock"),
    category: String(item.category ?? item.department ?? "").trim() || null,
    gender: "kadin",
    variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: item.style ? String(item.style) : null,
    colorName: colour || null,
  };
}

export async function listGlassons(country: CountryCode): Promise<ProductRecord[]> {
  const locale = GLASSONS_MARKETS[country];
  if (!locale) return [];
  const byId = new Map<string, ProductRecord>();
  let pages = 1;
  for (let n = 1; n <= Math.min(pages, MAX_PAGES); n++) {
    if (n > 1) await new Promise((r) => setTimeout(r, PAUSE_MS));
    const d = await getJson<any>(pageUrl(locale, n), { headers: { "User-Agent": UA }, country });
    if (!Array.isArray(d?.items)) throw new Error(`glassons/${country}: malformed page ${n}`);
    const total = Number(d?.pagination?.totalItems ?? 0);
    const per = Number(d?.pagination?.itemsPerPage ?? PER_PAGE) || PER_PAGE;
    pages = Math.ceil(total / per);
    for (const it of d.items) {
      const r = mapGlassons(it, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (!d.items.length) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listGlassons;
