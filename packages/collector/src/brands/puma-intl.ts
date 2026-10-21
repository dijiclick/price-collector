/**
 * PUMA outside Turkey (US, CA, GB, CH) through the storefront's own GraphQL.
 *
 * tr.puma.com is a local distributor's Magento shop (brands/puma.ts); every
 * other market here runs PUMA's global headless storefront ("nitro", Next.js +
 * Salesforce Commerce Cloud underneath), whose browser app posts to
 * `<host>/api/graphql`. The route needs a guest SLAS token, which the same
 * endpoint hands out to anyone (`mutation guestLogon`) — the app does exactly
 * this on first load. Verified from a GitHub runner, no proxy: guestLogon 200
 * on all four hosts (probe 38228090434) and the sale listing 200 with real
 * products (probe 38228165201: US 4,383 / CA 1,904 / GB 1,142 / CH 3,681).
 *
 * - The MARKET is the host plus the `locale` header (eu.puma.com serves the
 *   European shops; `en-CH` picks Switzerland in English, CHF).
 * - LISTING: `categoryByUrl(url: "/sale")`, 100 colourways a page (200 trips a
 *   null-variant error server-side). `price` is the strikethrough, `salePrice`
 *   the selling price; `promotionPrice` (cart promos) is ignored.
 * - SIZES: `product(id)` → `variations[].sizeGroups[].sizes[].orderable`, per
 *   colour. The API allows at most ~10 root fields per query, so ten styles are
 *   aliased into one request, for a rotating random subset each run (the upsert
 *   keeps variants an earlier run found, so coverage accumulates).
 *
 * Australia (au.puma.com) is a separate SFCC SiteGenesis shop without this API
 * and is not covered here.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "puma";

const PAGE_SIZE = 100;
const MAX_PAGES = Number(process.env.PUMA_INTL_MAX_PAGES ?? 16); // 1,600 colourways
const DETAIL_BATCH = 10; // root-field limit is between 10 and 20
const DETAIL_REQUESTS = Number(process.env.PUMA_INTL_DETAIL_REQUESTS ?? 25); // 250 styles a run
const CAP = 1500;

export const PUMA_MARKETS: Partial<Record<CountryCode, { host: string; locale: string; site: string }>> = {
  US: { host: "us.puma.com", locale: "en-US", site: "https://us.puma.com/us/en" },
  CA: { host: "ca.puma.com", locale: "en-CA", site: "https://ca.puma.com/ca/en" },
  GB: { host: "uk.puma.com", locale: "en-GB", site: "https://uk.puma.com/uk/en" },
  CH: { host: "eu.puma.com", locale: "en-CH", site: "https://eu.puma.com/ch/en" },
  // EU, 2026-10-21: the same eu.puma.com graph, one `locale` per shop; the
  // Nordic/PT shops only accept English ("Unsupported locale" for sv-SE, da-DK,
  // fi-FI, pt-PT, de-AT is fine). Sale ≈2,600–3,300 colourways each, every row
  // reduced; guestLogon 200 for all twelve from a GitHub runner (probe 39615284904).
  FR: { host: "eu.puma.com", locale: "fr-FR", site: "https://eu.puma.com/fr/fr" },
  DE: { host: "eu.puma.com", locale: "de-DE", site: "https://eu.puma.com/de/de" },
  ES: { host: "eu.puma.com", locale: "es-ES", site: "https://eu.puma.com/es/es" },
  NL: { host: "eu.puma.com", locale: "nl-NL", site: "https://eu.puma.com/nl/nl" },
  BE: { host: "eu.puma.com", locale: "nl-BE", site: "https://eu.puma.com/be/nl" },
  IE: { host: "eu.puma.com", locale: "en-IE", site: "https://eu.puma.com/ie/en" },
  SE: { host: "eu.puma.com", locale: "en-SE", site: "https://eu.puma.com/se/en" },
  IT: { host: "eu.puma.com", locale: "it-IT", site: "https://eu.puma.com/it/it" },
  AT: { host: "eu.puma.com", locale: "de-AT", site: "https://eu.puma.com/at/de" },
  PT: { host: "eu.puma.com", locale: "en-PT", site: "https://eu.puma.com/pt/en" },
  FI: { host: "eu.puma.com", locale: "en-FI", site: "https://eu.puma.com/fi/en" },
  DK: { host: "eu.puma.com", locale: "en-DK", site: "https://eu.puma.com/dk/en" },
};

export const LISTING_QUERY = `query CategoryPLP($url: String!, $offset: Int!, $limit: Int!) {
  categoryByUrl(url: $url) {
    id
    products(input: {filters: [], limit: $limit, offset: $offset, useScapiSearch: true, useV2Search: true}) {
      totalCount
      nodes { id color masterId
        variantProduct { id name slug price salePrice colorValue colorName orderable
          productPrice { price salePrice promotionPrice isSalePriceElapsed }
          images { href } displayOutOfStock { soldout } }
        masterProduct { id primaryCategoryId }
      }
    }
  }
}`;

export function sizesQuery(styles: string[]): string {
  const parts = styles.map(
    (s, i) =>
      `p${i}: product(id: ${JSON.stringify(s)}) { id variations { id colorValue orderable sizeGroups { label sizes { label orderable maxOrderableQuantity } } } }`,
  );
  return `query Sizes { ${parts.join(" ")} }`;
}

const slugify = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function genderOf(name: string, cat: string): ProductRecord["gender"] {
  // The name is the product's own word; the category is only where it is filed
  // ("Speedcat OG Sneakers Unisex" sits under womens-shoes-sneakers-summer).
  const kids = /\b(kids?'?|youth|toddlers?|infants?|babies|baby|boys'?|girls'?|jr)\b/i;
  if (kids.test(name)) return "cocuk";
  if (/\b(enfants?|kinder|niños?|niñas?|bambin[oi]|ragazz[oi])\b/i.test(name)) return "cocuk";
  if (/\buni(sex|seks)\b/i.test(name)) return null;
  // EU names (2026-10-21): "… pour femme", "… Damen", "… para mujer", "… dames", "… da donna".
  if (/\bwomen'?s?\b|\bdamen\b|\bfemmes?\b|\bmujer\b|\bdames\b|\bdonna\b/i.test(name)) return "kadin";
  if (/\bmen'?s?\b|\bherren\b|\bhommes?\b|\bhombre\b|\bheren\b|\buomo\b/i.test(name)) return "erkek";
  if (/(^|-)(kids|boys|girls|baby|infants?|toddlers?)(-|$)/.test(cat)) return "cocuk";
  if (/(^|-)womens?(-|$)/.test(cat)) return "kadin";
  if (/(^|-)mens?(-|$)/.test(cat)) return "erkek";
  return null;
}

/** Puma's image CDN renders at 2000px by default; the app needs far less. */
const smaller = (u: string) => u.replace(/w_2000,h_2000/, "w_800,h_800");

