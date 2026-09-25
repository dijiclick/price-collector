import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { blanketPromotionPct, revertBlanketPromotion } from "../normalize";

const API = "https://api.gratis.retter.io/1oakekr4e/CALL";
const ORIGIN = { Origin: "https://www.gratis.com" };
const PAGE_SIZE = 200;

interface GratisCategory {
  id: string;
  name?: string;
  subCategories?: GratisCategory[];
}

interface Leaf {
  id: string;
  gender: ProductRecord["gender"];
}

/**
 * Collect leaf category ids (nodes with no subCategories) from the tree.
 * Cosmetics carry no gender, except the Bebek/Çocuk branches: any leaf under a
 * node whose own name says baby/kids is stamped "cocuk" (the flag inherits down,
 * since the leaves themselves are named "Şampuan", "Bebek Bezi", ...).
 */
function leafIds(cats: GratisCategory[], kids = false, out: Leaf[] = []): Leaf[] {
  for (const c of cats) {
    const isKids = kids || /bebek|çocuk|cocuk/i.test(c.name ?? "");
    const subs = c.subCategories ?? [];
    if (subs.length === 0) out.push({ id: c.id, gender: isKids ? "cocuk" : null });
    else leafIds(subs, isKids, out);
  }
  return out;
}

/** Base64 search payload; keys kept sorted (filters, from, searchTerm, size). */
function searchData(catId: string, from: number): string {
  const payload = {
    query: {
      filters: [{ filterId: "categories", filterValues: [catId] }],
      from,
      searchTerm: "",
      size: PAGE_SIZE,
    },
  };
  return encodeURIComponent(Buffer.from(JSON.stringify(payload)).toString("base64"));
}

/**
 * Shade/colour variants of one product each ship as their own Gratis id but
 * share a `variants.values` list of sibling ids. The smallest id is a stable
 * key for the whole group, so the feed can collapse them into one card.
 */
function groupKey(p: any): string | null {
  const ids = (p.variants?.values ?? [])
    .map((v: any) => String(v?.id ?? ""))
    .filter(Boolean);
  if (ids.length < 2) return null;
  return "gratis:" + ids.sort()[0];
}

/**
 * What a shopper actually pays at the shelf — NOT the Gratis Kart price.
 *
 * Every product in the search response carries a `promotionPrice` labelled
 * "Gratis Kart Fiyatı" / "Gratis Kart ile": the loyalty-card price. (Sampled
 * live 2026-09-25: 1,224 of 1,224 products carried that label, and on 217 of
 * them it undercut the shelf price.) This adapter used to take it as `price`,
 * which is how the app's first onboarding card came to lead with a Gratis
 * "−89%" whose shelf price was ₺364 — a figure no one pays without the card.
 *
 * It is also what produced the recurring mass fake drops. Gratis switches
 * card-only campaigns on at 00:00 and off at 09:00 Turkish time, and on
 * 2026-09-23 21:29Z the card price of 3,271 products fell to exactly half the
 * shelf price (2,916 of them at −50% on the nose) and came back at 06:44Z the
 * next morning — one price_drop and one price_rise per product, and pushes to
 * anyone tracking them. The same 50%-on/50%-off pair appears ~a dozen times in
 * September's events. None of it was a shelf price.
 *
 * So the price is `discountedPrice` (the shelf price, which carries Gratis's
 * own real markdowns), and the list price is `normalPrice` when that is
 * genuinely higher. `promotionPrice` is ignored entirely.
 */
export function payablePrice(prices: any): { price: number; list: number | null } | null {
  const normal: unknown = prices?.normalPrice;
  const shelf: unknown = prices?.discountedPrice ?? normal;
  if (typeof shelf !== "number" || shelf <= 0) return null;
  const list = typeof normal === "number" && normal > shelf ? normal : null;
  return { price: shelf, list };
}

function mapProduct(p: any, gender: ProductRecord["gender"]): ProductRecord | null {
  const id = String(p.id ?? "");
  // Gratis prices are already integer minor units (84800 = 848,00 ₺).
  const money = payablePrice(p.prices ?? {});
  if (!id || !money) return null;
  const current = money.price;
  // The listing already carries the tag code, so scanning a Gratis product in a
  // shop matches without the collector making a single extra request. Same
  // shape as boyner and rossmann: digits only, and a plausible EAN length or
  // nothing — a half-read code is worse than none, because it would match the
  // wrong product rather than fail.
  const ean = String(p.attributes?.eanUpc ?? "").replace(/\D/g, "");
  return {
    brand: "gratis",
    externalId: id,
    barcodes: ean.length >= 8 && ean.length <= 14 ? [ean] : null,
    name: p.attributes?.displayName ?? "",
    // `/p-<id>` is a 404 on gratis.com; any slug before `-p-<id>` 308s to the
    // canonical page (verified 2026-09-24), so the fallback carries one.
    url: p.shareLink ?? `https://www.gratis.com/urun-p-${id}`,
    imageUrl: p.imageUrls?.[0]?.fileUrl ?? null,
    price: current,
    listPrice: money.list,
    currency: "TRY",
    inStock: p.stockStatus != null && p.stockStatus !== "NONE",
    category: p.attributes?.categories?.at(-1) ?? null,
    gender,
    groupKey: groupKey(p),
    colorName: p.attributes?.colorName ?? null,
  };
}

