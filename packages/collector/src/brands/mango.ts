import type { ProductRecord, SizeVariant, Availability } from "../types";
import { getJson, getText } from "../http";
import { toMinor } from "../normalize";

const SITE = "https://shop.mango.com";
const ORCH = "https://online-orchestrator.mango.com";
// The orchestrator (Akamai) rejects bare requests; browser-ish Origin/Referer are required.
const HEADERS = {
  Accept: "application/json",
  Origin: SITE,
  Referer: `${SITE}/`,
};

// Full-sale-catalog mode: ~6k products x 2 light orchestrator calls each. The
// calls are CDN-fast (~50ms measured at concurrency 12), so 16 products
// in-flight (32 requests) clears ~6k products well inside the collector's
// 4-minute brand budget. MAX_PRODUCTS is a safety cap, not a working limit.
const MAX_PRODUCTS = Number(process.env.MANGO_MAX_PRODUCTS ?? 8000);
const MAX_SEED_CATEGORIES = Number(process.env.MANGO_MAX_SEED_CATEGORIES ?? 4);
const CONCURRENCY = Number(process.env.MANGO_CONCURRENCY ?? 16);
// If more than this share of seeded products fail their price fetch, the run
// is broken (Akamai block, API change) — throw rather than ship a shard.
const MAX_FAILURE_RATIO = 0.1;

/** One colour-level entry of a PLP's catalogItemsData flight payload. */
interface CatalogItem {
  productId: string;
  colorId: string;
  sizes: string[];
  price: number;
  portraitId: string;
  index: number;
}

/**
 * Mango has no batch catalog JSON API (v3/prices and v4/products both take
 * exactly one productId — probed: repeated params are ignored, comma lists
 * 400), BUT the *filtered* PLP at /tr/tr/c/f/<category> server-renders the
 * ENTIRE category item list in its RSC flight data: `catalogItemsData` holds
 * one entry per (productId, colorId) with the CURRENT price, size list and
 * image portraitId — ~5k entries for the women's sale category in one HTML
 * response. What it lacks is the product name, URL slug and crossed-out
 * price, so each product still needs one v3/prices + one v4/products call
 * (2 instead of the previous 3 — per-size stock now comes from the PLP).
 */
export function parseCatalogItems(html: string): CatalogItem[] {
  // The flight data contains TWO catalogItemsData arrays: one with ~20 fully
  // rendered first-page items (keyed by `reference`, no productId) and one
  // with the ENTIRE category as compact {productId, colorId, price, sizes,
  // portraitId} entries. We want the compact one — scan every occurrence and
  // keep the largest array whose entries carry a productId.
  const marker = '\\"catalogItemsData\\":[';
  let best: any[] = [];
  let from = 0;
  for (;;) {
    const start = html.indexOf(marker, from);
    if (start < 0) break;
    from = start + marker.length;
    // Bracket-scan the escaped JSON array (entries are flat objects whose
    // only nested arrays are `sizes` and `families`).
    let depth = 0;
    let end = -1;
    for (let i = start + marker.length - 1; i < html.length; i++) {
      const ch = html[i];
      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end < 0) throw new Error("mango: unterminated catalogItemsData array");
    const raw = html.slice(start + marker.length - 1, end).replace(/\\"/g, '"');
    let parsed: any[];
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`mango: catalogItemsData did not parse as JSON: ${err}`);
    }
    const withIds = parsed.filter(
      (e) => e && typeof e.productId === "string" && /^\d{6,}$/.test(e.productId),
    );
    if (withIds.length > best.length) best = withIds;
  }
  if (best.length === 0) {
    throw new Error("mango: no catalogItemsData entries with productId in PLP flight data");
  }
  return best.map((e) => ({
      productId: e.productId,
      colorId: String(e.colorId ?? ""),
      sizes: Array.isArray(e.sizes) ? e.sizes.map(String) : [],
      price: typeof e.price === "number" ? e.price : 0,
      portraitId: String(e.portraitId ?? ""),
      index: typeof e.index === "number" ? e.index : 0,
    }));
}

/** One product seeded from the PLPs: its id plus the colours listed on sale. */
interface Seed {
  id: string;
  /** Colour entries in PLP order (first = the colour the grid card shows). */
  colors: CatalogItem[];
  /** Section of the sale PLP the product was seeded from (/kadin/, /erkek/, ...). */
  gender?: ProductRecord["gender"];
}

