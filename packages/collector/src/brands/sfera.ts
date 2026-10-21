/**
 * Sfera (sfera.com) — El Corte Inglés's own fashion chain, Spain, EUR.
 *
 * The storefront is El Corte Inglés's "Firefly" Vue app behind Akamai Bot
 * Manager. What Akamai refuses is the REQUEST SHAPE, not the egress (same as
 * `michaelkors.ts`): curl/python and a Chrome User-Agent get "Access Denied",
 * while Node's fetch with a Safari User-Agent (no `sec-ch-ua` client hints to
 * cross-check) is served — from the Mac and from a GitHub runner, no proxy
 * (probe run 39614778526, 2026-10-21: the JSON list, the HTML page and the
 * `dam.elcorteingles.es` images all 200). The feed is the app's own infinite
 * scroll endpoint, `/es/api/sfera-es/firefly/products_list/<section>/<filters>/<page>/`
 * (base from `__MOONSHINE_STATE__._api_base`), which answers JSON. The UA
 * must be sent ONCE: a second user-agent key in other casing is merged by
 * fetch into "Chrome…, Safari…", which is refused (probe 39615169008: 403;
 * 39615266603 with one key: 200). `getJson` uses `User-Agent`, so the override
 * below uses exactly that key.
 *
 * - `discount::1->100` is the "% Descuento" facet with one wide range (the site
 *   offers 10-point buckets; any range is accepted) — only marked-down styles.
 *   On 2026-10-21: mujer 152, hombre 63. Pages are fixed at 12 styles.
 * - One product (`A…` code) holds one or more colours; each colour is one
 *   record (its `common_sku`), sizes are its variants with `price` (struck),
 *   `sale_price` and `status` (`ADD` = buyable, `SOLD_OUT`).
 * - Category text comes from the page's datalayer (`category` path), matched
 *   by product code.
 *
 * The Portuguese store (`/pt/`, `sfera-pt`) is the same app — not wired here.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const SITE = "https://www.sfera.com";
const API = `${SITE}/es/api/sfera-es/firefly/products_list`;
const FILTER = "discount::1-%3E100";
const SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const SECTIONS: { slug: string; gender: ProductRecord["gender"] }[] = [
  { slug: "mujer", gender: "kadin" },
  { slug: "hombre", gender: "erkek" },
];
const MAX_REQUESTS = 55;
const CAP = 1500;
const PAUSE_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clean = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

export const pageUrl = (slug: string, page: number): string =>
  `${API}/${slug}/${FILTER}/${page > 1 ? `${page}/` : ""}`;

/** "120 Crudo" → "Crudo". Pure. */
export const colourName = (t: unknown): string => clean(t).replace(/^\d+\s+/, "");

/** Product code → "Vestidos > Midi", from the page datalayer's category path. Pure. */
export function categoriesOf(data: any): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of data?.paginatedDatalayer?.products ?? []) {
    const path: string[] = Array.isArray(p?.category) ? p.category.map(clean).filter(Boolean) : [];
    // ["Sfera España", "Mujer", "Vestidos", "Midi"] → drop the store and the section.
    const rest = path.slice(2);
    if (p?.code_a && rest.length) out.set(String(p.code_a), rest.join(" > "));
  }
  return out;
}

/** One product → one record per discounted colour. Pure. */
export function mapSfera(
  p: any,
  gender: ProductRecord["gender"],
  category: string | null = null,
  country: CountryCode = "ES",
): ProductRecord[] {
  const name = clean(p?.title);
  const uri = clean(p?._uri).split("?")[0];
  if (!p?.id || !name || !uri) return [];
  const colours: any[] = Array.isArray(p._my_colors) ? p._my_colors : [];
  const out: ProductRecord[] = [];
  for (const c of colours) {
    const vars: any[] = Array.isArray(c?.variants) ? c.variants : [];
    if (!c?.common_sku || !vars.length) continue;
    // One price pair per colour; sizes priced differently are a range, not a deal.
    const pairs = new Set(vars.map((v) => `${Number(v?.price)}|${Number(v?.sale_price)}`));
    if (pairs.size !== 1) continue;
    const was = Number(vars[0].price);
    const price = Number(vars[0].sale_price);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(was) || was <= price) continue;
    const sizes: SizeVariant[] = [];
    const seen = new Set<string>();
    for (const v of vars) {
      const label = clean(v?.variant?.value);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      sizes.push({ label, availability: v.status === "ADD" ? "in_stock" : "out_of_stock" });
    }
    const inStock = !c.not_available && vars.some((v) => v?.status === "ADD");
    const photos = (Array.isArray(c.all_images) ? c.all_images : [])
      .filter((i: any) => !i?.is_look)
      .map((i: any) => i?.default_source);
    const images = cleanGallery(photos, typeof c.image === "string" ? c.image : null);
    const colour = colourName(c.title);
    const gtins = [...new Set(vars.map((v) => clean(v?.gtin)).filter((g) => /^\d{8,14}$/.test(g)))];
    out.push({
      brand: "sfera",
      country,
      externalId: String(c.common_sku),
      name,
      url: `${SITE}${uri}`,
      imageUrl: images?.[0] ?? null,
      images,
      price: toMinor(price),
      listPrice: toMinor(was),
      currency: "EUR",
      inStock,
      barcodes: gtins.length ? gtins : null,
      category,
      gender,
      variants: { colors: colour ? [colour] : [], sizes },
      groupKey: colours.length > 1 ? `sfera:${p.id}` : null,
      colorName: colour || null,
    });
  }
  return out;
}

/** Register as `listSfera(country)`. ES only. */
export async function listSfera(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "ES") return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const s of SECTIONS) {
    let total = 1;
    for (let page = 1; page <= total && requests < MAX_REQUESTS; page++) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      const d = await getJson<any>(pageUrl(s.slug, page), {
        country,
        headers: {
          "User-Agent": SAFARI_UA,
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "es-ES,es;q=0.9",
        },
      });
      const data = d?.data;
      if (!d?.success || !Array.isArray(data?.products) || !data.products.length) break;
      total = Number(data?.pagination?._total) || 1;
      const cats = categoriesOf(data);
      for (const p of data.products) {
        for (const r of mapSfera(p, s.gender, cats.get(String(p?.id)) ?? null, country)) {
          if (!byId.has(r.externalId)) byId.set(r.externalId, r);
        }
      }
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
