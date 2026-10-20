/**
 * Sneaks Up (www.sneaksup.com, Ünal Group's sneaker store; Inveon Next.js
 * storefront) through its PrimeWidgets search API (2026-10-11).
 *
 * The storefront is a Cloudflare challenge for GitHub's runners (home probe
 * 403 + "Just a moment"). Its on-site search is PrimeWidgets (client id `sup`,
 * from cdn.primewidgets.com/customers/sup/init.js), a plain JSON POST:
 *
 *   POST https://api.tr.primewidgets.com/products/searchv5/sup
 *   {"status":"ACTIVE","search":"a","paging":{"index":N,"size":100},
 *    "filter":{"orderBy":"DESC","sortBy":"discount.rate"},"groupBy":"item_group_id",…}
 *
 * An empty query returns nothing, so the walk searches "a" (4,300+ of the
 * ~4,400 colourways) sorted by discount rate, highest first, and stops at the
 * first page without a reduced row or at the cap. Answers a runner with 200
 * (probe run 38136354436). Rows carry price/oldPrice in TRY, gender, colour,
 * category and the photo gallery.
 *
 * SIZES (2026-10-20). A grouped row lists its colour's whole size run
 * (`variants: "<id> | <size>"`) without stock. The same search WITHOUT
 * `groupBy` returns one row per size, and only the sizes that can be bought:
 * S60022-ES006 lists 8 sizes and answers 5 rows (38–40.5), matching its
 * `availabilityScore` 0.62. So a second, ungrouped walk of the same query
 * (sorted by discount, until a page holds no reduced row: ~46 pages of 100)
 * marks each listed size in_stock or out_of_stock. Deals that walk does not
 * reach (the "e" query's ~370, which have no "a") are asked by id instead:
 * the same ungrouped search with an `item_group_id` attribute filter, 20 ids a
 * request. ~65 requests in all. A product neither reached keeps its stored
 * sizes. Before this Sneaks Up stored no sizes and fell out of every
 * size-filtered feed.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { sortSizes } from "../sizes";
import type { CountryCode } from "../../../../lib/countries";

const SITE = "https://www.sneaksup.com";
const ENDPOINT = "https://api.tr.primewidgets.com/products/searchv5/sup";
const PAGE_SIZE = 100;
const QUERIES = ["a", "e"];
const MAX_REQUESTS = Number(process.env.SNEAKSUP_MAX_REQUESTS ?? 40);
const CAP = Number(process.env.SNEAKSUP_MAX_PRODUCTS ?? 1500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function sneaksupBody(search: string, page: number, grouped = true): string {
  return JSON.stringify({
    status: "ACTIVE",
    search,
    price: {},
    paging: { index: page, size: PAGE_SIZE },
    filter: { orderBy: "DESC", sortBy: "discount.rate" },
    attributes: [],
    ...(grouped ? { groupBy: "item_group_id" } : {}),
  });
}

/** The ungrouped size walk's request budget (~50 pages hold every reduced size row). */
const SIZE_MAX_REQUESTS = Number(process.env.SNEAKSUP_SIZE_MAX_REQUESTS ?? 80);
/** The search pages at most 10,000 rows; past page 100 it wraps back to page 1. */
const WINDOW_PAGES = 100;

const attrValues = (p: any, name: string): string[] =>
  ((p?.attributes ?? []).find((a: any) => a?.name === name)?.values ?? []).filter((v: unknown) => typeof v === "string");

/** A grouped row's whole size run (`"139150 | 42"` …), in size order. Pure. */
export function sizeRun(p: any): string[] {
  const labels = [...new Set(attrValues(p, "variants").map((v) => v.split("|").pop()!.trim()).filter(Boolean))];
  return sortSizes(labels.map((label) => ({ label }))).map((x) => x.label);
}

/** The run with each size marked by whether an ungrouped (buyable) row named it. Pure. */
export function markSizes(run: string[], buyable: Set<string>): SizeVariant[] {
  const all = [...run, ...[...buyable].filter((l) => !run.includes(l))];
  return all.map((label) => ({ label, availability: buyable.has(label) ? "in_stock" : "out_of_stock" }));
}

const BY_ID_BATCH = 20;

/** Add every buyable (ungrouped) row's size to its item group; returns how many rows were reduced. */
function addRows(out: Map<string, Set<string>>, rows: any[]): number {
  let reduced = 0;
  for (const p of rows) {
    if (Number(p?.oldPrice) > Number(p?.price)) reduced++;
    const id = p?.itemGroupId ?? attr(p, "item_group_id");
    const size = attr(p, "size");
    if (!id || !size || p?.status === "PASSIVE") continue;
    const k = String(id);
    (out.get(k) ?? out.set(k, new Set()).get(k)!).add(size);
  }
  return reduced;
}

/**
 * item group → the sizes that can be bought. Walks `search` ungrouped until the
 * first page without a reduced row, then asks the `wanted` ids it did not reach
 * by id, under the query each was found by. Within SIZE_MAX_REQUESTS.
 */