/** Section from a PLP path: /tr/tr/c/<section>/... — the crawl context. */
function pathGender(path: string): ProductRecord["gender"] {
  const section = path.replace("/tr/tr/c/", "").split("/")[0] ?? "";
  if (section === "kadin") return "kadin";
  if (section === "erkek") return "erkek";
  if (section.includes("cocuk") || section === "kids" || section === "teen") return "cocuk";
  return null;
}

async function seedProducts(max: number): Promise<Seed[]> {
  const home = await getText(`${SITE}/tr/tr`, { headers: { Accept: "text/html" } });
  const catPaths = new Set<string>();
  for (const m of home.matchAll(/\/tr\/tr\/c\/[a-zA-Z0-9/_-]+/g)) catPaths.add(m[0]);

  // Sale categories only; women first (primary audience), then men, then rest.
  const segRank = (p: string) => (p.includes("/kadin/") ? 0 : p.includes("/erkek/") ? 1 : 2);
  const salePaths = [...catPaths]
    .filter((p) => p.includes("indirim"))
    .sort((a, b) => segRank(a) - segRank(b) || a.localeCompare(b))
    .slice(0, MAX_SEED_CATEGORIES);
  if (salePaths.length === 0) throw new Error("mango: no sale category links on homepage");

  const byId = new Map<string, Seed>();
  for (const path of salePaths) {
    if (byId.size >= max) break;
    // /tr/tr/c/kadin/... -> /tr/tr/c/f/kadin/... (filtered PLP; embeds all items)
    const url = `${SITE}${path.replace("/tr/tr/c/", "/tr/tr/c/f/")}`;
    // A failed page must THROW, not silently shrink the catalog to whatever
    // loaded — the collector treats a truncated-but-nonzero run as success.
    const html = await getText(url, { headers: { Accept: "text/html" } });
    const items = parseCatalogItems(html);
    // Group colour entries per product, deterministically ordered by numeric
    // id within the category so the subset kept under the cap is stable
    // run-to-run.
    const perProduct = new Map<string, CatalogItem[]>();
    for (const item of items) {
      const list = perProduct.get(item.productId);
      if (list) list.push(item);
      else perProduct.set(item.productId, [item]);
    }
    const gender = pathGender(path);
    for (const id of [...perProduct.keys()].sort((a, b) => Number(a) - Number(b))) {
      if (!byId.has(id)) {
        const colors = perProduct.get(id)!.sort((a, b) => a.index - b.index);
        byId.set(id, { id, colors, gender });
      }
    }
  }
  if (byId.size === 0) throw new Error("mango: sale PLPs yielded zero product ids");
  return [...byId.values()].slice(0, max);
}

/**
 * Pick the real product photo for a colour.
 *
 * NOT `bulletImg` — that is the colour swatch, and it used to win here. A swatch
 * is a flat patch of the garment's colour, so the feed rendered pale products as
 * blank squares: `27093335-11-020` for "Pastel Sarı" is a plain cream 200x200
 * with no garment in it at all. Swatches also cap at 200px, which upscales to
 * mush in a grid cell ~570px wide on a 3x phone.
 *
 * `looks` is keyed by look id, and each look's `images` is keyed by view code:
 *   O1 = "Genel plan" (model, full length) — what Mango's own grid shows
 *   B  = "Modelsiz ürün" (garment alone)
 *   F  = "Orta plan", D0/D1 = detail crops — too tight to identify a product
 * Prefer the model shot, fall back to the garment-only shot, then any view.
 */
export function lookImage(color: any): string | null {
  const looks = color?.looks;
  if (!looks || typeof looks !== "object") return null;
  for (const look of Object.values<any>(looks)) {
    const images = look?.images;
    if (!images || typeof images !== "object") continue;
    const pick = images.O1?.img ?? images.B?.img ?? Object.values<any>(images)[0]?.img;
    if (typeof pick === "string" && pick) return pick;
  }
  return null;
}

/**
 * Scene7 serves a 200x200 thumbnail for a bare asset path, so every URL needs an
 * explicit rendition. 480x672 is the grid cell's 5:7 aspect. `wid` alone is not
 * enough — it stretches width while leaving height at 200.
 */
export function withRendition(path: string | null, assets: string): string | null {
  if (!path) return null;
  const url = path.startsWith("http") ? path : `${assets}${path}`;
  return url.includes("?") ? url : `${url}?wid=480&hei=672&fit=crop`;
}

/**
 * Build one ProductRecord from a seed + its two orchestrator responses.
 * `prices` is keyed by colorId; `detail` may be null (name/url degrade).
 */
