/**
 * Altınbaş (www.altinbas.com, Turkish gold/diamond jeweller; a custom PHP
 * storefront) through its PrimeWidgets search API (2026-10-18).
 *
 * The site itself answers GitHub's runners, but its listing is ~0.9 MB of HTML
 * per 32 tiles. Its on-site search is PrimeWidgets (client id `altinbas`, from
 * cdn.primewidgets.com/customers/altinbas/init.js) — the same plain JSON POST
 * as Sneaks Up:
 *
 *   POST https://api.tr.primewidgets.com/products/searchv5/altinbas
 *   {"status":"ACTIVE","search":"a","paging":{"index":N,"size":100},
 *    "filter":{"orderBy":"DESC","sortBy":"discount.rate"},"groupBy":"item_group_id",…}
 *
 * `paging.index` is 1-based (0 answers page 1 again); `size` is capped at 100.
 * An empty query returns nothing; "a" finds every group (it matches the brand
 * name "Altınbaş" on every row): walked in full, "e" (6,786 groups) and "o"
 * (579) found nothing "a" had not.
 *
 * FULL CATALOGUE (2026-10-19): two passes, ~103 requests, ~90 s here.
 *   1. The reduced head, discount-sorted, as before (~11 requests, ~960
 *      deals). The sort also picks which variant stands for a `groupBy`
 *      group: discount-sorted it is the most-reduced one, price-sorted the
 *      cheapest (386 of 963 deal groups showed a different, smaller-carat
 *      variant that way), so deals come from this pass, unchanged.
 *   2. All of "a", price-sorted — 9,046 groups in 92 requests; groups the head
 *      already holds are skipped, the rest are full-price rows. The sort
 *      matters for deep paging: unsorted (relevance) and `code`-sorted pages
 *      repeat and skip rows (8,779 and 8,803 distinct of 9,046), the discount
 *      sort ties on every unreduced row, `price` ASC returned all 9,046 once.
 * A page that fails after its retries fails the run: a partial walk would let
 * the delist sweep mark the rest sold out.
 * Answers a runner with 200 (probe run 39124363303).
 *
 * Prices: `price` is what a shopper pays, `oldPrice` the crossed-out one.
 * Rows with `isBasketPrice: true` (434 of 957) are "Sepette İndirim" — an
 * automatic basket price with no code or minimum, printed on the tile as the
 * old/new pair — so `price` there is the basket price, the same rule as
 * DeFacto/LCW/Boyner's inBasketWithDiscount. The product page sometimes prints
 * an even higher strike price on top (AKLBR0132: 17.870 → 13.400 → basket
 * 11.390); PrimeWidgets' smaller 13.400 → 11.390 is the one kept.
 *
 * Stock: only ACTIVE rows are searchable, so every row is in stock. Ring sizes
 * exist on the product page without per-size stock, so `variants` is null.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const SITE = "https://www.altinbas.com";
export const ENDPOINT = "https://api.tr.primewidgets.com/products/searchv5/altinbas";
const PAGE_SIZE = 100;
const QUERY = "a";
/** 92 pages today; room for the catalogue to grow by half. */
const MAX_PAGES = Number(process.env.ALTINBAS_MAX_PAGES ?? 140);
const CAP = Number(process.env.ALTINBAS_MAX_PRODUCTS ?? 14_000);
/** A stable order for deep paging (see header). */
export const SORT = { orderBy: "ASC", sortBy: "price" };
/** The deal order: most-reduced first, and the most-reduced variant stands for its group. */
export const DEAL_SORT = { orderBy: "DESC", sortBy: "discount.rate" };
const PAUSE_MS = Number(process.env.ALTINBAS_PAUSE_MS ?? 600);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const brand = "altinbas";

export function altinbasBody(search: string, page: number, size = PAGE_SIZE, sort: Record<string, string> | null = SORT): string {
  return JSON.stringify({
    status: "ACTIVE",
    search,
    price: {},
    paging: { index: page, size },
    filter: sort ?? {},
    attributes: [],
    groupBy: "item_group_id",
  });
}

