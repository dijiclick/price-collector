import { cleanGallery, type ProductRecord, type ProductVariants, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { pool } from "./_akinon";

const SITE = "https://www.koton.com";
// Akinon storefront: any category page returns JSON with ?format=json.
// Three trees cover everything we want. Accessories and underwear USED to be
// separate trees (2026-09-24: none of their ~3,750 products was ever stored),
// but by 2026-10-10 they are children of the gender trees — kadin-giyim's own
// category facet lists AKSESUAR 3854 and İÇ GİYİM 1848, exactly the totals of
// /kadin-aksesuar/ and /kadin-ic-giyim/; erkek-giyim lists AKSESUAR 842 =
// /erkek-aksesuar/. The price slicing below reaches them inside their parent.
const CATS = ["kadin-giyim", "erkek-giyim", "cocuk"];
// The crawled category slug IS the section: it maps 1:1 to a gender.
const CAT_GENDER: Record<string, ProductRecord["gender"]> = {
  "kadin-giyim": "kadin",
  "erkek-giyim": "erkek",
  cocuk: "cocuk",
};

const MAX_CATEGORIES = Number(process.env.KOTON_MAX_CATEGORIES ?? CATS.length);
// Akinon caps page_size at 250 (asking for 500 or 1000 answers 250), and a
// 250-row page costs ~1.3x a 100-row one, so the biggest page is the cheapest
// walk. Measured 2026-10-10: kadin-giyim 30057 rows, erkek-giyim 7492, cocuk
// 10743.
const PAGE_SIZE = 250;
// The listing search stops at row 10,000 (Elasticsearch's result window): a
// 30k tree paged plainly yields its first 10k and nothing after, which is how
// a full 2026-10-10 walk came back with exactly 10000 kadin and 10000 cocuk.
// Trees bigger than this are walked as slices of their own `price` facet
// (kadin-giyim: 1.9k / 8.9k / 5.9k / 2.6k / 8.7k), each under the window.
export const RESULT_WINDOW = 10_000;
// Absolute per-listing page ceiling so a lying num_pages can't loop forever.
const MAX_PAGES = Math.min(
  Number(process.env.KOTON_MAX_PAGES ?? Infinity),
  Math.ceil(RESULT_WINDOW / PAGE_SIZE),
);
// Requests in flight at once. Each listing page is ~1-1.5 s server-side, so
// the walk is latency-bound; the rate cap below is what actually paces it.
const CONCURRENCY = Number(process.env.KOTON_CONCURRENCY ?? 4);
// koton.com sits behind an AWS WAF rate rule that answers HTTP 405 + a captcha
// page (`x-amzn-waf-action: captcha`) and keeps doing so for ~5 minutes.
// Measured 2026-10-10 from one IP: ~600 requests in 78 s tripped it, and so did
// ~445 in 170 s at a steady 3 req/s — i.e. it counts requests per window, and
// the ceiling is somewhere around 400 per 5 minutes. A run must therefore stay
// near 350 requests in total: ~200 listing pages + KOTON_DETAIL_LIMIT PDPs.
// The pacer keeps bursts down on top of that.
const RPS = Number(process.env.KOTON_RPS ?? 3);
// Wall-clock budget for the whole adapter, well under the collector's 5-minute
// BRAND_TIMEOUT_MS. The PDP (sizes) pass is the elastic part: it stops when the
// budget runs out and the rest of its sample waits for the next run.
const BUDGET_MS = Number(process.env.KOTON_BUDGET_MS ?? 200_000);

/** Spaces requests at least 1/RPS seconds apart, across all concurrent callers. */
function pacer(rps: number): () => Promise<void> {
  const gap = 1000 / rps;
  let next = 0;
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + gap;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  };
}

/** True for the WAF's captcha/block answer — retrying it only digs deeper. */
const isWafBlock = (err: unknown) => /HTTP (405|403|429) /.test(String((err as Error)?.message ?? err));

/** One Koton crawl: a shared pacer, and a latch that stops everything once the WAF blocks us. */
function session() {
  const wait = pacer(RPS);
  const s = {
    blocked: false,
    async json(url: string, retries: number): Promise<any | null> {
      if (s.blocked) return null;
      await wait();
      try {
        return await getJson<any>(url, { retries });
      } catch (err) {
        if (isWafBlock(err)) s.blocked = true;
        return null;
      }
    },
  };
  return s;
}

