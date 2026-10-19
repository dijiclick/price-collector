import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson, getText } from "../http";
import { toMinor } from "../normalize";

/**
 * Derimod — Shopify (`derimod.com.tr`, the www host 301s to the bare one).
 * `/products.json?limit=250&page=N` is the whole catalogue with per-variant
 * `price`, `compare_at_price` and `available`; options are `Renk` / `Beden`.
 *
 * There is an `indirimli-urunler` collection, but it held 291 products while
 * the first 3,750 catalogue rows alone carried 1,646 with a compare-at price
 * (2026-10-10) — so the catalogue is walked and the reduced rows kept.
 *
 * Shopify rate-limits this storefront hard: three back-to-back pages answered
 * `local_rate_limited` on the fourth.
 *
 * FULL CATALOGUE (2026-10-19): `/products.json` is ~27,000 products, ~21,000
 * of them sold-out old seasons, so walking it (110 pages at the pause it
 * needs) takes over four minutes. Instead the walk asks the shop's public
 * Storefront API for `available_for_sale:true` products only:
 *
 *   POST /api/2024-10/graphql.json   X-Shopify-Storefront-Access-Token: <token>
 *
 * The token is the storefront's own public one, printed in every page's
 * `shopify-features` JSON (`accessToken`), read fresh each run. 250 products a
 * page: 5,785 in-stock products in 24 requests, ~30 s (2026-10-19). Checked
 * against a /products.json walk the same hour: all 5,606 in-stock products of
 * its first 100 pages were in the Storefront set (it then hit the rate limit;
 * the other 179 sit deeper). Each node is reshaped into the /products.json
 * form, so `mapDerimod` — sizes, colours, gender, prices — is unchanged:
 * reduced rows keep `compare_at_price`, the rest are full-price rows.
 */
export const SITE = "https://derimod.com.tr";
const MAX_PRODUCTS = Number(process.env.DERIMOD_MAX_PRODUCTS ?? 15_000);
/** 24 pages of 250 today; room for the in-stock catalogue to double. */
const MAX_PAGES = Number(process.env.DERIMOD_MAX_PAGES ?? 60);
const PAUSE_MS = Number(process.env.DERIMOD_PAUSE_MS ?? 500);
/** The storefront's public token as of 2026-10-19, if the home page ever stops printing it. */
export const FALLBACK_TOKEN = "c76d4523291fefd64f1dac101c4810f3";
export const STOREFRONT_API = `${SITE}/api/2024-10/graphql.json`;

export const brand = "derimod";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fold = (s: string) => s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").toLowerCase();
function genderOf(p: any): ProductRecord["gender"] {
  const tags: string[] = Array.isArray(p?.tags) ? p.tags.map(String) : [];
  const t = fold([...tags, p?.title ?? ""].join(" | "));
  if (/cocuk/.test(t)) return "cocuk";
  if (/feed-gender-female|\bkadin\b/.test(t)) return "kadin";
  if (/feed-gender-male|\berkek\b/.test(t)) return "erkek";
  return null;
}

/** Index of the option whose name matches, as Shopify's `option1..3` key. */
function optionKey(p: any, re: RegExp): string | null {
  const opts: any[] = p?.options ?? [];
  const i = opts.findIndex((o) => re.test(String(typeof o === "string" ? o : o?.name ?? "")));
  return i >= 0 ? `option${i + 1}` : null;
}

