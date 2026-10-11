/**
 * Victoria's Secret United States + Canada (victoriassecret.com/us, /ca).
 * Turkey stays in victoriassecret.ts and the Gulf in victoriassecret-intl.ts.
 *
 * The storefront's product grid comes from its own JSON API,
 * `api.victoriassecret.com/stacks/v46/` (the `collectionStacks` endpoint in the
 * web bundle's API table), for the "Sale & Clearance" collection. `activeCountry`
 * picks the market and its currency (CAD for CA). One request returns the
 * whole sale — ~670 products, ~2,700 colours, 3 MB raw / ~0.2 MB gzipped.
 *
 * WALL: the whole victoriassecret.com Cloudflare zone, this API included,
 * answers 403 to GitHub runners (probe runs 38134835174, 38135151788 — browser,
 * okhttp and app-style User-Agents alike). It answers residential lines, so
 * this adapter sets `proxy: true`: http.ts tries direct first and uses the
 * residential exit only after the refusal. Measured 0.22 MB (US) + 0.20 MB (CA)
 * on the wire per run, one request per market.
 *
 * Product photos are on www.victoriassecret.com/p/… — same zone, so the runner
 * cannot fetch them either, but phones (residential) can.
 *
 * A listing item is one style; each of its `swatches` is one colour with its
 * own original/sale price. A colour can appear under several styles (bundles,
 * "shop the look"), so rows are keyed by generic id + choice id. The listing
 * carries no sizes; per-size stock needs one product-page call per style
 * (`products/v37/page/<id>`), which the request budget does not allow.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "victoriassecret";

const API = "https://api.victoriassecret.com/stacks/v46/";
/** The "Sale & Clearance" collection (victoriassecret.com/<cc>/vs/sale). Same id for US and CA. */
export const SALE_COLLECTION = "08b8367b-635e-4667-ad96-87aea7294c7c";
const SITE = "https://www.victoriassecret.com";
const IMG = `${SITE}/p/760x1013/`;
const CAP = 1500;

export const VS_NA_MARKETS: Partial<Record<CountryCode, { active: string; path: string }>> = {
  US: { active: "US", path: "/us/" },
  CA: { active: "CA", path: "/ca/" },
};

export function stacksUrl(country: CountryCode): string {
  const m = VS_NA_MARKETS[country]!;
  const p = new URLSearchParams({
    brand: "vs",
    collectionId: SALE_COLLECTION,
    orderBy: "REC",
    maxSwatches: "8",
    isPersonalized: "false",
    limit: "1000",
    offset: "0",
    activeCountry: m.active,
  });
  return `${API}?${p}`;
}

const CATEGORY: Record<string, string> = {
  "bras-catalog": "Bras",
  "panties-catalog": "Panties",
  "sleepwear-and-lingerie-catalog": "Sleepwear & Lingerie",
  "apparel-catalog": "Apparel",
  "beauty-catalog": "Beauty",
  "swimwear-catalog": "Swimwear",
  "accessories-catalog": "Accessories",
};

/** `/us/vs/bras-catalog/5000000002?…&genericId=…&choice=…` → a clean product url for the market. */
function productUrl(country: CountryCode, raw: string, genericId: string, choice: string): string | null {
  const path = String(raw ?? "").split("?")[0];
  const m = path.match(/^\/[a-z]{2}\/([a-z]+)\/([a-z0-9-]+)\/(\d+)$/);
  if (!m) return null;
  return `${SITE}${VS_NA_MARKETS[country]!.path}${m[1]}/${m[2]}/${m[3]}?genericId=${genericId}&choice=${choice}`;
}

/** Map one swatch (one colour) of a listing item. Pure; null unless genuinely reduced. */
export function mapVsSwatch(item: any, sw: any, country: CountryCode): ProductRecord | null {
  if (!VS_NA_MARKETS[country] || !sw?.genericID || !sw?.choiceID) return null;
  const pr = sw.price ?? {};
  const original = Number(pr.original);
  const sale = Number(pr.sale);
  if (!(original > 0) || !(sale > 0) || sale >= original) return null;
  if (pr.currency && pr.currency !== COUNTRIES[country].currency) return null;
  const url = productUrl(country, sw.url ?? item?.url, String(sw.genericID), String(sw.choiceID));
  if (!url) return null;
  const photos: string[] = (sw.productImage ?? [])
    .filter((p: unknown) => typeof p === "string" && p)
    .map((p: string) => `${IMG}${p}.jpg`);
  const seg = String(sw.url ?? item?.url ?? "").split("?")[0].split("/")[3] ?? "";
  const colour = typeof sw.choiceLabel === "string" && sw.choiceLabel.trim() ? sw.choiceLabel.trim() : null;
  return {
    brand,
    country,
    externalId: `${sw.genericID}-${sw.choiceID}`,
    name: String(sw.name ?? item?.name ?? "").trim(),
    url,
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price: toMinor(sale),
    listPrice: toMinor(original),
    currency: COUNTRIES[country].currency,
    // The sale grid lists purchasable colours only ("Low Stock" is a badge, not sold out).
    inStock: true,
    category: CATEGORY[seg] ?? null,
    gender: "kadin",
    variants: null,
    groupKey: `victoriassecret-${sw.genericID}`,
    colorName: colour,
  };
}

export function mapVsStacks(data: any, country: CountryCode): ProductRecord[] {
  const byId = new Map<string, ProductRecord>();
  for (const stack of data?.stacks ?? []) {
    for (const item of stack?.list ?? []) {
      for (const sw of item?.swatches ?? []) {
        const r = mapVsSwatch(item, sw, country);
        if (r && !byId.has(r.externalId) && r.name) byId.set(r.externalId, r);
      }
    }
  }
  return [...byId.values()];
}

export async function listVictoriasSecretNA(country: CountryCode): Promise<ProductRecord[]> {
  if (!VS_NA_MARKETS[country]) return [];
  const data = await getJson<any>(stacksUrl(country), { country, proxy: true, retries: 2 });
  return mapVsStacks(data, country).slice(0, CAP);
}

export const listProducts = listVictoriasSecretNA;
