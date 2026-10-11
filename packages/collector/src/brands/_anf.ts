/**
 * Abercrombie & Fitch + Hollister (2026-10-11) through the storefronts' own
 * GraphQL BFF, `POST https://www.<host>/api/bff/catalog`.
 *
 * Every HTML page on both hosts sits behind a Fastly "Client Challenge" (a
 * GitHub runner gets it too, probe 2026-10-11), but the BFF is not challenged
 * and needs no key or cookie. Two quirks:
 *
 * - The STORE comes from a `store` request header (`a-us`, `a-ca`, `a-uk`,
 *   `h-us`, `h-ca`, `h-uk`), not from an argument. An unknown store silently
 *   falls back to the US catalogue, so the currency in the price string is
 *   checked against the market before a row is kept.
 * - Category ids differ per store (A&F women's is 12203 in US/CA, 84593 in
 *   the UK), so the sale categories are DISCOVERED each run: `categoriesList`
 *   gives the departments, and each department's "Clearance"/"Sale"
 *   sub-category is collected. 1 + departments requests before paging.
 *
 * Paging is `start` (item offset) + `rows`; the BFF returns at most 90 per
 * call whatever `rows` says. Prices are formatted strings ("$19.99",
 * "$45 CAD", "£170"); `discountPrice` is null when not reduced. The listing
 * has no per-size stock (that needs one product call per item, far over
 * budget), so `variants` is null and every listed row counts as in stock —
 * the category only lists what can be bought.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export type AnfSlug = "abercrombie" | "hollister";

interface AnfBrand {
  host: string;
  img: string;
  stores: Partial<Record<CountryCode, { store: string; path: string }>>;
}

export const ANF: Record<AnfSlug, AnfBrand> = {
  abercrombie: {
    host: "https://www.abercrombie.com",
    img: "https://img.abercrombie.com/is/image/anf",
    stores: { US: { store: "a-us", path: "us" }, CA: { store: "a-ca", path: "ca" }, GB: { store: "a-uk", path: "uk" } },
  },
  hollister: {
    host: "https://www.hollisterco.com",
    img: "https://img.hollisterco.com/is/image/anf",
    stores: { US: { store: "h-us", path: "us" }, CA: { store: "h-ca", path: "ca" }, GB: { store: "h-uk", path: "uk" } },
  },
};

const PAGE = 90; // the BFF's own ceiling
const CAP = Number(process.env.ANF_CAP ?? 1500);
const MAX_REQUESTS = Number(process.env.ANF_MAX_REQUESTS ?? 45);
const PAUSE_MS = Number(process.env.ANF_PAUSE_MS ?? 700);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PRODUCT_FIELDS =
  "id kic name gender departmentName color collection productPageUrl " +
  "price { originalPrice discountPrice discountText } imageSet { modelImage prodImage allImages }";

/**
 * "$19.99" / "$45 CAD" / "£1,170" / "€29,95" → { amount, currency } (major units).
 * Currency is read from the string so a store fallback (unknown store → US)
 * cannot pass dollars off as pounds.
 */
export function parseAnfPrice(s: unknown): { amount: number; currency: string } | null {
  if (typeof s !== "string" || !s.trim()) return null;
  const currency = /CAD/.test(s) ? "CAD" : /£/.test(s) ? "GBP" : /€/.test(s) ? "EUR" : /\$/.test(s) ? "USD" : "";
  let num = s.replace(/[^\d.,]/g, "");
  if (/,\d{2}$/.test(num) && !num.includes(".")) num = num.replace(/\./g, "").replace(",", ".");
  else num = num.replace(/,/g, "");
  const amount = parseFloat(num);
  return Number.isFinite(amount) && amount > 0 && currency ? { amount, currency } : null;
}

function genderOf(p: any): ProductRecord["gender"] {
  const d = String(p?.departmentName ?? "").toLowerCase();
  if (/kid|girl|boy|baby|toddler/.test(d)) return "cocuk";
  if (p?.gender === "F" || /wom[ae]n/.test(d)) return "kadin";
  if (p?.gender === "M" || /\bm[ae]n/.test(d)) return "erkek";
  return null;
}

