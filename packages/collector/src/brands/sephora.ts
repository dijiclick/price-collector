import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";

const BASE = "https://www.sephora.com.tr/s/Sephora_TR/dw/shop/v21_10";
/**
 * Env-only, with no baked fallback.
 *
 * The id is a public OCAPI client identifier — anyone can read it out of
 * Sephora's own web app — but it is already supplied as a secret in CI, so a
 * hardcoded copy added nothing except a value that would be published verbatim
 * when this file moved to a public repository. Failing loudly beats quietly
 * requesting with `client_id=undefined` and reading the 403 as "no products".
 */
const clientId = () => {
  const id = process.env.SEPHORA_CLIENT_ID;
  if (!id) throw new Error("SEPHORA_CLIENT_ID is not set — the Sephora adapter cannot build a request without it.");
  return id;
};
const withKey = (path: string) =>
  `${BASE}${path}${path.includes("?") ? "&" : "?"}client_id=${clientId()}`;

const TR_MAP: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };

/**
 * Sephora's canonical PDP URL is /p/{slug}-{pid}.html where slug is the product
 * name lowercased with plain toLowerCase() ("İ" becomes "i" + U+0307 and the
 * combining dot is kept — really), Turkish letters transliterated, and every
 * space turned into a hyphen. Anything else (e.g. the old slugless "/p/-PP…"
 * shape) is rejected by their Akamai WAF even in a real browser.
 */
export function productUrl(name: string, id: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[çğıöşü]/g, (c) => TR_MAP[c])
    .replace(/ /g, "-")
    .replace(/[^a-z0-9̇-]/g, "");
  return `https://www.sephora.com.tr/p/${encodeURIComponent(slug || "urun")}-${id}.html`;
}

function mapHit(h: any): ProductRecord | null {
  const id = String(h.product_id ?? "");
  const listed = h.price;
  if (!id || typeof listed !== "number" || listed <= 0) return null;
  // Two conventions live in this catalog. Usually `price` is what you pay and
  // `c_price` is the higher struck-through original. But some products invert
  // it: `price` is the original and `c_salesPrice` is the reduced one. Reading
  // only the first convention stored the pre-discount figure as the price *and*
  // dropped the deal, so honour whichever field actually undercuts.
  const sale = h.c_salesPrice;
  const discounted = typeof sale === "number" && sale > 0 && sale < listed;
  const price = discounted ? sale : listed;
  /**
   * A master product whose variants are different SIZES reports a price RANGE,
   * not a markdown: `price` is the cheapest variant and `price_max`/`c_price`
   * the dearest. Reading `c_price` as a strikethrough turned every such range
   * into a fake discount — Magic Energy showed "₺1.690, was ₺9.090, -%81" when
   * ₺1.690 is simply the 10 ml and ₺9.090 the 100 ml, and 14 of 14 of Sephora's
   * largest "deals" were this same artifact with no real sale behind any of them.
   *
   * So `c_price` is only an original price when the product has ONE price. When
   * the hit spans a range there is no single was-price to quote, and the honest
   * answer is no discount at all. A genuine sale still comes through the
   * `c_salesPrice` branch above, which is per-variant and unaffected.
   */
  const priceMax = typeof h.price_max === "number" ? h.price_max : h.c_maxPrice;
  const isRange = typeof priceMax === "number" && priceMax > listed;
  const original = discounted ? listed : isRange ? null : h.c_price;
  // Prefer the principal product photo over a colour swatch.
  const imgs: any[] = h.image_groups?.flatMap((g: any) => g.images ?? []) ?? [];
  const principal =
    imgs.find((i) => /principal|media_pr/i.test(i.link ?? ""))?.link ??
    imgs.find((i) => !/swatch/i.test(i.link ?? ""))?.link;
  const img = principal ?? h.image?.link ?? h.image?.disBaseLink ?? null;
  // Search hits carry no image_groups in practice (only `image`), so this is
  // usually [img]; attachGalleries() fills the real gallery afterwards.
  return {
    brand: "sephora",
    externalId: id,
    name: h.product_name ?? "",
    url: productUrl(h.product_name ?? "", id),
    imageUrl: img,
    images: galleryFromGroups(h.image_groups, img),
    price: toMinor(price),
    listPrice: typeof original === "number" && original > price ? toMinor(original) : null,
    currency: "TRY",
    inStock: h.orderable !== false,
    category: typeof h.c_brand === "string" ? h.c_brand : null,
  };
}

const NOT_A_PHOTO = /swatch|thumbnail|video|\.(mp4|webm|mov)(\?|$)/i;
const bare = (u: string) => u.split("?")[0];

/**
 * The PDP gallery from a product's `image_groups`.
 *
 * A master carries one `hi-res` group with no variation_attributes — the photos
 * the master page shows, `media_principal` first, then `media_1..5` — plus, on
 * some products, regional duplicates (`hi-res-AE`, `hi-res-SA`) of the same
 * shots under other file names. Use only the group that holds the principal
 * shot (imageUrl), so every photo is of the same variant and the regional
 * copies never double the gallery; fall back to a plain `hi-res` group. Swatch
 * chips and thumbnails are dropped.
 */