/** Map one `/products.json` product. Pure. Prices there are major-unit strings. */
export function mapDerimod(p: any): ProductRecord | null {
  const vs: any[] = p?.variants ?? [];
  if (!p?.id || !p?.title || !vs.length) return null;
  const priced = vs
    .map((v) => ({ v, price: parseFloat(v.price), cmp: parseFloat(v.compare_at_price) }))
    .filter((x) => Number.isFinite(x.price) && x.price > 0);
  if (!priced.length) return null;
  // The price a shopper sees: the cheapest buyable variant, else the cheapest.
  const pick = [...priced].sort((a, b) => Number(b.v.available) - Number(a.v.available) || a.price - b.price)[0];
  const sizeKey = optionKey(p, /beden|size|numara/i);
  const colourKey = optionKey(p, /renk|colou?r/i);
  const seen = new Set<string>();
  const sizes: SizeVariant[] = [];
  if (sizeKey) {
    for (const v of vs) {
      const label = String(v?.[sizeKey] ?? "").trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      sizes.push({ label, availability: v.available ? "in_stock" : "out_of_stock" });
    }
  }
  const colors = colourKey ? [...new Set(vs.map((v) => String(v?.[colourKey] ?? "").trim()).filter(Boolean))] : [];
  const imgs: string[] = (p.images ?? []).map((im: any) => im?.src).filter((u: unknown) => typeof u === "string");
  const type = typeof p.product_type === "string" ? p.product_type.split(">").pop()!.trim() : "";
  return {
    brand,
    country: "TR",
    externalId: String(p.id),
    name: String(p.title).trim(),
    url: `${SITE}/products/${p.handle}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(pick.price),
    listPrice: Number.isFinite(pick.cmp) && pick.cmp > pick.price ? toMinor(pick.cmp) : null,
    currency: "TRY",
    inStock: vs.some((v) => v.available === true),
    category: type || null,
    gender: genderOf(p),
    variants: sizes.length ? { colors, sizes } : null,
    colorName: colors.length === 1 ? colors[0] : null,
  };
}

export const STOREFRONT_QUERY = `query($c: String) {
  products(first: 250, after: $c, query: "available_for_sale:true") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title handle productType tags
      options { name }
      images(first: 20) { nodes { url } }
      variants(first: 250) {
        nodes { availableForSale price { amount } compareAtPrice { amount } selectedOptions { name value } }
      }
    }
  }
}`;

/** The public Storefront token from a page's `shopify-features` JSON. */
export function tokenFromHtml(html: string): string | null {
  return html.match(/"accessToken":"([0-9a-f]{32})"/)?.[1] ?? null;
}

/** A Storefront API product node, reshaped as a `/products.json` product for `mapDerimod`. Pure. */
export function fromStorefront(n: any): any {
  const options: string[] = (n?.options ?? []).map((o: any) => String(o?.name ?? ""));
  return {
    id: Number(String(n?.id ?? "").split("/").pop()) || null,
    title: n?.title,
    handle: n?.handle,
    product_type: n?.productType ?? "",
    tags: n?.tags ?? [],
    options: options.map((name) => ({ name })),
    images: (n?.images?.nodes ?? []).map((im: any) => ({ src: im?.url })),
    variants: (n?.variants?.nodes ?? []).map((v: any) => {
      const row: Record<string, unknown> = {
        price: v?.price?.amount ?? null,
        compare_at_price: v?.compareAtPrice?.amount ?? null,
        available: v?.availableForSale === true,
      };
      options.forEach((name, i) => {
        row[`option${i + 1}`] = (v?.selectedOptions ?? []).find((o: any) => o?.name === name)?.value ?? null;
      });
      return row;
    }),
  };
}

async function storefrontPage(token: string, cursor: string | null): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const d = await getJson<any>(STOREFRONT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": token },
      body: JSON.stringify({ query: STOREFRONT_QUERY, variables: { c: cursor } }),
      retries: 0,
    }).catch(() => null);
    if (d?.data?.products) return d.data.products;
    await sleep(5000 * (attempt + 1));
  }
  return null;
}

export async function listProducts(): Promise<ProductRecord[]> {
  const home = await getText(`${SITE}/`, { timeoutMs: 30_000 }).catch(() => "");
  const token = tokenFromHtml(home) ?? FALLBACK_TOKEN;
  const byId = new Map<string, ProductRecord>();
  let cursor: string | null = null;
  for (let n = 1; n <= MAX_PAGES; n++) {
    if (n > 1) await sleep(PAUSE_MS);
    const page = await storefrontPage(token, cursor);
    // A partial walk would let the delist sweep mark the unseen products sold out.
    if (!page) throw new Error(`derimod: Storefront API page ${n} refused`);
    for (const node of page.nodes ?? []) {
      const r = mapDerimod(fromStorefront(node));
      if (r) byId.set(r.externalId, r);
    }
    if (!page.pageInfo?.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
    if (n === MAX_PAGES) throw new Error(`derimod: more than ${MAX_PAGES} Storefront pages — raise DERIMOD_MAX_PAGES`);
  }
  const all = [...byId.values()];
  // A cap that cut rows would let the delist sweep mark them sold out: refuse instead.
  if (all.length > MAX_PRODUCTS) throw new Error(`derimod: ${all.length} products, over the cap of ${MAX_PRODUCTS}`);
  return [...all.filter((r) => r.listPrice != null), ...all.filter((r) => r.listPrice == null)];
}
