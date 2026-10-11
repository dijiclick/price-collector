/**
 * C&A — Switzerland (www.c-and-a.com/ch/de/shop), added 2026-10-11.
 *
 * The storefront is a React SPA over one GraphQL endpoint, `POST /api`. The
 * site sends Apollo persisted-query hashes, but the server also accepts a plain
 * `query` text, so this adapter sends its own minimal query and survives their
 * deploys (a persisted hash changes with every release). The endpoint answers
 * a plain request — no cookies, no bot wall — as long as `Origin`, `x-country`
 * and `x-language` are set (without them: 403 "Not allowed").
 *
 * `list(ipimId)` pages a navigation node, 60 products a page, every product
 * with its colour variants, each carrying `grossPrice`/`strikePrice` in CHF and
 * per-size stock (`AVAILABLE` / `LIMITED`, plus a quantity). The Sale tree is
 * `7`, split into Damen `7-1`, Herren `7-2`, Kinder `7-3` and Babys `7-4`;
 * walking the slices gives every row an exact gender. Each colour variant is its
 * own record (its own price and sizes), grouped under the model's `usim`.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const ORIGIN = "https://www.c-and-a.com";
const API = `${ORIGIN}/api?o=list`;
const PAUSE_MS = Number(process.env.CANDA_PAUSE_MS ?? 600);
const MAX_PAGES = 40;

/** Per market: the URL path prefix and the header values the API keys on. */
export const CANDA_MARKETS: Partial<Record<CountryCode, { country: string; language: string; path: string }>> = {
  CH: { country: "ch", language: "de", path: "/ch/de/shop" },
};

/** Sale slices (ipimId → gender). */
export const CANDA_SALE: { ipimId: string; gender: ProductRecord["gender"] }[] = [
  { ipimId: "7-1", gender: "kadin" },
  { ipimId: "7-2", gender: "erkek" },
  { ipimId: "7-3", gender: "cocuk" },
  { ipimId: "7-4", gender: "cocuk" },
];

export const LIST_QUERY =
  "query list($ipimId:String,$page:Int){list(page:$page ipimId:$ipimId){ipimId page productCount " +
  "products{usim uri name categoryIpimId flag variants{uri isAvailable color{colorCode label} " +
  "price{grossPrice strikePrice currency} sizes{label available isAvailable quantity skuId} " +
  "modelImage{file folder} variantImage{file folder}}}}}";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `{folder:"/productimages", file:"v123/2257457-1-08.jpg"}` → the site's own CDN rendition. */
export function candaImage(img: any): string | null {
  const file = typeof img?.file === "string" ? img.file : "";
  if (!file) return null;
  const folder = String(img?.folder ?? "/productimages").replace(/^\/+|\/+$/g, "");
  return `${ORIGIN}/img/product/q_auto:good,w_1200,h_1800,c_pad/${file.replace("/", `/${folder}/`)}`;
}

export function candaSizes(sizes: unknown): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const s of Array.isArray(sizes) ? sizes : []) {
    const label = String(s?.label ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const st = String(s?.available ?? "").toUpperCase();
    const ok = s?.isAvailable !== false && st !== "NOT_AVAILABLE" && st !== "SOLD_OUT" && st !== "UNAVAILABLE";
    out.push({ label, availability: !ok ? "out_of_stock" : st === "LIMITED" ? "low_on_stock" : "in_stock" });
  }
  return out;
}