export function mapProduct(p: any, gender: ProductRecord["gender"]): ProductRecord | null {
  const pk = p?.pk;
  const price = parseFloat(p?.price); // major units as string, e.g. "1799.99"
  if (!pk || !Number.isFinite(price) || price <= 0) return null;
  const retail = parseFloat(p?.retail_price);
  // `productimage_set` is the PDP gallery of this SKU (one colour); the colour
  // swatch lives apart in `attributes.swatch`, so it never appears here.
  // Inactive rows are images the shop has taken down: kept out of the gallery,
  // and only a last resort for the card image (which predates this filter).
  const all = [...(p.productimage_set ?? [])]
    .filter(Boolean)
    .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
  const shots = all.filter((im: any) => im.status == null || im.status === "active");
  const img = shots[0] ?? all[0];
  return {
    brand: "koton",
    externalId: String(pk),
    name: p.name ?? "",
    url: p.absolute_url ? `${SITE}${p.absolute_url}` : SITE,
    imageUrl: img?.image ?? null,
    images: cleanGallery(
      shots
        .map((im: any) => im.image)
        .filter((u: unknown) => typeof u === "string" && !/\.(mp4|mov|webm)(\?|$)/i.test(u)),
      img?.image ?? null,
    ),
    price: toMinor(price),
    listPrice: Number.isFinite(retail) && retail > price ? toMinor(retail) : null,
    currency: "TRY",
    inStock: p.in_stock === true,
    category: p.attributes?.filterable_kategori ?? p.attributes?.filterable_category ?? null,
    gender,
  };
}

/**
 * Colours + per-size stock from a product's own page (`?format=json`).
 *
 * `variants[]` is a list of attribute groups; sizes live under
 * `integration_size_id` and colours under `integration_color_desc`, each option
 * carrying its own `in_stock`. NB the colour option's `in_stock` is just one
 * SKU's stock, so it is NOT a per-colour aggregate — we only take colour names.
 */
async function fetchVariants(
  crawl: ReturnType<typeof session>,
  absoluteUrl: string,
): Promise<ProductVariants | null> {
  const data = await crawl.json(`${SITE}${absoluteUrl}?format=json`, 0);
  if (!data) return null;
  const groups: any[] = data.variants ?? [];
  const group = (key: string) => groups.find((g) => g?.attribute_key === key)?.options ?? [];

  const seen = new Set<string>();
  const sizes: SizeVariant[] = [];
  for (const o of group("integration_size_id")) {
    const label = String(o?.label ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: o?.in_stock ? "in_stock" : "out_of_stock" });
  }
  const colors: string[] = [
    ...new Set(
      group("integration_color_desc")
        .map((o: any) => String(o?.label ?? "").trim())
        .filter(Boolean) as string[],
    ),
  ];
  if (!sizes.length && !colors.length) return null;
  return { colors, sizes };
}

export const brand = "koton";

/**
 * The `price` facet's slice values (`"0-300"`, …, `"1100"`) from a listing
 * body, used to split a tree too big for the result window. Empty when the
 * facet is missing, so the caller falls back to a plain (window-capped) walk.
 */
export function priceSlices(body: any): string[] {
  const facet = (body?.facets ?? []).find((f: any) => f?.key === "price");
  const choices: any[] = facet?.data?.choices ?? [];
  return choices.map((c) => String(c?.value ?? "").trim()).filter(Boolean);
}

/** Pages to fetch for one listing, from its page-1 pagination, within the window. */
export function pageCount(body: any): number {
  if (!body?.products?.length) return 0;
  const n = Number(body?.pagination?.num_pages ?? 1);
  return Math.max(1, Math.min(Number.isFinite(n) ? n : 1, MAX_PAGES));
}

const listUrl = (cat: string, query: string, page: number) =>
  `${SITE}/${cat}/?format=json&page_size=${PAGE_SIZE}&page=${page}${query}`;