export const brand = "gratis";

/**
 * Gratis has 376 leaf categories; we were visiting 30 of them, which cost about
 * two thirds of the catalog. Raising the cap alone makes things worse, not
 * better: crawled sequentially the full tree takes ~413s — past the 240s
 * per-brand timeout — and the search endpoint rate-limits under sustained load,
 * so pages start failing and the run burns its budget waiting them out.
 * A small pool is what makes full coverage viable;
 * concurrency 3 completes in ~17s with every request answering 200, while 6
 * draws hundreds of failures.
 */
const CATEGORY_CONCURRENCY = Number(process.env.GRATIS_CONCURRENCY ?? 3);

/**
 * Even at concurrency 3 the search endpoint intermittently 403s mid-crawl:
 * Gratis rate-limits in ~45s windows (no Retry-After header), far longer than
 * getJson's 0.5s/1s retries. The old code swallowed those failures
 * (`.catch(() => null)` → `break`), silently dropping the rest of the category
 * — per-run coverage swung 8.9k–12.4k and each dip mass-delisted products that
 * reappeared next run. So: wait out the window, and if a page still fails,
 * THROW. A thrown brand is treated as transient by the collector (no delist
 * sweep), which is safe; a quietly truncated one is not.
 */
const PAGE_BACKOFF_MS = [15_000, 30_000, 45_000];

/** A page with no rows while itemCount says more remain is a partial answer. */
export function isTruncatedPage(res: { data?: unknown[]; itemCount?: number }, from: number): boolean {
  return (res.data ?? []).length === 0 && (res.itemCount ?? 0) > from;
}

async function fetchPage(catId: string, from: number): Promise<any> {
  const url =
    `${API}/Search/search/default?__isbase64=true&__culture=tr_TR&__platform=WEB` +
    `&data=${searchData(catId, from)}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await getJson<any>(url, { headers: ORIGIN });
      if (isTruncatedPage(res, from)) {
        throw new Error(`gratis: empty page at from=${from} of cat ${catId} (itemCount ${res.itemCount})`);
      }
      return res;
    } catch (err) {
      if (attempt >= PAGE_BACKOFF_MS.length) throw err;
      await new Promise((r) => setTimeout(r, PAGE_BACKOFF_MS[attempt]));
    }
  }
}

export async function listProducts(): Promise<ProductRecord[]> {
  const maxCategories = Number(process.env.GRATIS_MAX_CATEGORIES ?? 0);
  const tree = await getJson<{ categories: GratisCategory[] }>(
    `${API}/ProductContentManager/getCategoryTree/default`,
    { headers: ORIGIN },
  );
  const all = leafIds(tree.categories ?? []);
  const leaves = maxCategories > 0 ? all.slice(0, maxCategories) : all;

  const byId = new Map<string, ProductRecord>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CATEGORY_CONCURRENCY, leaves.length) }, async () => {
      while (next < leaves.length) {
        const { id: catId, gender } = leaves[next++];
        let from = 0;
        let itemCount = 0;
        do {
          const res = await fetchPage(catId, from);
          const list: any[] = res.data ?? [];
          for (const p of list) {
            const rec = mapProduct(p, gender);
            if (!rec) continue;
            // Products live in several leaves; a kids leaf outranks a plain one.
            if (!rec.gender) rec.gender = byId.get(rec.externalId)?.gender ?? null;
            byId.set(rec.externalId, rec);
          }
          if (list.length === 0) break;
          itemCount = res.itemCount ?? 0;
          from += PAGE_SIZE;
        } while (from < itemCount);
      }
    }),
  );
  const recs = [...byId.values()];
  // Belt and braces for the overnight pattern above: if the shelf field ever
  // starts carrying a catalogue-wide card campaign too, a third of the store at
  // one exact percent is a promotion, not a markdown.
  const blanket = blanketPromotionPct(recs);
  if (blanket != null) {
    const n = revertBlanketPromotion(recs, blanket);
    console.warn(`gratis: ${n} products at a blanket -${blanket}% — kept at shelf price`);
  }
  return recs;
}
