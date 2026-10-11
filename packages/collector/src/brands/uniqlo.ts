/**
 * UNIQLO (United Kingdom + Australia) through the storefront's own commerce API,
 * `www.uniqlo.com/<region>/api/commerce/v5/en/products?flagCodes=discount`.
 *
 * Every uniqlo.com HTML page is behind Akamai (403 to a GitHub runner), but the
 * JSON API on the same host answers a plain GET as long as it carries the
 * `x-fr-clientid` header the web app sends (`uq.<region>.web-spa`; the UK one
 * is `uq.gb.web-spa`, NOT `uq.uk…`). Verified from a GitHub runner, no proxy:
 * probe run 38134835174 (2026-10-11).
 *
 * US and Canada answer the same route but are NOT collected: there a markdown
 * replaces the base price (`base` == `promo` on every "Sale" item, also per
 * colour/size in `/l2s`), so the API never states an original price and no
 * row could qualify as a deal. GB and AU send base + promo.
 *
 * One listing item is one product (all colours); `prices` is the product's
 * cheapest live price, `colors`/`sizes` are the colours and sizes that are
 * still in stock (sold-out ones drop out of the arrays — checked against
 * `/l2s` stock), so every listed size is `in_stock`. 100 per page, ~5 pages.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "uniqlo";

export const UNIQLO_MARKETS: Partial<Record<CountryCode, { region: string; clientId: string }>> = {
  GB: { region: "uk", clientId: "uq.gb.web-spa" },
  AU: { region: "au", clientId: "uq.au.web-spa" },
};

const PAGE_SIZE = 100; // the API's maximum
const MAX_PAGES = 20;
const PAUSE_MS = 800;
const CAP = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function listUrl(country: CountryCode, offset: number): string {
  const m = UNIQLO_MARKETS[country]!;
  return `https://www.uniqlo.com/${m.region}/api/commerce/v5/en/products?flagCodes=discount&limit=${PAGE_SIZE}&offset=${offset}&httpFailure=true`;
}

function genderOf(g: unknown): ProductRecord["gender"] {
  if (g === "WOMEN") return "kadin";
  if (g === "MEN") return "erkek";
  if (g === "KIDS" || g === "BABY") return "cocuk";
  return null; // UNISEX
}

/** Map one listing item. Pure; null unless it is genuinely reduced. */
export function mapUniqloItem(it: any, country: CountryCode): ProductRecord | null {
  const m = UNIQLO_MARKETS[country];
  if (!m || !it?.productId || !it?.name) return null;
  const base = Number(it.prices?.base?.value);
  const promo = Number(it.prices?.promo?.value ?? base);
  if (!(base > 0) || !(promo > 0) || promo >= base) return null;
  if (it.prices?.base?.currency?.code && it.prices.base.currency.code !== COUNTRIES[country].currency) return null;

  const group = String(it.priceGroup ?? "00");
  const colour = String(it.representativeColorDisplayCode ?? it.colors?.[0]?.displayCode ?? "");
  const main = it.images?.main ?? {};
  const first: string | null = main[colour]?.image ?? (Object.values(main)[0] as any)?.image ?? null;
  // Sub shots tagged with another colour are that colour's; untagged ones are product-wide.
  const subs: string[] = (it.images?.sub ?? [])
    .filter((s: any) => !s?.colorCode || s.colorCode === colour)
    .map((s: any) => s?.image);
  const sizes: SizeVariant[] = [...new Set<string>((it.sizes ?? []).map((s: any) => String(s?.name ?? "").trim()).filter(Boolean))]
    .map((label) => ({ label, availability: "in_stock" }));
  const colors: string[] = (it.colors ?? []).map((c: any) => String(c?.name ?? "").trim()).filter(Boolean);
  const repName = (it.colors ?? []).find((c: any) => c?.displayCode === colour)?.name ?? null;
  const tc = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    brand,
    country,
    externalId: `${it.productId}-${group}`,
    name: String(it.name).trim(),
    url: `https://www.uniqlo.com/${m.region}/en/products/${it.productId}/${group}${colour ? `?colorDisplayCode=${colour}` : ""}`,
    imageUrl: first,
    images: cleanGallery(subs, first),
    price: toMinor(promo),
    listPrice: toMinor(base),
    currency: COUNTRIES[country].currency,
    inStock: !it.storeStockOnly && (sizes.length > 0 || colors.length > 0),
    category: null,
    gender: genderOf(it.genderCategory),
    variants: sizes.length ? { colors: colors.map(tc), sizes } : null,
    groupKey: null,
    colorName: repName ? tc(String(repName)) : null,
  };
}

export async function listUniqlo(country: CountryCode): Promise<ProductRecord[]> {
  const m = UNIQLO_MARKETS[country];
  if (!m) return [];
  const byId = new Map<string, ProductRecord>();
  for (let p = 0; p < MAX_PAGES; p++) {
    if (p > 0) await sleep(PAUSE_MS);
    const data = await getJson<any>(listUrl(country, p * PAGE_SIZE), { country, headers: { "x-fr-clientid": m.clientId } });
    const items: any[] = data?.result?.items ?? [];
    for (const it of items) {
      const r = mapUniqloItem(it, country);
      if (r) byId.set(r.externalId, r);
    }
    const total = Number(data?.result?.pagination?.total ?? 0);
    if (items.length < PAGE_SIZE || (p + 1) * PAGE_SIZE >= total) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listUniqlo;