export async function listProducts(): Promise<ProductRecord[]> {
  const started = Date.now();
  const crawl = session();

  // 1. Page 1 of every tree; a tree past the result window is replaced by
  //    page 1 of each of its price slices.
  type Listing = { cat: string; query: string; first: any };
  const cats = CATS.slice(0, MAX_CATEGORIES);
  const listings: Listing[] = [];
  await pool(cats, CONCURRENCY, async (cat) => {
    const first = await crawl.json(listUrl(cat, "", 1), 2);
    const total = Number(first?.pagination?.total_count ?? 0);
    const slices = total > RESULT_WINDOW ? priceSlices(first) : [];
    if (!slices.length) {
      listings.push({ cat, query: "", first });
      return;
    }
    await pool(slices, CONCURRENCY, async (v) => {
      const query = `&price=${encodeURIComponent(v)}`;
      const sliceFirst = await crawl.json(listUrl(cat, query, 1), 2);
      const n = Number(sliceFirst?.pagination?.total_count ?? 0);
      if (n > RESULT_WINDOW) console.warn(`koton: ${cat} price ${v} has ${n} rows; only the first ${RESULT_WINDOW} are reachable`);
      listings.push({ cat, query, first: sliceFirst });
    });
  });

  // 2. Every remaining page of every listing through one bounded, paced pool.
  const rest: { l: Listing; page: number }[] = [];
  for (const l of listings) for (let page = 2; page <= pageCount(l.first); page++) rest.push({ l, page });
  const pages = new Map<string, any[]>();
  await pool(rest, CONCURRENCY, async ({ l, page }) => {
    const data = await crawl.json(listUrl(l.cat, l.query, page), 2);
    pages.set(`${l.cat}${l.query}#${page}`, data?.products ?? []);
  });
  // A walk the WAF cut short is a partial catalogue; returning it would let
  // the delist sweep mark the unseen half out of stock. Fail the brand instead.
  if (crawl.blocked) throw new Error("koton: blocked by the WAF (HTTP 405 captcha) during the listing walk");

  // 3. Merge in a fixed order (not completion order) so a row listed twice
  //    keeps the same gender every run. The first tree wins.
  const byId = new Map<string, ProductRecord>();
  const order = (l: Listing) => cats.indexOf(l.cat);
  for (const l of [...listings].sort((a, b) => order(a) - order(b) || a.query.localeCompare(b.query))) {
    const gender = CAT_GENDER[l.cat] ?? null;
    const bodies = [l.first?.products, ...rest.filter((t) => t.l === l).map((t) => pages.get(`${l.cat}${l.query}#${t.page}`))];
    for (const rows of bodies) {
      for (const p of rows ?? []) {
        const rec = mapProduct(p, gender);
        if (rec && !byId.has(rec.externalId)) byId.set(rec.externalId, rec);
      }
    }
  }

  // Sizes need one PDP call each, so cover a rotating (shuffled) subset of the
  // discounted products per run; the upsert keeps previously-captured variants,
  // so coverage accumulates across runs.
  const records = [...byId.values()];
  // 150, not the old 400: the walk already spends ~200 of the ~400 requests the
  // WAF allows per window (see RPS above). Old runs asked for 400 PDPs, but
  // with retries:0 + catch the blocked ones simply came back empty.
  const limit = Number(process.env.KOTON_DETAIL_LIMIT ?? 150);
  const onSite = records.filter((r) => r.url.startsWith(SITE));
  // Prefer discounted products (they're what the feed shows), but when nothing
  // is on sale keep building coverage from the rest.
  const discounted = onSite.filter((r) => r.listPrice != null);
  const pickFrom = discounted.length > 0 ? discounted : onSite;
  for (let j = pickFrom.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [pickFrom[j], pickFrom[k]] = [pickFrom[k], pickFrom[j]];
  }
  await pool(pickFrom.slice(0, limit), CONCURRENCY, async (r) => {
    // Out of time or blocked: the rest of the sample waits for the next run.
    if (crawl.blocked || Date.now() - started > BUDGET_MS) return;
    const v = await fetchVariants(crawl, r.url.slice(SITE.length));
    if (v) {
      r.variants = v;
      // Listing `in_stock` is one SKU's stock and is often false while other
      // sizes are buyable; the per-size flags are the accurate aggregate.
      if (v.sizes.length > 0) r.inStock = v.sizes.some((s) => s.availability !== "out_of_stock");
    }
  });

  return records;
}