/** Map one listing node (one colourway). Pure; null unless genuinely reduced. */
export function mapPumaNode(n: any, country: CountryCode): ProductRecord | null {
  const m = PUMA_MARKETS[country];
  const v = n?.variantProduct;
  if (!m || !v?.id || !v?.name || !n?.masterId) return null;
  if (v.productPrice?.isSalePriceElapsed) return null;
  const was = Number(v.productPrice?.price ?? v.price);
  const price = Number(v.productPrice?.salePrice ?? v.salePrice);
  if (!Number.isFinite(price) || !Number.isFinite(was) || price <= 0 || !(price < was)) return null;
  const color = String(v.colorValue ?? n.color ?? String(v.id).split("_")[1] ?? "");
  const photos: string[] = (Array.isArray(v.images) ? v.images : [])
    .map((i: any) => i?.href)
    .filter((u: unknown): u is string => typeof u === "string")
    .map(smaller);
  const cat = String(n.masterProduct?.primaryCategoryId ?? "");
  const name = String(v.name).trim();
  const soldOut = v.orderable === false || v.displayOutOfStock?.soldout === true;
  return {
    brand,
    country,
    externalId: String(v.id), // "402666_01" — style + colour, like Puma TR
    name,
    url: `${m.site}/pd/${v.slug || slugify(name) || "-"}/${n.masterId}?swatch=${color}`,
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: COUNTRIES[country].currency,
    inStock: !soldOut,
    // "womens-shoes-sneakers" → "womens shoes sneakers": the type classifier reads it.
    category: cat ? cat.replace(/-/g, " ") : null,
    gender: genderOf(name, cat),
    variants: null,
    groupKey: `puma:${n.masterId}`,
    colorName: typeof v.colorName === "string" && v.colorName.trim() ? v.colorName.trim() : null,
  };
}