/** Map one BFF product. Pure. Returns null unless it is reduced, in the market's currency. */
export function mapAnf(slug: AnfSlug, country: CountryCode, p: any, category: string | null = null): ProductRecord | null {
  const b = ANF[slug];
  const st = b.stores[country];
  if (!st || !p?.id || !p?.name) return null;
  const now = parseAnfPrice(p.price?.discountPrice);
  const was = parseAnfPrice(p.price?.originalPrice);
  const currency = COUNTRIES[country].currency;
  if (!now || !was || now.currency !== currency || was.currency !== currency || now.amount >= was.amount) return null;
  const img = (id: unknown) => (typeof id === "string" && id ? `${b.img}/${id}?policy=product-medium` : null);
  const first = img(p.imageSet?.modelImage) ?? img(p.imageSet?.prodImage);
  const gallery = (p.imageSet?.allImages ?? []).map(img);
  const path = String(p.productPageUrl ?? "").replace(/^undefined/, "").split("?")[0];
  return {
    brand: slug,
    country,
    externalId: String(p.id),
    name: String(p.name).trim(),
    url: path.startsWith("/p/") ? `${b.host}/shop/${st.path}${path}` : `${b.host}/shop/${st.path}`,
    imageUrl: first,
    images: cleanGallery(gallery, first),
    price: toMinor(now.amount),
    listPrice: toMinor(was.amount),
    currency,
    inStock: true,
    category,
    gender: genderOf(p),
    variants: null,
    groupKey: p.collection ? `${slug}:${p.collection}` : null,
    colorName: p.color ? String(p.color) : null,
  };
}

async function bff(slug: AnfSlug, country: CountryCode, query: string): Promise<any> {
  const b = ANF[slug];
  const store = b.stores[country]!.store;
  const data = await getJson<any>(`${b.host}/api/bff/catalog`, {
    method: "POST",
    country,
    retries: 1,
    headers: { "content-type": "application/json", store, origin: b.host, referer: `${b.host}/shop/${b.stores[country]!.path}` },
    body: JSON.stringify({ query }),
  });
  if (!data?.data) throw new Error(`${slug}/${country}: ${JSON.stringify(data?.errors ?? data).slice(0, 200)}`);
  return data.data;
}

/** Department → its Clearance/Sale sub-category ids. */
export function saleCategories(categoriesList: any[]): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  for (const dep of categoriesList ?? []) {
    for (const sub of dep?.subCategories ?? []) {
      if (/^(sale|clearance)$/i.test(String(sub?.name ?? "").trim()) && sub.categoryId) {
        out.push({ id: String(sub.categoryId), name: `${dep.name ?? ""} ${sub.name}`.trim() });
      }
    }
  }
  return out;
}

export async function listAnf(slug: AnfSlug, country: CountryCode): Promise<ProductRecord[]> {
  if (!ANF[slug]?.stores[country]) return [];
  let requests = 1;
  const top = await bff(slug, country, "{ categoriesList { categoryId name subCategories { categoryId name } } }");
  const cats = saleCategories(top.categoriesList);
  if (!cats.length) throw new Error(`${slug}/${country}: no sale/clearance category found`);
  const queue = cats.map((c) => ({ ...c, start: 0, done: false, rows: [] as ProductRecord[] }));
  const seen = new Set<string>();
  while (requests < MAX_REQUESTS && seen.size < CAP && queue.some((q) => !q.done)) {
    for (const q of queue) {
      if (q.done || requests >= MAX_REQUESTS || seen.size >= CAP) continue;
      await sleep(PAUSE_MS);
      requests++;
      const d = await bff(
        slug,
        country,
        `{ category(categoryId:"${q.id}", rows:"${PAGE}", start:"${q.start}") { productTotalCount products { ${PRODUCT_FIELDS} } } }`,
      ).catch(() => null);
      const products: any[] = d?.category?.products ?? [];
      for (const p of products) {
        const r = mapAnf(slug, country, p);
        if (!r || seen.has(r.externalId)) continue;
        seen.add(r.externalId);
        q.rows.push(r);
      }
      q.start += PAGE;
      const total = Number(d?.category?.productTotalCount ?? 0);
      if (!d || products.length === 0 || q.start >= total) q.done = true;
      // Kids' departments are capped at a slice so women's and men's lead the feed.
      if (/girl|boy|kid|baby|toddler/i.test(q.name) && q.rows.length >= CAP / 16) q.done = true;
    }
  }
  // Round-robin merge so the cap draws from every department.
  const out: ProductRecord[] = [];
  for (let i = 0; queue.some((q) => i < q.rows.length); i++) for (const q of queue) if (i < q.rows.length) out.push(q.rows[i]);
  return out.slice(0, CAP);
}