const attr = (p: any, name: string): string | null => {
  const a = (p?.attributes ?? []).find((x: any) => x?.name === name);
  const v = a?.values?.[0] ?? a?.value;
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

const title = (s: string) => s.toLocaleLowerCase("tr").replace(/(^|[\s-])\S/g, (c) => c.toLocaleUpperCase("tr"));

export function altinbasGender(g: string | null, cats: string[] = []): ProductRecord["gender"] {
  const s = [g ?? "", ...cats].join(" | ").toLocaleLowerCase("tr");
  if (/çocuk|bebek/.test(s)) return "cocuk";
  if (/kadın|bayan/.test(s)) return "kadin";
  if (/erkek|\bbay\b/.test(s)) return "erkek";
  return null;
}

/**
 * The most specific category: the leaf of the last path ("KOLYE > Pırlanta
 * Kolyeler" → "Pırlanta Kolyeler"), so a group like "ERKEK" or "KOLEKSİYONLAR"
 * never stands in for the product type.
 */
export function altinbasCategory(cats: any[] | null | undefined): string | null {
  const names = (cats ?? []).map((c) => String(c?.name ?? "").trim()).filter(Boolean);
  const leaf = names.length ? names[names.length - 1].split(">").pop()!.trim() : "";
  return leaf ? title(leaf) : null;
}

/** Map one PrimeWidgets row. Pure. */
export function mapAltinbas(p: any): ProductRecord | null {
  const price = Number(p?.price);
  const old = Number(p?.oldPrice);
  const id = p?.itemGroupId ?? p?.code;
  if (!id || !p?.name || typeof p?.url !== "string" || !p.url.startsWith(SITE) || !Number.isFinite(price) || price <= 0) return null;
  const imgs: string[] = (p.images ?? []).filter((u: unknown) => typeof u === "string");
  const cats = (p.categories ?? []).map((c: any) => String(c?.name ?? ""));
  return {
    brand,
    country: "TR",
    externalId: String(id),
    name: String(p.name).trim(),
    url: p.url.split("?")[0],
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    // A strike price under a tenth of the price is a data error, not a deal.
    listPrice: Number.isFinite(old) && old > price && price >= old * 0.1 ? toMinor(old) : null,
    currency: "TRY",
    inStock: p.status !== "PASSIVE",
    category: altinbasCategory(p.categories),
    gender: altinbasGender(attr(p, "gender"), cats),
    variants: null,
    colorName: null,
  };
}

async function search(page: number, sort: Record<string, string>): Promise<{ rows: any[]; totalPages: number }> {
  const d = await getJson<any>(ENDPOINT, {
    method: "POST",
    body: altinbasBody(QUERY, page, PAGE_SIZE, sort),
    headers: { "Content-Type": "application/json", Origin: SITE, Referer: `${SITE}/` },
    retries: 2,
  }).catch(() => null);
  const res = d?.results?.products;
  // Any failed page fails the run: a partial walk would let the delist sweep mark the rest sold out.
  if (!res) throw new Error(`altinbas: PrimeWidgets search refused page ${page} (${sort.sortBy})`);
  return { rows: res.data ?? [], totalPages: Number(res.totalPages ?? 0) };
}

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (country !== "TR") return [];
  const byId = new Map<string, ProductRecord>();
  // 1. The reduced head, discount-sorted, exactly as before 2026-10-19: within
  //    a group it surfaces the most-reduced variant, so a deal keeps its url,
  //    price and strike price. Ends at the first page without a reduction.
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) await sleep(PAUSE_MS);
    const { rows, totalPages } = await search(page, DEAL_SORT);
    let reduced = 0;
    for (const p of rows) {
      const r = mapAltinbas(p);
      if (!r || r.listPrice == null) continue;
      reduced++;
      if (!byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (reduced === 0 || rows.length < PAGE_SIZE || page >= totalPages) break;
  }
  // 2. Everything, price-sorted (the only stable order); groups the head
  //    already holds keep their deal row.
  for (let page = 1; page <= MAX_PAGES; page++) {
    await sleep(PAUSE_MS);
    const { rows, totalPages } = await search(page, SORT);
    for (const p of rows) {
      const r = mapAltinbas(p);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (rows.length < PAGE_SIZE || page >= totalPages) break;
    if (page === MAX_PAGES) throw new Error(`altinbas: more than ${MAX_PAGES} pages — raise ALTINBAS_MAX_PAGES`);
  }
  const all = [...byId.values()];
  // A cap that cut rows would let the delist sweep mark them sold out: refuse instead.
  if (all.length > CAP) throw new Error(`altinbas: ${all.length} products, over the cap of ${CAP}`);
  return [...all.filter((r) => r.listPrice != null), ...all.filter((r) => r.listPrice == null)];
}