export function buildRecord(
  seed: Seed,
  prices: Record<string, any>,
  detail: any,
): ProductRecord | null {
  const lead = seed.colors[0];
  // Prefer the colour the PLP grid shows; fall back to any priced colour.
  const priceEntry =
    prices[lead.colorId] ??
    Object.values(prices).find((v: any) => v && typeof v.price === "number");
  if (!priceEntry || typeof priceEntry.price !== "number" || priceEntry.price <= 0) return null;

  const orig = priceEntry.previousPrices?.originalShop;
  const colors: any[] = detail?.colors ?? [];
  const ownColor = colors.find((c: any) => String(c?.id) === lead.colorId) ?? colors[0];

  // Per-size labels come from the detail response; the PLP's size list for
  // this colour is the set actually sellable right now.
  const plpSizes = new Set(lead.sizes);
  const sizes: SizeVariant[] = (ownColor?.sizes ?? [])
    .map((s: any) => ({
      label: String(s?.label ?? "").trim(),
      availability: (plpSizes.has(String(s?.label ?? "").trim())
        ? "in_stock"
        : "out_of_stock") as Availability,
    }))
    .filter((s: SizeVariant) => s.label);
  const fallbackSizes: SizeVariant[] = lead.sizes.map((label) => ({
    label,
    availability: "in_stock" as Availability,
  }));
  const sizeList = sizes.length > 0 ? sizes : fallbackSizes;
  const colorNames: string[] = [
    ...new Set(colors.map((c: any) => c?.label).filter(Boolean) as string[]),
  ];

  const assets = detail?.assetsDomain ?? "https://media.mango.com";
  // The PLP grid image is deterministic: /is/image/punto/<id>-<color>-<portrait>
  const constructed =
    lead.portraitId && lead.colorId
      ? `https://media.mango.com/is/image/punto/${seed.id}-${lead.colorId}-${lead.portraitId}`
      : null;
  const imageUrl = withRendition(lookImage(ownColor) ?? constructed, assets);

  const family =
    detail?.families?.find((f: any) => f.isMainFamily)?.label ??
    detail?.families?.[0]?.label ??
    null;

  return {
    brand: "mango",
    externalId: seed.id,
    name: detail?.name ?? `Mango ${seed.id}`,
    url: detail?.url ? `${SITE}${detail.url}` : `${SITE}/tr/tr`,
    imageUrl,
    price: toMinor(priceEntry.price),
    listPrice: typeof orig === "number" && orig > priceEntry.price ? toMinor(orig) : null,
    currency: "TRY",
    // Listed on the filtered sale PLP with at least one sellable size.
    inStock: sizeList.some((s) => s.availability !== "out_of_stock"),
    category: family,
    gender: seed.gender ?? null,
    colorName: ownColor?.label ?? (lead.colorId || null),
    variants: sizeList.length > 0 || colorNames.length > 0 ? { colors: colorNames, sizes: sizeList } : null,
  };
}

/** Fetch prices (required) + detail (best-effort) for one seeded product. */
async function fetchOne(seed: Seed): Promise<ProductRecord | null> {
  const [prices, detail] = await Promise.all([
    getJson<Record<string, any>>(
      `${ORCH}/v3/prices/products?channelId=shop&countryIso=TR&productId=${seed.id}`,
      { headers: HEADERS, retries: 1 },
    ).catch(() => null),
    // NB: v4's language param is `languageIso` (v3 detail's was `language`).
    getJson<any>(
      `${ORCH}/v4/products?channelId=shop&countryIso=TR&languageIso=tr&productId=${seed.id}`,
      { headers: HEADERS, retries: 1 },
    ).catch(() => null),
  ]);
  if (!prices) return null; // discontinued / bogus id scraped from HTML
  return buildRecord(seed, prices, detail);
}

/** Run `fn` over `items` with bounded concurrency. */
async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

export const brand = "mango";

export async function listProducts(): Promise<ProductRecord[]> {
  const seeds = await seedProducts(MAX_PRODUCTS);
  const byId = new Map<string, ProductRecord>();
  let failures = 0;
  await pool(seeds, CONCURRENCY, async (seed) => {
    const rec = await fetchOne(seed);
    if (rec) byId.set(rec.externalId, rec);
    else failures++;
  });
  // A few nulls are normal (ids linger in flight data after delisting), but a
  // large share means the orchestrator is rejecting us — fail the run loudly
  // instead of shipping a silently truncated catalog.
  if (failures > seeds.length * MAX_FAILURE_RATIO) {
    throw new Error(
      `mango: ${failures}/${seeds.length} products failed price fetch — aborting run`,
    );
  }
  if (byId.size === 0) throw new Error("mango: zero products built from sale PLP seeds");
  return [...byId.values()];
}
