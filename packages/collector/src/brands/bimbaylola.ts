/**
 * Bimba y Lola (bimbaylola.com) — Spanish women's bags, shoes, clothing and
 * jewellery, Salesforce Commerce Cloud (Sites-byl-es) behind Cloudflare.
 *
 * No third-party search provider; the listing pages are server-rendered Vue
 * whose every tile embeds its SFRA product model as JSON
 * (`<script type="application/json">{"product": …}`): `price.sales` /
 * `price.list` (the struck price), colour and size attributes with
 * `selectable` (= orderable), `available`, and the gallery. 200 from a GitHub
 * runner with a browser UA (probe run 39612079467, 2026-10-21, homepage; the
 * listings in a later run, see the report). SFRA paging `?start=N&sz=48` works
 * on the listing path itself.
 *
 * The sale shelves are campaign categories ("bolsos-rebajas",
 * "prenda-exterior-rebajas-3"), so each run reads the homepage navigation and
 * keeps every `/es_es/…rebajas…` link. A row counts only when list > sales.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { jsonOf } from "./_sfcchtml";

const ORIGIN = "https://www.bimbaylola.com";
const MARKETS: Partial<Record<CountryCode, string>> = { ES: "/es_es", PT: "/pt_pt", FR: "/fr_fr" };
/**
 * Portugal and France (2026-10-21): the same store. Portugal's sale shelves are
 * "…-saldos(-3)" / "malas-sale"; France only runs the legal "soldes" periods
 * (nothing linked on 2026-10-21, so FR returns [] until a soldes shelf appears).
 */
const SALE_WORD: Partial<Record<CountryCode, RegExp>> = { PT: /saldos|-sale$/, FR: /soldes/ };
const LANGS: Partial<Record<CountryCode, string>> = { PT: "pt-PT,pt;q=0.9", FR: "fr-FR,fr;q=0.9" };
const PAGE = 48;
const MAX_REQUESTS = 30;
const CAP = 1500;
const PAUSE_MS = Number(process.env.BYL_PAUSE_MS ?? 500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clean = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

/** Sale listing paths linked from the homepage. Pure. */
export function bylSaleListings(home: string, prefix: string, sale: RegExp = /rebajas/): string[] {
  const out = new Set<string>();
  for (const m of home.matchAll(/href="(?:https:\/\/www\.bimbaylola\.com)?(\/[a-z]{2}_[a-z]{2}\/[a-z0-9-]+)"/g)) {
    if (m[1].startsWith(prefix + "/") && sale.test(m[1])) out.add(m[1]);
  }
  return [...out].sort();
}

/** "/es_es/prenda-exterior-rebajas-3" → "prenda exterior"; the generic shelf → null. Pure. */
export function shelfOf(path: string): string | null {
  const slug = path.split("/").pop() ?? "";
  const s = slug
    .replace(/-?rebajas(-\d+)?$/, "")
    .replace(/^rebajas-?/, "")
    .replace(/-?(?:saldos|soldes)(-\d+)?$|-sale$/, "")
    .replace(/-/g, " ")
    .trim();
  return s && s !== "top productos" ? s : null;
}

/** Every product model embedded in a listing page. Pure. */
export function bylProducts(html: string): any[] {
  const out: any[] = [];
  for (const m of html.matchAll(/<script type="application\/json">\s*(\{"product":[\s\S]*?)<\/script>/g)) {
    const p = jsonOf<any>(m[1])?.product;
    if (p?.id) out.push(p);
  }
  return out;
}

/** One product model → a record, or null when it is not a struck-price deal. Pure. */
export function mapByl(p: any, shelf: string | null = null, country: CountryCode = "ES"): ProductRecord | null {
  const price = Number(p?.price?.sales?.value);
  const was = Number(p?.price?.list?.value);
  const name = clean(p?.productName);
  if (!p?.id || !name || !Number.isFinite(price) || price <= 0 || !Number.isFinite(was) || was <= price) return null;
  const attrs: any[] = Array.isArray(p.variationAttributes) ? p.variationAttributes : [];
  const colours: any[] = attrs.find((a) => a?.id === "color")?.values ?? [];
  const colour = colours.find((v) => v?.selected) ?? colours.find((v) => String(p.id).includes(`.${v?.id}`)) ?? null;
  const path = typeof colour?.url === "string" && colour.url.startsWith("/") ? colour.url : null;
  if (!path) return null;
  const sizes: SizeVariant[] = [];
  for (const v of attrs.find((a) => a?.id === "size")?.values ?? []) {
    const label = clean(v?.displayValue);
    if (!label || label === "UN" || sizes.some((s) => s.label === label)) continue;
    sizes.push({ label, availability: v.selectable ? "in_stock" : "out_of_stock" });
  }
  const photos = (p.bylImages?.medium ?? []).map((i: any) =>
    typeof i?.url === "string" ? i.url.replace(/\?.*$/, "?sw=900&sh=1350") : null,
  );
  const images = cleanGallery(photos);
  const colourName = clean(colour?.displayValue);
  const inStock = p.available !== false && (sizes.length === 0 || sizes.some((s) => s.availability === "in_stock"));
  return {
    brand: "bimbaylola",
    country,
    externalId: String(p.id),
    name,
    url: `${ORIGIN}${path}`,
    imageUrl: images?.[0] ?? null,
    images,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: p.price.sales.currency ?? "EUR",
    inStock,
    category: shelf,
    gender: "kadin",
    variants: { colors: colourName ? [colourName] : [], sizes },
    groupKey: `bimbaylola-${String(p.id).split(".")[0]}`,
    colorName: colourName || null,
  };
}

/** Register as `listBimbaYLola(country)`. ES, PT, FR. */
export async function listBimbaYLola(country: CountryCode): Promise<ProductRecord[]> {
  const prefix = MARKETS[country];
  if (!prefix) return [];
  const opts = { country, timeoutMs: 60_000, headers: { "Accept-Language": LANGS[country] ?? "es-ES,es;q=0.9" } };
  const listings = bylSaleListings(await getText(`${ORIGIN}${prefix}/`, opts), prefix, SALE_WORD[country]);
  if (!listings.length) return []; // no sale running
  const byId = new Map<string, ProductRecord>();
  const next = new Map<string, number>(listings.map((l) => [l, 0]));
  let requests = 1;
  while (next.size && requests < MAX_REQUESTS && byId.size < CAP) {
    for (const [path, start] of [...next]) {
      if (requests >= MAX_REQUESTS || byId.size >= CAP) break;
      await sleep(PAUSE_MS);
      requests++;
      const products = bylProducts(await getText(`${ORIGIN}${path}?start=${start}&sz=${PAGE}`, opts));
      for (const p of products) {
        const r = mapByl(p, shelfOf(path), country);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (products.length < PAGE) next.delete(path);
      else next.set(path, start + PAGE);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