export async function buyableSizes(
  search: string,
  post: (body: string) => Promise<any>,
  wanted: Map<string, string> = new Map(),
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  let requests = 0;
  for (let page = 1; page <= WINDOW_PAGES && requests < SIZE_MAX_REQUESTS; page++) {
    if (requests > 0) await sleep(500);
    requests++;
    const res = (await post(sneaksupBody(search, page, false)).catch(() => null))?.results?.products;
    if (!res) break;
    const rows: any[] = res.data ?? [];
    if (addRows(out, rows) === 0 || rows.length < PAGE_SIZE || page >= Number(res.totalPages ?? 0)) break;
  }
  const left = new Map<string, string[]>();
  for (const [id, q] of wanted) if (!out.has(id)) (left.get(q) ?? left.set(q, []).get(q)!).push(id);
  for (const [q, ids] of left) {
    for (let i = 0; i < ids.length && requests < SIZE_MAX_REQUESTS; i += BY_ID_BATCH) {
      await sleep(500);
      requests++;
      const body = JSON.parse(sneaksupBody(q, 1, false));
      body.attributes = [{ name: "item_group_id", values: ids.slice(i, i + BY_ID_BATCH) }];
      const res = (await post(JSON.stringify(body)).catch(() => null))?.results?.products;
      if (res) addRows(out, res.data ?? []);
    }
  }
  return out;
}

const attr = (p: any, name: string): string | null => {
  const v = (p?.attributes ?? []).find((a: any) => a?.name === name)?.values?.[0];
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

const title = (s: string) => s.toLocaleLowerCase("tr").replace(/(^|[\s-])\S/g, (c) => c.toLocaleUpperCase("tr"));

export function sneaksupGender(g: string | null): ProductRecord["gender"] {
  const s = (g ?? "").toLocaleLowerCase("tr");
  if (/çocuk|bebek|genç/.test(s)) return "cocuk";
  if (s.startsWith("kad")) return "kadin";
  if (s.startsWith("erkek")) return "erkek";
  return null;
}

/** Map one search row. Pure. */
export function mapSneaksup(p: any): ProductRecord | null {
  const price = Number(p?.price);
  const old = Number(p?.oldPrice);
  const id = p?.itemGroupId ?? attr(p, "item_group_id") ?? p?.code;
  if (!id || !p?.name || typeof p?.url !== "string" || !p.url.startsWith(SITE) || !Number.isFinite(price) || price <= 0) return null;
  const imgs: string[] = (p.images ?? []).filter((u: unknown) => typeof u === "string");
  const colour = attr(p, "color");
  return {
    brand: "sneaksup",
    country: "TR",
    externalId: String(id),
    name: String(p.name).trim(),
    url: p.url.split("?")[0],
    imageUrl: imgs[0] ?? attr(p, "decoupage"),
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: Number.isFinite(old) && old > price ? toMinor(old) : null,
    currency: "TRY",
    inStock: p.status !== "PASSIVE" && Number(attr(p, "availabilityScore") ?? 1) > 0,
    category: p.categories?.[0]?.name ?? attr(p, "productSubCategory"),
    gender: sneaksupGender(attr(p, "gender")),
    variants: null,
    colorName: colour ? title(colour) : null,
  };
}

export const brand = "sneaksup";

const post = (body: string) =>
  getJson<any>(ENDPOINT, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json", Origin: SITE, Referer: `${SITE}/` },
    retries: 2,
  });

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (country !== "TR") return [];
  const byId = new Map<string, ProductRecord>();
  const runs = new Map<string, string[]>();
  const queryOf = new Map<string, string>();
  let requests = 0;
  for (const q of QUERIES) {
    for (let page = 1; requests < MAX_REQUESTS && byId.size < CAP; page++) {
      if (requests > 0) await sleep(700);
      requests++;
      const d = await post(sneaksupBody(q, page)).catch(() => null);
      const res = d?.results?.products;
      if (!res) {
        if (requests === 1) throw new Error("sneaksup: PrimeWidgets search refused");
        break;
      }
      const rows: any[] = res.data ?? [];
      let reduced = 0;
      for (const p of rows) {
        const r = mapSneaksup(p);
        if (!r || r.listPrice == null) continue;
        reduced++;
        if (!byId.has(r.externalId)) {
          byId.set(r.externalId, r);
          runs.set(r.externalId, sizeRun(p));
          queryOf.set(r.externalId, q);
        }
      }
      // Sorted by discount rate: the first page without a reduced row ends this query.
      if (reduced === 0 || rows.length < PAGE_SIZE || page >= Number(res.totalPages ?? 0)) break;
    }
  }
  const buyable = await buyableSizes(QUERIES[0], post, queryOf).catch(() => new Map<string, Set<string>>());
  for (const r of byId.values()) {
    const got = buyable.get(r.externalId);
    if (!got) continue; // the size walk never reached it: keep what is stored
    const sizes = markSizes(runs.get(r.externalId) ?? [], got);
    if (sizes.length) r.variants = { colors: r.colorName ? [r.colorName] : [], sizes };
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
