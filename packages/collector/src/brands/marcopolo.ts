/**
 * Marc O'Polo Germany, through the shop's FactFinder NG search (2026-10-21).
 *
 * marc-o-polo.com sits behind an AWS WAF challenge for datacenter IPs (a
 * GitHub runner gets `202` with an empty body). Its search provider does not:
 * the storefront's public config ships `FACTFINDER_URL`
 * (`marcopolo.fact-finder.de/fact-finder`), `FACTFINDER_API_KEY` (a public
 * `ffng-…` key, sent as `x-ff-api-key`) and channel `{prefix}-live` → `de-live`.
 *
 * `rest/v5/search/de-live?query=*&filter=is_sale:yes` returns the sale styles
 * (~1,100, 100 a page → ~12 requests). Each hit is one colour
 * (`product_id` = article_colour); its `variantValues` are the sizes, each with
 * `prices` (regular) and `sale_price` in euros and `stock_de`. Only colours
 * whose sale price is below the regular price are kept.
 */
import type { ProductRecord, SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const FF = "https://marcopolo.fact-finder.de/fact-finder/rest/v5/search/de-live";
/** Public: shipped in every marc-o-polo.com page's runtime config. */
const FF_KEY = "ffng-NJOL1wHn.Etss7PeqzfYd5vZSF7aCKNPZMuwaH7";
const SITE = "https://www.marc-o-polo.com/de-de";
const PER_PAGE = 100;
const MAX_PAGES = 20;
const CAP = 1500;

export const searchUrl = (page: number, channel?: string) =>
  `${channel ? FF.replace(/de-live$/, `${channel}-live`) : FF}?query=*&filter=is_sale%3Ayes&hitsPerPage=${PER_PAGE}&page=${page}`;

/**
 * Other markets (2026-10-21). FactFinder channels are per LANGUAGE (de, nl,
 * fr, es, it, en — `at-live`/`ch-live` do not exist), but each carries that
 * country shop's own prices: nl-live = marc-o-polo.com/nl-nl (NOT nl-be, which
 * prices differently), es-live = es-es, it-live = it-it. fr-live is left out:
 * its sale flags are mostly at full price, and the ~150 reduced colours left
 * were 88% out of stock (2026-10-21). Austria
 * has no channel; de-at prices equal de-de (8 of 8 sale styles checked on the
 * product pages' JSON-LD, 2026-10-21), so AT reads de-live with de-at links.
 * Switzerland (CHF) is in no channel and is not collected.
 */
export const MOP_MARKETS: Partial<Record<CountryCode, { channel: string; locale: string }>> = {
  AT: { channel: "de", locale: "de-at" },
  NL: { channel: "nl", locale: "nl-nl" },
  ES: { channel: "es", locale: "es-es" },
  IT: { channel: "it", locale: "it-it" },
};

const GENDER: Record<string, ProductRecord["gender"]> = { female: "kadin", male: "erkek" };

/** "Hose Model Marthe flared" → "hose-model-marthe-flared" (the shop redirects any slug to its canonical one). */
const slugify = (s: string) =>
  s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Map one hit (one colour). Pure. */
export function mapMarcOPolo(hit: any, country: CountryCode = "DE"): ProductRecord | null {
  const mk = MOP_MARKETS[country];
  const site = mk ? SITE.replace(/de-de$/, mk.locale) : SITE;
  const mv = hit?.masterValues ?? {};
  const pid = String(mv.product_id ?? "").trim();
  const name = String(mv.name ?? "").trim();
  if (!/^[\w-]+$/.test(pid) || !name) return null;
  const vs: any[] = Array.isArray(hit.variantValues) ? hit.variantValues : [];
  const priced = vs
    .map((v) => ({ v, sale: Number(v?.sale_price), reg: Number(v?.prices) }))
    .filter((x) => x.sale > 0 && x.reg > 0);
  if (!priced.length) return null;
  // Headline = the cheapest size; its own regular price is the reference.
  const best = priced.reduce((a, b) => (b.sale < a.sale ? b : a));
  if (!(best.reg > best.sale)) return null;
  const sizes: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const { v } of priced) {
    const label = String(v.size ?? "").trim();
    if (!label || label === "--na--" || seen.has(label)) continue;
    seen.add(label);
    const q = Number(v.stock_de ?? v.stock ?? 0);
    sizes.push({ label, availability: q > 3 ? "in_stock" : q > 0 ? "low_on_stock" : "out_of_stock" });
  }
  const barcodes = [...new Set(vs.map((v) => String(v?.product_variation_id ?? "")).filter((e) => /^\d{8,14}$/.test(e)))];
  const color = String(vs[0]?.color_name ?? mv.refinementcolor_shop ?? "").trim() || null;
  const img = typeof mv.image_link === "string" && mv.image_link.startsWith("https://") ? mv.image_link.replace(/width=\d+/, "width=800") : null;
  const desc = String(mv.short_description ?? "").trim();
  return {
    brand: "marcopolo",
    country,
    externalId: pid,
    name: desc ? `${name} ${desc}` : name,
    url: `${site}/p/${slugify(name) || "p"}-${pid}`,
    imageUrl: img,
    price: toMinor(best.sale),
    listPrice: toMinor(best.reg),
    currency: "EUR",
    inStock: sizes.length ? sizes.some((s) => s.availability !== "out_of_stock") : true,
    barcodes: barcodes.length ? barcodes : null,
    category: null,
    gender: GENDER[String(mv.gender)] ?? null,
    variants: sizes.length ? { colors: color ? [color] : [], sizes } : null,
    groupKey: mv.article_id ? `marcopolo:${mv.article_id}` : null,
    colorName: color,
  };
}

export async function listMarcOPolo(country: CountryCode, fetchPage: (u: string) => Promise<any> = (u) => getJson(u, { country, headers: { "x-ff-api-key": FF_KEY }, retries: 2 })): Promise<ProductRecord[]> {
  const mk = MOP_MARKETS[country];
  if (country !== "DE" && !mk) return [];
  const byId = new Map<string, ProductRecord>();
  let pages = 1;
  for (let page = 1; page <= Math.min(pages, MAX_PAGES); page++) {
    const d = await fetchPage(searchUrl(page, mk?.channel));
    pages = Number(d?.paging?.pageCount ?? 0);
    const hits: any[] = Array.isArray(d?.hits) ? d.hits : [];
    if (!hits.length) break;
    for (const h of hits) {
      const r = mapMarcOPolo(h, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  const out = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
  console.log(`marcopolo/${country}: ${all.length} reduced colours, kept ${out.length}`);
  return out;
}
