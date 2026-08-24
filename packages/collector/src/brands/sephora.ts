import type { ProductRecord } from "../types";
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
  const original = discounted ? listed : h.c_price;
  // Prefer the principal product photo over a colour swatch.
  const imgs: any[] = h.image_groups?.flatMap((g: any) => g.images ?? []) ?? [];
  const principal =
    imgs.find((i) => /principal|media_pr/i.test(i.link ?? ""))?.link ??
    imgs.find((i) => !/swatch/i.test(i.link ?? ""))?.link;
  const img = principal ?? h.image?.link ?? h.image?.disBaseLink ?? null;
  return {
    brand: "sephora",
    externalId: id,
    name: h.product_name ?? "",
    url: productUrl(h.product_name ?? "", id),
    imageUrl: img,
    price: toMinor(price),
    listPrice: typeof original === "number" && original > price ? toMinor(original) : null,
    currency: "TRY",
    inStock: h.orderable !== false,
    category: typeof h.c_brand === "string" ? h.c_brand : null,
  };
}

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
  return [...byId.values()];
}
