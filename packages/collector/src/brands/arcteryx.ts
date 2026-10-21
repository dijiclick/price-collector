/**
 * Arc'teryx (arcteryx.com) — US and Canada. The main store almost never
 * discounts (its `discount_price` equals `price`); reductions live in the
 * brand's own outlet, outlet.arcteryx.com, at the past full price struck
 * through. Both sites are Next.js behind Kasada, but their grids are filled
 * client-side from Bloomreach Discovery (`core.dxpapi.com`), outside the
 * wall: account 7359, domain key `arcteryx_outlet`, one `view_id` per
 * country carrying `price_<cc>` / `discount_price_<cc>` in that country's
 * currency (read from the storefront bundle, 2026-10-21). A keyword search
 * for `*` returns the whole outlet: ~210 styles in the US, ~130 in Canada.
 *
 * The outlet lists only sellable styles; Bloomreach has no stock per size,
 * so every row is in stock and carries no size list.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const OUTLET = "https://outlet.arcteryx.com";
const BR = "https://core.dxpapi.com/api/v1/core/";
const MARKETS: Partial<Record<CountryCode, { view: string; currency: string }>> = {
  US: { view: "us", currency: "USD" },
  CA: { view: "ca", currency: "CAD" },
};
const ROWS = 200;
const MAX_PAGES = 8;
const PAUSE_MS = Number(process.env.ARCTERYX_PAUSE_MS ?? 800);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * `colour_images_map_<cc>` is a stringified list of
 * "family:::colour:::flag:::front:::thumb:::null:::hover" entries. Pure.
 */
export function arcteryxColours(raw: unknown): { colours: string[]; photos: string[] } {
  const colours: string[] = [];
  const photos: string[] = [];
  for (const m of String(raw ?? "").matchAll(/'([^']*:::[^']*)'/g)) {
    const f = m[1].split(":::");
    if (f[1]) colours.push(f[1].trim());
    for (const u of [f[3], f[6], f[4]]) if (u && /^https:\/\//.test(u)) photos.push(u);
  }
  return { colours: [...new Set(colours)], photos };
}

/** One Bloomreach doc → a record, or null without a real reduction. Pure. */
export function mapArcteryx(doc: any, country: CountryCode): ProductRecord | null {
  const m = MARKETS[country];
  if (!m) return null;
  const price = Number(doc?.[`discount_price_${m.view}`]);
  const was = Number(doc?.[`price_${m.view}`]);
  if (!doc?.pid || !doc?.title || !doc?.slug || !Number.isFinite(price) || price <= 0 || !Number.isFinite(was) || was <= price) return null;
  const { colours, photos } = arcteryxColours(doc[`colour_images_map_${m.view}`]);
  const lead = typeof doc.thumb_image === "string" ? doc.thumb_image : photos[0] ?? null;
  const images = cleanGallery(photos, lead);
  const g = String(doc.gender ?? "").toLowerCase();
  return {
    brand: "arcteryx",
    country,
    externalId: String(doc.pid),
    name: String(doc.title).replace(/\s+/g, " ").trim(),
    url: `${OUTLET}/${m.view}/en/shop/${String(doc.slug).replace(/^\/+/, "")}`,
    imageUrl: images?.[0] ?? null,
    images,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: m.currency,
    inStock: true,
    category: null,
    gender: g === "women" ? "kadin" : g === "men" ? "erkek" : null,
    variants: colours.length ? { colors: colours, sizes: [] } : null,
    colorName: colours.length === 1 ? colours[0] : null,
  };
}

/** Register as `listArcteryx(country)`. US + CA, from the brand's outlet. */
export async function listArcteryx(country: CountryCode): Promise<ProductRecord[]> {
  const m = MARKETS[country];
  if (!m) return [];
  const fl = ["pid", "title", "slug", "gender", `price_${m.view}`, `discount_price_${m.view}`, "thumb_image", `colour_images_map_${m.view}`].join(",");
  const byId = new Map<string, ProductRecord>();
  let found = Infinity;
  for (let page = 0; page * ROWS < found; page++) {
    if (page >= MAX_PAGES) throw new Error(`arcteryx/${country}: ${found} outlet styles exceed ${MAX_PAGES} pages`);
    if (page > 0) await sleep(PAUSE_MS);
    const q = new URLSearchParams({
      account_id: "7359",
      domain_key: "arcteryx_outlet",
      fl,
      _br_uid_2: "uid=0000000000000:v=15.0:ts=0:hc=1",
      ref_url: `${OUTLET}/`,
      url: `${OUTLET}/${m.view}/en/`,
      request_id: String(Date.now()),
      rows: String(ROWS),
      start: String(page * ROWS),
      view_id: m.view,
      request_type: "search",
      search_type: "keyword",
      q: "*",
    });
    const data = await getJson<any>(`${BR}?${q}`, { country });
    const docs: any[] = data?.response?.docs;
    if (!Array.isArray(docs)) throw new Error(`arcteryx/${country}: Bloomreach page ${page} returned no docs`);
    found = Number(data.response.numFound) || 0;
    for (const d of docs) {
      const r = mapArcteryx(d, country);
      if (r) byId.set(r.externalId, r);
    }
    if (docs.length < ROWS) break;
  }
  return [...byId.values()];
}