/** Per-colour sizes out of one `product` node, keyed by colour code ("01"). */
export function sizesByColour(product: any): Map<string, SizeVariant[]> {
  const out = new Map<string, SizeVariant[]>();
  for (const v of product?.variations ?? []) {
    const code = String(v?.colorValue ?? String(v?.id ?? "").split("_")[1] ?? "");
    if (!code) continue;
    const groups: any[] = (v.sizeGroups ?? []).filter((g: any) => (g?.sizes ?? []).length);
    const sizes: SizeVariant[] = [];
    const seen = new Set<string>();
    for (const g of groups) {
      for (const s of g.sizes) {
        const raw = String(s?.label ?? "").trim();
        if (!raw) continue;
        // Shoes list a men's and a women's run of the same pairs; keep them apart.
        const label = groups.length > 1 && g.label ? `${String(g.label).trim()} ${raw}` : raw;
        if (seen.has(label)) continue;
        seen.add(label);
        const q = Number(s?.maxOrderableQuantity);
        sizes.push({
          label,
          availability: !s?.orderable ? "out_of_stock" : q > 0 && q <= 2 ? "low_on_stock" : "in_stock",
        });
      }
    }
    if (sizes.length) out.set(code, sizes);
  }
  return out;
}

async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

export async function listPumaIntl(country: CountryCode): Promise<ProductRecord[]> {
  const m = PUMA_MARKETS[country];
  if (!m) return [];
  const endpoint = `https://${m.host}/api/graphql`;
  const base: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/graphql-response+json, application/json",
    locale: m.locale,
    "puma-request-source": "web",
    "x-graphql-client-name": "nitro-fe",
  };
  const post = (body: object, token?: string) =>
    getJson<any>(endpoint, {
      method: "POST",
      body: JSON.stringify(body),
      headers: token ? { ...base, authorization: `Bearer ${token}` } : base,
      country,
    });

  const logon = await post({ operationName: "GuestLogon", query: "mutation GuestLogon { guestLogon { accessToken } }" });
  const token: string | undefined = logon?.data?.guestLogon?.accessToken;
  if (!token) throw new Error(`puma/${country}: guest logon failed: ${JSON.stringify(logon?.errors ?? logon).slice(0, 200)}`);

  // Page 0 gives the total; the rest go out four at a time (eu.puma.com takes
  // up to ~10 s a page, so a serial walk of the Swiss sale ran past 3 minutes).
  const listPage = async (page: number): Promise<any[] | null> => {
    const data = await post(
      { operationName: "CategoryPLP", query: LISTING_QUERY, variables: { url: "/sale", offset: page * PAGE_SIZE, limit: PAGE_SIZE } },
      token,
    ).catch(() => null);
    const products = data?.data?.categoryByUrl?.products;
    if (!products && page === 0) throw new Error(`puma/${country}: ${JSON.stringify(data?.errors ?? data).slice(0, 200)}`);
    if (page === 0) total = Number(products.totalCount ?? 0);
    return products?.nodes ?? null; // a later page failing keeps what the others collected
  };
  let total = 0;
  const pages: (any[] | null)[] = [await listPage(0)];
  const more = Array.from({ length: Math.max(0, Math.min(MAX_PAGES, Math.ceil(total / PAGE_SIZE)) - 1) }, (_, i) => i + 1);
  await pool(more, 4, async (n) => {
    pages[n] = await listPage(n);
  });
  const byId = new Map<string, ProductRecord>();
  for (const nodes of pages) {
    for (const n of nodes ?? []) {
      const r = mapPumaNode(n, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  }
  if (byId.size === 0) throw new Error(`puma/${country}: no discounted products`);

  // Sizes: ten styles per request, a random subset of styles each run.
  const byStyle = new Map<string, ProductRecord[]>();
  for (const r of byId.values()) {
    const style = r.externalId.split("_")[0];
    byStyle.set(style, [...(byStyle.get(style) ?? []), r]);
  }
  const styles = [...byStyle.keys()];
  for (let j = styles.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [styles[j], styles[k]] = [styles[k], styles[j]];
  }
  const batches: string[][] = [];
  for (let i = 0; i < styles.length && batches.length < DETAIL_REQUESTS; i += DETAIL_BATCH) {
    batches.push(styles.slice(i, i + DETAIL_BATCH));
  }
  await pool(batches, 4, async (batch) => {
    const data = await post({ operationName: "Sizes", query: sizesQuery(batch) }, token).catch(() => null);
    batch.forEach((style, i) => {
      const colours = sizesByColour(data?.data?.[`p${i}`]);
      for (const r of byStyle.get(style) ?? []) {
        const sizes = colours.get(r.externalId.split("_")[1] ?? "");
        if (!sizes) continue;
        r.variants = { colors: r.colorName ? [r.colorName] : [], sizes };
        r.inStock = sizes.some((s) => s.availability !== "out_of_stock");
      }
    });
  });

  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listPumaIntl;
