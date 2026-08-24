import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";

const API = "https://api.hm.com/search-services/v1/tr_tr/listing/resultpage";
const CATS = ["ladies_all", "men_all", "kids_all", "home_all"];
// The crawl root is the section: it maps 1:1 to a gender (home carries none).
const ROOT_GENDER: Record<string, ProductRecord["gender"]> = {
  ladies: "kadin",
  men: "erkek",
  kids: "cocuk",
};

export function mapProduct(p: any, category: string | null): ProductRecord | null {
  const id = String(p.id ?? "");
  if (!id) return null;
  const prices: any[] = (p.prices ?? []).filter((x: any) => typeof x?.price === "number");
  const original = prices.find((x) => x.priceType === "whitePrice")?.price ?? prices[0]?.price;
  // H&M colour-codes the reduced price and the colour differs by market —
  // tr_tr and en_gb use "yellowPrice", never the "redPrice" this used to match,
  // so a markdown could never be read. Take the cheapest entry instead of
  // matching a name: the sale row is whichever undercuts the white price.
  const current = prices.reduce(
    (lo: number, x: any) => (x.price < lo ? x.price : lo),
    original as number,
  );
  if (typeof current !== "number" || current <= 0) return null;
  return {
    brand: "hm",
    externalId: id,
    name: p.productName ?? "",
    url: `https://www2.hm.com${p.url ?? `/tr_tr/productpage.${id}.html`}`,
    imageUrl: p.productImage ?? p.images?.[0]?.url ?? null,
    price: toMinor(current),
    listPrice: typeof original === "number" && original > current ? toMinor(original) : null,
    currency: "TRY",
    inStock: p.availability?.stockState === "Available",
    category,
    gender: (category && ROOT_GENDER[category]) || null,
  };
}

export const brand = "hm";

export async function listProducts(): Promise<ProductRecord[]> {
  // pageSize is locked at 72 — anything larger is a 422 — and a pool is NOT
  // worth it here: at concurrency 8 the API starts returning 403s.
  //
  // The cap was 150, sized when the roots ran 138/34/50/18 pages. Ladies alone
  // now reports 416, so the crawl was stopping at 36% of the women's catalogue
  // and silently. The loop already exits on `page >= totalPages`, so this cap is
  // only a runaway guard: set it above the real page count and let the API say
  // when it is done.
  const maxPages = Number(process.env.HM_MAX_PAGES ?? 500);
  const byId = new Map<string, ProductRecord>();
  for (const cat of CATS) {
    for (let page = 1; page <= maxPages; page++) {
      const url =
        `${API}?page=${page}&pageSize=72&touchPoint=Desktop&categoryId=${cat}&pageId=/${cat.split("_")[0]}`;
      const data = await getJson<any>(url).catch(() => null);
      const list: any[] = data?.plpList?.productList ?? [];
      if (list.length === 0) break;
      for (const p of list) {
        const rec = mapProduct(p, cat.split("_")[0]);
        if (rec) byId.set(rec.externalId, rec);
      }
      if (page >= (data?.pagination?.totalPages ?? 1)) break;
    }
  }
  return [...byId.values()];
}
