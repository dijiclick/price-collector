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
 * category and the photo gallery; sizes are listed without stock
 * (`variants: "<id> | <size>"`), so `variants` is null.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const SITE = "https://www.sneaksup.com";
const ENDPOINT = "https://api.tr.primewidgets.com/products/searchv5/sup";
const PAGE_SIZE = 100;
const QUERIES = ["a", "e"];
const MAX_REQUESTS = Number(process.env.SNEAKSUP_MAX_REQUESTS ?? 40);
const CAP = Number(process.env.SNEAKSUP_MAX_PRODUCTS ?? 1500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function sneaksupBody(search: string, page: number): string {
  return JSON.stringify({
    status: "ACTIVE",
    search,
    price: {},
    paging: { index: page, size: PAGE_SIZE },
    filter: { orderBy: "DESC", sortBy: "discount.rate" },
    attributes: [],
    groupBy: "item_group_id",
  });
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

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (country !== "TR") return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const q of QUERIES) {
    for (let page = 1; requests < MAX_REQUESTS && byId.size < CAP; page++) {
      if (requests > 0) await sleep(700);
      requests++;
      const d = await getJson<any>(ENDPOINT, {
        method: "POST",
        body: sneaksupBody(q, page),
        headers: { "Content-Type": "application/json", Origin: SITE, Referer: `${SITE}/` },
        retries: 2,
      }).catch(() => null);
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
        if (!byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      // Sorted by discount rate: the first page without a reduced row ends this query.
      if (reduced === 0 || rows.length < PAGE_SIZE || page >= Number(res.totalPages ?? 0)) break;
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
