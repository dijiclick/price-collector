/**
 * Blivakker (Norway) — the /salg page's product list, read through the
 * endpoint its own "load more" button calls:
 *   GET /ContentManagement/ProductList/ProductListGetMore/{componentId}?skip=&take=&sort=
 * which answers JSON whose `productsView` is the card markup (max 200 per call).
 *
 * Why the GitHub probe saw `{"success":false,"message":"Not Found"}` on the
 * home page: this site switches to its JSON error body when the request says
 * `Accept: application/json`. A normal (HTML) request gets the storefront.
 *
 * The component id belongs to the CMS page version and changes when the page
 * is re-published, so every run reads it from /salg first (1 request) instead
 * of hardcoding it. `sort=6` is "Høyest rabatt". No proxy, no cookie.
 *
 * Kept: cards with a strikethrough ("Før: N kr") — the price everyone pays.
 * Dropped: member-only prices ("Medlemspris … Ikke-medlem N kr"), which are
 * not a discount for a non-member. Cards have no size/shade stock, so
 * `variants` stays null; cosmetics, so gender is null.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson, getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const SITE = "https://www.blivakker.no";
const TAKE = 200;
const CAP = 1500;
const MAX_PAGES = 12;
const PAUSE_MS = Number(process.env.BLIVAKKER_PAUSE_MS ?? 700);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** "1 299,50 kr" → 1299.5 */
export function parseKr(s: string | undefined | null): number {
  if (!s) return NaN;
  const t = decode(s).replace(/[^\d,.\s]/g, "").replace(/\s+/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  return parseFloat(t);
}

/** The product-list component on /salg: the id on the container that holds the product grid. */
export function componentIdFrom(html: string): string | null {
  const at = html.search(/js-product-list-products|js-number-of-products-text|js-get-more-products/);
  if (at < 0) return null;
  const before = html.slice(0, at);
  const all = [...before.matchAll(/data-page-version-component-id="(\d+)"/g)];
  return all.length ? all[all.length - 1][1] : null;
}

/** Split a productsView into its product cards. */
export function cardsOf(view: string): string[] {
  return view.split(/(?=<div class="product-card[^"]*js-product-card)/).filter((c) => c.includes("data-product-id"));
}

/** Map one product card. Pure. */
export function mapBlivakkerCard(card: string, country: CountryCode = "NO"): ProductRecord | null {
  const id = card.match(/data-product-id="(\d+)"/)?.[1];
  // The image link gained a class attribute in October 2026 (`<a class="…" href=…>`),
  // so match the href on any <a>, wherever it sits among the attributes.
  const href = card.match(/<a\b[^>]*\bhref="(\/product\/[^"]+)"/)?.[1];
  if (!id || !href) return null;
  const brand = decode(card.match(/<span class="heading[^"]*">([^<]*)<\/span>/)?.[1] ?? "");
  const pname = decode(card.match(/<span class="product-name[^"]*">([^<]*)<\/span>/)?.[1] ?? "");
  if (!pname) return null;
  const final = card.match(/<strong class="price-text price-final">([^<]+)<\/strong>/)?.[1];
  const before = card.match(/<span class="price-discount">([^<]+)<\/span>/)?.[1];
  const price = parseKr(final);
  const list = parseKr(before);
  if (!Number.isFinite(price) || price <= 0) return null;
  const img = card.match(/<img src="(https?:\/\/[^"]+)"/)?.[1] ?? null;
  const stock = card.match(/data-is-product-in-stock="(\w+)"/)?.[1];
  return {
    brand: "blivakker",
    country,
    externalId: id,
    name: brand && !pname.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${pname}` : pname,
    url: `${SITE}${decode(href)}`,
    imageUrl: img,
    images: cleanGallery([img]),
    price: toMinor(price),
    listPrice: Number.isFinite(list) && list > price ? toMinor(list) : null,
    currency: COUNTRIES[country].currency,
    inStock: stock !== "false" && !/>\s*Utsolgt\s*</.test(card),
    category: null,
    gender: null,
    variants: null,
  };
}

export async function listBlivakker(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "NO") return [];
  const html = await getText(`${SITE}/salg`, { country, headers: { Accept: "text/html" } });
  const cid = componentIdFrom(html);
  if (!cid) throw new Error("blivakker/NO: product list component not found on /salg");
  const byId = new Map<string, ProductRecord>();
  for (let page = 0; page < MAX_PAGES; page++) {
    await sleep(PAUSE_MS);
    const d = await getJson<any>(
      `${SITE}/ContentManagement/ProductList/ProductListGetMore/${cid}?skip=${page * TAKE}&take=${TAKE}&sort=6`,
      { country, headers: { "X-Requested-With": "XMLHttpRequest" } },
    );
    const cards = cardsOf(String(d?.productsView ?? ""));
    if (!cards.length) break;
    let reduced = 0;
    for (const c of cards) {
      const r = mapBlivakkerCard(c, country);
      if (r && r.listPrice != null) {
        reduced++;
        if (!byId.has(r.externalId)) byId.set(r.externalId, r);
      }
    }
    if (d?.hasMoreProducts === false || reduced === 0 || byId.size >= CAP * 1.2) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
