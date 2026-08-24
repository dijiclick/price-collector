import type { ProductRecord, ProductVariants, SizeVariant, Availability } from "../types";
import { getJson } from "../http";

/**
 * Shared adapter for the Inditex `itxrest` gateway, used by Massimo Dutti,
 * Zara Home, Pull&Bear, Bershka and Stradivarius (only ids/domain differ).
 *
 * Flow: category tree -> leaf category ids -> product ids -> productsArray.
 * The category/product-id endpoints sit behind Akamai and may 403 from
 * datacenter IPs; when that happens we fall back to the server-rendered
 * category page, which embeds the same `"productIds":[...]` arrays (after
 * solving Akamai's simple arithmetic "interstitial" challenge once).
 */

export interface InditexSite {
  brand: string;
  /** e.g. "www.massimodutti.com" */
  domain: string;
  storeId: string;
  catalogId: string;
}

interface InditexCategory {
  id: number;
  name?: string;
  nameEn?: string;
  key?: string;
  categoryUrl?: string;
  subcategories?: InditexCategory[];
  /** Not in the JSON — stamped onto leaves during the tree walk. */
  gender?: ProductRecord["gender"];
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const PRODUCTS_ARRAY_CHUNK = 80;

function api(site: InditexSite, version: number): string {
  return `https://${site.domain}/itxrest/${version}/catalog/store/${site.storeId}/${site.catalogId}`;
}

/**
 * Which section a category (or its ancestors) belongs to. The itxrest tree
 * roots are the storefront sections — "Kadın"/"Woman"/…MUJER…, "Erkek"/"Man"/
 * …HOMBRE… — and that is the only place gender exists (the stored category
 * text holds product types, not sections). Matched over name + nameEn + key so
 * it works across locales; sections with no signal (Landing, home, beauty)
 * stay null — never guessed from product names.
 */
export function genderFromText(text: string): ProductRecord["gender"] {
  // keys use _ and - as separators ("REBAJAS_PULL_MUJER_ROPA") — treat them
  // as word boundaries so \b matches. foldTr doesn't touch ç ("Çocuk"), so
  // fold it here too.
  const t = foldTr(text).replace(/ç/g, "c").replace(/[_\-/|]/g, " ");
  // kids first: "erkek çocuk" (boy) must not read as erkek. \b keeps
  // "boyfriend jean" rails from matching "boy".
  if (/cocuk|bebek|\b(kids?|baby|girls?|boys?|ninos?|ninas?)\b/.test(t)) return "cocuk";
  if (/kadin|\b(wom[ae]n|mujer)\b/.test(t)) return "kadin";
  if (/erkek|\b(m[ae]n|hombre)\b/.test(t)) return "erkek";
  return null;
}

/** Collect leaf categories (nodes with no subcategories), stamping each with
 *  the gender of the nearest section-bearing ancestor (usually the root). */
function leafCategories(
  cats: InditexCategory[],
  inherited: ProductRecord["gender"] = null,
  out: InditexCategory[] = [],
): InditexCategory[] {
  for (const c of cats) {
    const gender =
      genderFromText(`${c.name ?? ""} ${c.nameEn ?? ""} ${c.key ?? ""}`) ?? inherited;
    const subs = c.subcategories ?? [];
    if (subs.length === 0) out.push({ ...c, gender });
    else leafCategories(subs, gender, out);
  }
  return out;
}

async function categoryTree(site: InditexSite): Promise<InditexCategory[]> {
  const base = `${api(site, 2)}/category`;
  try {
    const tree = await getJson<{ categories: InditexCategory[] }>(
      `${base}?languageId=-43&appId=1`,
      { retries: 1 },
    );
    return tree.categories ?? [];
  } catch {
    // Akamai often blocks the appId=1 variant from datacenter IPs while
    // letting the bare one through — retry without it.
    const tree = await getJson<{ categories: InditexCategory[] }>(`${base}?languageId=-43`, {
      retries: 3,
    });
    return tree.categories ?? [];
  }
}

function extractIds(data: any): number[] {
  if (Array.isArray(data?.productIds)) return data.productIds.filter((n: any) => Number(n) > 0);
  if (Array.isArray(data?.products)) {
    return data.products.map((p: any) => Number(p?.id)).filter((n: number) => n > 0);
  }
  if (Array.isArray(data)) return data.map(Number).filter((n) => n > 0);
  return [];
}

async function categoryProductIds(site: InditexSite, cat: InditexCategory): Promise<number[]> {
  // Primary: the JSON listing endpoint.
  try {
    const data = await getJson<any>(
      `${api(site, 3)}/category/${cat.id}/product?languageId=-43&appId=1&showProducts=false`,
      { retries: 1 },
    );
    const ids = extractIds(data);
    if (ids.length > 0) return ids;
  } catch {
    // fall through to the HTML fallback
  }
  // Fallback: the SSR category page embeds "productIds":[...] arrays.
  if (cat.categoryUrl) {
    try {
      const html = await fetchHtml(site.domain, `/tr/${cat.categoryUrl}`);
      const ids = new Set<number>();
      for (const m of html.matchAll(/"productIds":\[([0-9,\s]*)\]/g)) {
        for (const part of m[1].split(",")) {
          const n = Number(part.trim());
          if (n > 0) ids.add(n);
        }
      }
      return [...ids];
    } catch {
      // give up on this category
    }
  }
  return [];
}

/**
 * Best CDN image url from an Inditex product detail's xmedia.
 *
 * The view code in the filename (…-{view}/…-{view}.jpg) tells us what the image
 * is. The real product photos are the model shots ("-a1".."-a5") and packshots
 * ("-m*"/"-e*"/"-p*"/"-c"); we rank those highest. We avoid two kinds of noise
 * that xmedia often lists FIRST: the "-r" (recorte/cutout) view — frequently an
 * empty ~461-byte blank that renders as a blur — and the spec/marketing
 * infographics ("-i"/"-o"/"-t"/"-k"/"-f"/"-x", the dark "Product details /
 * Technicalities" cards on technical items) — which also get appended to the end
 * of the a-series, so the trailing slots are demoted too. Ranking (not just
 * first-non-cutout) is what stops those infographics being chosen as the card
 * image; xmedia order is not stable, so first-match picks them intermittently.
 */
function viewCode(url: string): string {
  return (url.match(/-([a-z]+\d*)\/[^/]+\.(?:jpe?g|png|webp)(?:$|\?)/i)?.[1] ?? "").toLowerCase();
}
function imageScore(url: string): number {
  const v = viewCode(url);
  if (/^a[1-5]$/.test(v)) return 0; // primary model shots
  if (/^(m|e|p|c)\d*$/.test(v)) return 1; // packshots
  if (/^a([6-9]|1[0-2])$/.test(v)) return 2; // secondary model angles
  if (/^d\d*$/.test(v)) return 3; // fabric/detail close-ups — real photography
  if (/^r\d*$/.test(v)) return 9; // cutout placeholder (often blank)
  if (/^(i|o|t|k|f|x)\d*$/.test(v)) return 8; // spec/marketing infographics
  // Trailing gallery slots. Marketing cards get appended to the end of the
  // a-series (on Oysho's technical outerwear "-a13".."-a15" are the dark
  // "Technicalities" panels), so rank them below every view we can name.
  if (/^a\d+$/.test(v)) return 5;
  return 4; // unknown views
}
export function pickImage(detail: any): string | null {
  const urls: string[] = [];
  for (const x of detail?.xmedia ?? []) {
    for (const item of x?.xmediaItems ?? []) {
      for (const media of item?.medias ?? []) {
        const url = media?.url ?? media?.extraInfo?.deliveryUrl;
        if (typeof url === "string" && url.startsWith("http")) urls.push(url);
      }
    }
  }
  if (urls.length === 0) return null;
  return urls.reduce((best, u) => (imageScore(u) < imageScore(best) ? u : best));
}

/**
 * Stock state of a single size.
 *
 * `isBuyable` is TRUE even for sold-out sizes, so it can't be used to detect
 * stock — Inditex marks stock with `visibilityValue`, which is what the site
 * reflects. Observed values across all six brands:
 *   SHOW         → in stock
 *   RUNNING_OUT  → still buyable, "son ürünler" (~12% of sizes — must NOT be
 *                  treated as sold out, or buyable sizes disappear and whole
 *                  products can drop out of the feed)
 *   SOLD_OUT / COMING_SOON → not buyable
 */
export function sizeAvailability(size: any): Availability {
  const vis = typeof size?.visibilityValue === "string" ? size.visibilityValue.toUpperCase() : "";
  if (vis) {
    if (vis === "SHOW") return "in_stock";
    if (vis.includes("RUNNING") || vis.includes("LOW") || vis.includes("FEW")) return "low_on_stock";
    return "out_of_stock";
  }
  const a = size?.availability;
  if (typeof a === "string") {
    if (/out|coming|back|soon/i.test(a)) return "out_of_stock";
    if (/low/i.test(a)) return "low_on_stock";
    return "in_stock";
  }
  return size?.isBuyable === false ? "out_of_stock" : "in_stock";
}

/** True when a size can actually be ordered. */
export const sizeInStock = (size: any): boolean => sizeAvailability(size) !== "out_of_stock";

/** True when any size is orderable; sizeless products (accessories) count as in stock. */
export function anySizeInStock(sizes: any[] | undefined): boolean {
  const list = sizes ?? [];
  return list.length === 0 ? true : list.some(sizeInStock);
}

/**
 * Colours + per-size availability from a product detail. `detail.colors` lists
 * every colour; per-size stock comes from each size's `availability` string
 * (or its `isBuyable` flag). We surface the colour names plus the primary
 * colour's sizes, deduped by label.
 */
export function pickVariants(detail: any): ProductVariants | null {
  const colors = detail?.colors ?? [];
  if (!colors.length) return null;
  // Colour names can repeat across a product's variants — keep them unique.
  const colorNames: string[] = [
    ...new Set(colors.map((c: any) => c?.name).filter(Boolean) as string[]),
  ];

  // A size label appears once per SKU, each with its own stock state — e.g. XS
  // can be listed SOLD_OUT, SHOW, SOLD_OUT. Taking the first entry mislabels a
  // buyable size as sold out, so keep the BEST state across the duplicates.
  const rank: Record<Availability, number> = { in_stock: 2, low_on_stock: 1, out_of_stock: 0 };
  const order: string[] = [];
  const best = new Map<string, Availability>();
  for (const s of colors[0]?.sizes ?? []) {
    const label = String(s?.name ?? "").trim();
    if (!label) continue;
    const availability = sizeAvailability(s);
    const prev = best.get(label);
    if (prev === undefined) {
      order.push(label);
      best.set(label, availability);
    } else if (rank[availability] > rank[prev]) {
      best.set(label, availability);
    }
  }
  const sizes: SizeVariant[] = order.map((label) => ({ label, availability: best.get(label)! }));
  if (colorNames.length === 0 && sizes.length === 0) return null;
  return { colors: colorNames, sizes };
}

function mapProduct(
  site: InditexSite,
  p: any,
  category: string | null,
  gender: ProductRecord["gender"] = null,
): ProductRecord | null {
  if (!p?.id) return null;
  // Products come wrapped as "bundles"; the real product (with detail.colors)
  // is bundleProductSummaries[0]. Some brands return it unwrapped.
  const real = p.bundleProductSummaries?.[0] ?? p;
  const detail = real?.detail;
  const color = detail?.colors?.[0];
  if (!color) return null;

  // Cheapest size of the first color. Key on sku — size *names* repeat.
  const seenSkus = new Set<number>();
  let price = Infinity;
  let listPrice: number | null = null;
  for (const s of color.sizes ?? []) {
    if (s?.sku == null || seenSkus.has(s.sku)) continue;
    seenSkus.add(s.sku);
    const v = Number(s.price); // already integer minor units, e.g. "65000" = 650.00
    if (!Number.isFinite(v) || v <= 0) continue;
    if (v < price) {
      price = v;
      const old = s.oldPrice == null ? NaN : Number(s.oldPrice);
      listPrice = Number.isFinite(old) && old > v ? old : null;
    }
  }
  if (!Number.isFinite(price)) return null;

  const name: string | undefined = real?.name ?? p.name;
  if (!name) return null;

  const slug: string | undefined = p.productUrl ?? real?.productUrl;
  const url = slug
    ? `https://${site.domain}/tr/${encodeURI(slug)}`
    : `https://${site.domain}/tr/-l${detail?.displayReference ?? p.id}`;

  // Product-level id: the same garment ships as one bundle id per COLOUR (same
  // url, e.g. …-l00808111). Key on the shared "l{ref}" from the url so colours
  // collapse to one row instead of duplicating the product across the feed.
  const ref = slug?.match(/-l(\d+)/i)?.[1];
  const externalId = ref
    ? "l" + ref
    : detail?.displayReference
    ? String(detail.displayReference).replace(/\D/g, "")
    : String(p.id);

  return {
    brand: site.brand,
    externalId,
    name,
    url,
    imageUrl: pickImage(detail),
    price,
    listPrice,
    currency: "TRY",
    inStock: anySizeInStock(color.sizes),
    category,
    gender,
    variants: pickVariants(detail),
  };
}

/** Turkish-safe lowercase so "İNDİRİM" matches "indirim". */
const foldTr = (s: string) =>
  s.replace(/[İIı]/g, "i").replace(/[Şş]/g, "s").replace(/[Ğğ]/g, "g").toLowerCase();

/**
 * Order categories so markdowns come first: sale rails, then everything else,
 * with "new in"/editorial last (those never carry discounts). Only load-bearing
 * when a cap is set, but it also decides which duplicate wins a collision.
 *
 * The url matters as much as the name. Pull&Bear's 28 real sale rails are named
 * "Tümünü görüntüle" or just the garment, and are only identifiable as sale by
 * their `/indirim/` path — ranking on the name alone scored none of them as
 * sale, while seven identical "Karıştır ve Eşleştir %10 indirim" widgets did
 * rank top and filled every slot. That is how the brand ended up collecting 34
 * products and zero deals.
 */
function categoryRank(name: string, categoryUrl?: string): number {
  const n = foldTr(`${name} ${categoryUrl ?? ""}`);
  if (/indirim|sale|outlet|rebaja|%/.test(n)) return 0;
  if (/yeni|new|editorial|lookbook/.test(n)) return 2;
  return 1;
}

/**
 * Categories are fetched with a small worker pool. Sequentially the full tree
 * takes ~200s for Massimo Dutti (867 leaves) against a 240s per-brand timeout,
 * and a timeout collects nothing at all. Verified at concurrency 5, 8 and 10
 * across all four sites with zero 403/429 and identical product counts; 8 is
 * the setting that keeps the slowest brand comfortably clear (124s -> 50s).
 */
const CATEGORY_CONCURRENCY = Number(process.env.INDITEX_CONCURRENCY ?? 8);

export function makeInditexAdapter(site: InditexSite): () => Promise<ProductRecord[]> {
  return async function listProducts(): Promise<ProductRecord[]> {
    // 0 = the whole tree. This used to default to 6 leaves, which for Pull&Bear
    // meant six near-identical bundle-widget rails: 34 products, no discounts.
    const maxCategories = Number(process.env.INDITEX_MAX_CATEGORIES ?? 0);
    const all = leafCategories(await categoryTree(site))
      .filter((c) => c.id && c.categoryUrl && c.name && !/^empty$/i.test(c.name))
      // stable sort keeps the site's own order within each rank
      .sort((a, b) => categoryRank(a.name!, a.categoryUrl) - categoryRank(b.name!, b.categoryUrl));
    const leaves = maxCategories > 0 ? all.slice(0, maxCategories) : all;

    const byId = new Map<string, ProductRecord>();
    // Categories overlap heavily, so skipping ids another worker already pulled
    // is what makes the full tree affordable — it cut Pull&Bear from 627 API
    // calls to 436 with no change in the product count.
    const requested = new Set<string>();
    let next = 0;

    await Promise.all(
      Array.from({ length: Math.min(CATEGORY_CONCURRENCY, leaves.length) }, async () => {
        while (next < leaves.length) {
          const cat = leaves[next++];
          // number[], not string[]: these ids arrive as JSON numbers and every
          // use below coerces (String(id), join(",")), so the old annotation was
          // a lie that only survived because packages/ is outside the web
          // tsconfig. The public collector repo typechecks this file.
          let ids: number[];
          try {
            ids = await categoryProductIds(site, cat);
          } catch {
            continue; // a dead category shouldn't stop the crawl
          }
          const fresh = ids.filter((id) => !requested.has(String(id)));
          for (const id of fresh) requested.add(String(id));
          for (let i = 0; i < fresh.length; i += PRODUCTS_ARRAY_CHUNK) {
            const csv = fresh.slice(i, i + PRODUCTS_ARRAY_CHUNK).join(",");
            try {
              const data = await getJson<any>(
                `${api(site, 3)}/productsArray?productIds=${csv}&languageId=-43&appId=1`,
              );
              for (const p of data.products ?? []) {
                const rec = mapProduct(site, p, cat.name ?? null, cat.gender ?? null);
                const prev = byId.get(rec?.externalId ?? "");
                if (rec && !prev) byId.set(rec.externalId, rec);
                // A sectionless rail (Landing/sale widget) can win the dedupe
                // race — backfill gender when a sectioned category sees the
                // same product later in the run.
                else if (prev && prev.gender == null && cat.gender != null) prev.gender = cat.gender;
              }
            } catch {
              // skip a failing chunk; keep going
            }
          }
        }
      }),
    );
    return [...byId.values()];
  };
}

/* ------------------------------------------------------------------ */
/* Akamai-interstitial-aware HTML fetch (used only for the fallback). */
/* ------------------------------------------------------------------ */

const jars = new Map<string, Map<string, string>>(); // domain -> cookie name -> value

function jarFor(domain: string): Map<string, string> {
  let jar = jars.get(domain);
  if (!jar) {
    jar = new Map();
    jars.set(domain, jar);
  }
  return jar;
}

function cookieHeader(domain: string): string {
  return [...jarFor(domain)].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(domain: string, res: Response): void {
  const jar = jarFor(domain);
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const pair = sc.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

async function rawGet(domain: string, url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "tr-TR,tr;q=0.9",
      ...(jarFor(domain).size > 0 ? { Cookie: cookieHeader(domain) } : {}),
    },
  });
  storeCookies(domain, res);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/**
 * Fetch an HTML page, transparently solving Akamai's "interstitial"
 * challenge (a bm-verify token plus a trivial arithmetic proof-of-work).
 */
async function fetchHtml(domain: string, path: string): Promise<string> {
  const url = `https://${domain}${path}`;
  let html = await rawGet(domain, url);
  const bm = html.match(/"bm-verify": "([^"]+)"/);
  if (!bm) return html;

  const base = html.match(/var i = (\d+)/);
  const add = html.match(/Number\("(\d+)" \+ "(\d+)"\)/);
  if (!base || !add) throw new Error(`unsolvable Akamai interstitial at ${url}`);
  const pow = Number(base[1]) + Number(add[1] + add[2]);

  const res = await fetch(`https://${domain}/_sec/verify?provider=interstitial`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/json",
      ...(jarFor(domain).size > 0 ? { Cookie: cookieHeader(domain) } : {}),
    },
    body: JSON.stringify({ "bm-verify": bm[1], pow }),
  });
  storeCookies(domain, res);

  html = await rawGet(domain, url);
  if (html.includes('"bm-verify"')) throw new Error(`Akamai interstitial persisted at ${url}`);
  return html;
}