export function galleryFromGroups(groups: any[] | null | undefined, principal: string | null): string[] | null {
  const gs: any[] = Array.isArray(groups) ? groups : [];
  const holds = (g: any) =>
    principal != null && (g?.images ?? []).some((i: any) => typeof i?.link === "string" && bare(i.link) === bare(principal));
  const group =
    gs.find((g) => !g?.variation_attributes && holds(g)) ??
    gs.find(holds) ??
    gs.find((g) => g?.view_type === "hi-res" && !g?.variation_attributes);
  const links = (group?.images ?? [])
    .map((i: any) => i?.link)
    .filter((l: unknown): l is string => typeof l === "string" && !NOT_A_PHOTO.test(l));
  return cleanGallery(links, principal);
}

/** OCAPI's hard cap on ids in one `/products/(…)` call (25 is a 400). */
const DETAIL_BATCH = 24;

/**
 * Search hits only ever carry one `image`, so the gallery needs the product
 * resource. `/products/(id,…)` takes 24 ids per call, and `select` trims the
 * answer to the image links (~22 KB per batch instead of ~245 KB) — about 250
 * small requests for the whole catalogue. Best-effort: a failed batch leaves
 * those products on [imageUrl], and the upsert keeps any gallery stored before.
 */
export async function attachGalleries(recs: ProductRecord[], concurrency: number): Promise<void> {
  const byId = new Map(recs.map((r) => [r.externalId, r]));
  const ids = [...byId.keys()];
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += DETAIL_BATCH) batches.push(ids.slice(i, i + DETAIL_BATCH));
  const select = "(data.(id,image_groups.(view_type,variation_attributes,images.(link))))";
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        const res = await getJson<any>(
          withKey(`/products/(${batch.map(encodeURIComponent).join(",")})?expand=images&select=${select}`),
          { proxy: true },
        ).catch(() => null);
        for (const p of res?.data ?? []) {
          const rec = byId.get(String(p?.id ?? ""));
          if (!rec) continue;
          const g = galleryFromGroups(p.image_groups, rec.imageUrl);
          if (g && g.length > (rec.images?.length ?? 0)) rec.images = g;
        }
      }
    }),
  );
}

/** Exposed for sephora.test.ts — the price mapping is where the fake-discount bug lived. */
export const mapHitForTest = mapHit;

export const brand = "sephora";

export async function listProducts(): Promise<ProductRecord[]> {
  // `cgid=root` returns the whole catalog (verified ~6000 products); leaf brand
  // categories return 0, so we page through root. Cap pages for a bounded run.
  const maxPages = Number(process.env.SEPHORA_MAX_PAGES ?? 40);
  const PAGE_CONCURRENCY = Number(process.env.SEPHORA_CONCURRENCY ?? 8);
  const byId = new Map<string, ProductRecord>();
  // Akamai fronts this host and 403s datacenter IPs ("Access Denied ...
  // Reference #18.x") regardless of user-agent — verified by hand, a browser UA
  // does not help. Route through the residential proxy, the same escape hatch
  // watsons already uses. With DATAIMPULSE_PROXY unset this degrades to a direct
  // request, so local runs behave as before.
  const page = (start: number) =>
    getJson<any>(
      withKey(
        `/product_search?refine=cgid=root&count=200&start=${start}&expand=prices,availability,images`,
      ),
      { proxy: true },
    );
  const absorb = (res: any) => {
    for (const h of res?.hits ?? []) {
      const rec = mapHit(h);
      if (rec) byId.set(rec.externalId, rec);
    }
  };

  // count=200 is the server's hard maximum (201 is a 400), so the catalog is
  // always ~31 requests. Sequentially that ran ~116s against a 240s per-brand
  // timeout — under two minutes of margin for a brand that is otherwise fine.
  // Let a first-page failure throw. Returning [] here meant a WAF block was
  // indistinguishable from "the catalog is empty": the run logged a healthy
  // brand, the upsert wrote nothing, and Sephora quietly went stale. The
  // collector catches per brand and reports `✗ sephora`, which is what a block
  // should look like. Later pages still degrade gracefully below.
  const first = await page(0);
  absorb(first);

  const size = first.count ?? 200;
  const total = Math.min(first.total ?? 0, size * maxPages);
  const offsets: number[] = [];
  for (let start = size; start < total; start += size) offsets.push(start);

  // Past the first page a single failure is a dropped slice, not an outage — the
  // upsert coalesces, so keep whatever the other workers bring back.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PAGE_CONCURRENCY, offsets.length) }, async () => {
      while (next < offsets.length) absorb(await page(offsets[next++]).catch(() => null));
    }),
  );
  const recs = [...byId.values()];
  // The gallery pass (attachGalleries) is OFF: ~250 extra requests a run, some
  // through the paid proxy, and it returns the master product's photos rather
  // than the shade's. Opt in with SEPHORA_GALLERY=1 once that is worth it.
  if (process.env.SEPHORA_GALLERY === "1") await attachGalleries(recs, PAGE_CONCURRENCY);
  return recs;
}