/** One list product → one record per DISCOUNTED colour variant. Pure. */
export function mapCanda(
  country: CountryCode,
  p: any,
  gender: ProductRecord["gender"] = null,
): ProductRecord[] {
  const usim = typeof p?.usim === "string" ? p.usim : "";
  const name = String(p?.name ?? "").trim();
  if (!usim || !name) return [];
  const out: ProductRecord[] = [];
  for (const v of Array.isArray(p.variants) ? p.variants : []) {
    const price = Number(v?.price?.grossPrice);
    const strike = Number(v?.price?.strikePrice);
    if (!Number.isFinite(price) || price <= 0 || !(Number.isFinite(strike) && strike > price)) continue;
    const code = String(v?.color?.colorCode ?? "").trim();
    const colorName = typeof v?.color?.label === "string" && v.color.label.trim() ? v.color.label.trim() : null;
    const sizes = candaSizes(v.sizes);
    const imgs = [candaImage(v.modelImage), candaImage(v.variantImage)];
    const imageUrl = imgs.find(Boolean) ?? null;
    const uri = typeof v.uri === "string" ? v.uri : typeof p.uri === "string" ? p.uri : "";
    out.push({
      brand: "c-and-a",
      country,
      externalId: code ? `${usim}-${code}` : usim,
      name,
      url: uri.startsWith("/") ? `${ORIGIN}${uri}` : ORIGIN,
      imageUrl,
      images: cleanGallery(imgs, imageUrl),
      price: toMinor(price),
      listPrice: toMinor(strike),
      currency: String(v.price.currency ?? COUNTRIES[country].currency),
      inStock: sizes.length ? sizes.some((s) => s.availability !== "out_of_stock") : v.isAvailable !== false,
      category: null,
      gender,
      variants: { colors: colorName ? [colorName] : [], sizes },
      groupKey: `c-and-a:${usim}`,
      colorName,
    });
  }
  return out;
}

async function listPage(country: CountryCode, ipimId: string, page: number): Promise<any> {
  const m = CANDA_MARKETS[country]!;
  return getJson<any>(API, {
    method: "POST",
    country,
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      Referer: `${ORIGIN}${m.path}/sale`,
      "x-country": m.country,
      "x-language": m.language,
    },
    body: JSON.stringify({ query: LIST_QUERY, variables: { ipimId, page } }),
  });
}

export async function listCanda(country: CountryCode, maxProducts = 1500): Promise<ProductRecord[]> {
  if (!CANDA_MARKETS[country]) return [];
  const byId = new Map<string, ProductRecord>();
  // First page of every slice: sizes the slices so the cap is shared fairly.
  const streams: { ipimId: string; gender: ProductRecord["gender"]; page: number; pages: number; quota: number; taken: number }[] = [];
  let total = 0;
  for (const s of CANDA_SALE) {
    if (streams.length) await sleep(PAUSE_MS);
    const data = await listPage(country, s.ipimId, 0).catch(() => null);
    const list = data?.data?.list;
    if (!list) continue;
    const count = Number(list.productCount) || 0;
    const per = (list.products ?? []).length || 60;
    total += count;
    const st = { ipimId: s.ipimId, gender: s.gender, page: 1, pages: Math.ceil(count / per), quota: count, taken: 0 };
    for (const p of list.products ?? []) for (const r of mapCanda(country, p, s.gender)) if (!byId.has(r.externalId)) (byId.set(r.externalId, r), st.taken++);
    streams.push(st);
  }
  if (!streams.length) throw new Error(`c-and-a/${country}: sale list refused`);
  for (const s of streams) s.quota = total > 0 ? Math.ceil((maxProducts * s.quota) / total) : maxProducts;

  let requests = streams.length;
  while (byId.size < maxProducts && requests < MAX_PAGES) {
    let round = streams.filter((s) => s.page < s.pages && s.taken < s.quota);
    if (!round.length) {
      round = streams.filter((s) => s.page < s.pages);
      for (const s of round) s.quota = Infinity;
    }
    if (!round.length) break;
    for (const s of round) {
      if (requests >= MAX_PAGES || byId.size >= maxProducts) break;
      await sleep(PAUSE_MS);
      requests++;
      const data = await listPage(country, s.ipimId, s.page++).catch(() => null);
      const prods = data?.data?.list?.products;
      if (!Array.isArray(prods) || !prods.length) {
        s.pages = 0;
        continue;
      }
      for (const p of prods) for (const r of mapCanda(country, p, s.gender)) if (!byId.has(r.externalId)) (byId.set(r.externalId, r), s.taken++);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, maxProducts);
}

export const listProducts = (country: CountryCode): Promise<ProductRecord[]> => listCanda(country);
