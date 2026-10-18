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
 * `paging.index` is 1-based (0 answers page 1 again). An empty query returns
 * nothing; "a" finds 9,158 of the groups, and every reduced row "e"/"i"/"altın"
 * found was already in it (957 reduced groups, 2026-10-18). Sorted by discount
 * rate, the walk stops at the first page without a reduced row (~11 requests).
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
const MAX_PAGES = Number(process.env.ALTINBAS_MAX_PAGES ?? 40);
const CAP = Number(process.env.ALTINBAS_MAX_PRODUCTS ?? 1500);
const PAUSE_MS = Number(process.env.ALTINBAS_PAUSE_MS ?? 600);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const brand = "altinbas";

export function altinbasBody(search: string, page: number, size = PAGE_SIZE, sorted = true): string {
  return JSON.stringify({
    status: "ACTIVE",
    search,
    price: {},
    paging: { index: page, size },
    filter: sorted ? { orderBy: "DESC", sortBy: "discount.rate" } : {},
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

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (country !== "TR") return [];
  const byId = new Map<string, ProductRecord>();
  for (let page = 1; page <= MAX_PAGES && byId.size < CAP; page++) {
    if (page > 1) await sleep(PAUSE_MS);
    const d = await getJson<any>(ENDPOINT, {
      method: "POST",
      body: altinbasBody(QUERY, page),
      headers: { "Content-Type": "application/json", Origin: SITE, Referer: `${SITE}/` },
      retries: 2,
    }).catch(() => null);
    const res = d?.results?.products;
    if (!res) {
      if (page === 1) throw new Error("altinbas: PrimeWidgets search refused");
      break;
    }
    const rows: any[] = res.data ?? [];
    let reduced = 0;
    for (const p of rows) {
      const r = mapAltinbas(p);
      if (!r || r.listPrice == null) continue;
      reduced++;
      if (!byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    // Sorted by discount rate: the first page without a reduced row is the end.
    if (reduced === 0 || rows.length < PAGE_SIZE || page >= Number(res.totalPages ?? 0)) break;
  }
  return [...byId.values()].slice(0, CAP);
}
