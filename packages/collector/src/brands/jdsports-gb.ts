/**
 * JD Sports UK (jdsports.co.uk), women's sale, GBP — through the Algolia index
 * the site's own Next.js frontend searches. App id and the search-only key are
 * published in every page's `algoliaConfig`, so each run reads them off the
 * home page (which answers a GitHub runner) rather than pinning a key here.
 * Every other www.jdsports.co.uk page — even the static JS — answers a plain
 * request with a Fastly 403, but Algolia's DSN hosts don't. 2026-10-11.
 *
 * `onSale:true` is the site's own sale flag (each hit carries `price` and
 * `wasPrice` in pounds). `size` lists the sizes still sellable (a third of the
 * sale hits list one size), so those are stored as in stock.
 *
 * JD Sports Australia is a separate Shopify shop (`jdsports.ts`, slug
 * "jd-sports"); this file is the British store only.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson, getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const SITE = "https://www.jdsports.co.uk";
const INDEX = "jd_prod_products_en";
const HITS = 1000;
const CAP = 1500;
const PAUSE_MS = 800;
export const JD_GB_FILTER = "onSale:true AND (gender:Womens OR gender:Women)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `{applicationId, searchApiKey}` out of the home page's `algoliaConfig`. Pure. */
export function algoliaConfigOf(html: string): { appId: string; key: string } | null {
  const m = /"algoliaConfig":\{"applicationId":"([A-Z0-9]+)","searchApiKey":"([a-f0-9]+)"/.exec(html);
  return m ? { appId: m[1], key: m[2] } : null;
}

/** The EU indexes label genders in the shop's language (facet values, 2026-10-21). */
const EU_WOMEN = /^(femmes|frauen|mujer|dames|dam|donna|mulher|naisten|kvinder)$/;
const EU_KIDS = /^(garçons|filles|jungen|mädchen|niños|niñas|jongens|meisjes|kille|tjej|ragazzo|ragazza|rapaz|rapariga|pojat|tytöt|drenge|piger)$/;
const EU_MEN = /^(hommes|männer|hombre|heren|herr|uomo|homem|miehet|mænd)$/;

export function genderOf(g: unknown): ProductRecord["gender"] {
  const v = (Array.isArray(g) ? g : [g]).map((x) => String(x ?? "").toLowerCase());
  if (v.some((x) => /^wom[ae]n/.test(x) || EU_WOMEN.test(x))) return "kadin";
  if (v.some((x) => /^(boys|girls|kids|infant|junior)/.test(x) || EU_KIDS.test(x))) return "cocuk";
  if (v.some((x) => /^m[ae]n/.test(x) || EU_MEN.test(x))) return "erkek";
  return null;
}

/**
 * EUROPE (2026-10-21): every JD EU shop is an index in the SAME Algolia app as
 * the UK (`jd_prod_products_<cc>`, named in each site's own `algoliaConfig`),
 * with the same hit shape — prices in the shop's currency (SEK/DKK in SE/DK).
 * Women's sale only, like the UK: the women's label is in the shop's language
 * (Femmes, Frauen, Dam …) plus a few English strays. All twelve answered a
 * GitHub runner (probe 39615284904). Product pages follow the UK's
 * `/product/<slug>/<id>/` route on each country's own domain.
 */
const WOMEN_EN = `gender:Women OR gender:Womens OR gender:"Women's" OR gender:female`;
const jdEu = (cc: string, women: string): { index: string; site: string; filter: string } => ({
  index: `jd_prod_products_${cc}`,
  site: `https://www.jdsports.${cc}`,
  filter: `onSale:true AND (gender:"${women}" OR ${WOMEN_EN})`,
});
export const JD_EU_MARKETS: Partial<Record<CountryCode, { index: string; site: string; filter: string }>> = {
  FR: jdEu("fr", "Femmes"),
  DE: jdEu("de", "Frauen"),
  ES: jdEu("es", "Mujer"),
  NL: jdEu("nl", "Dames"),
  BE: jdEu("be", "Womens"),
  IE: jdEu("ie", "Womens"),
  SE: jdEu("se", "Dam"),
  IT: jdEu("it", "Donna"),
  AT: jdEu("at", "Frauen"),
  PT: jdEu("pt", "Mulher"),
  FI: jdEu("fi", "Naisten"),
  DK: jdEu("dk", "Kvinder"),
};

/** Map one Algolia hit. Pure. `site` is the shop's own domain (the UK by default). */
export function mapJdGb(h: any, country: CountryCode, site: string = SITE): ProductRecord | null {
  const price = Number(h?.price);
  const was = Number(h?.wasPrice);
  if (!h?.objectID || !h?.name || !h?.slug || !Number.isFinite(price) || price <= 0 || h.isGiftCard) return null;
  if (h.isMultiPrice) return null;
  const imgs = [h.image, h.imageSquare].filter((u: unknown): u is string => typeof u === "string");
  const sizes: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const s of Array.isArray(h.size) ? h.size : []) {
    const label = String(s ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: "in_stock" });
  }
  // The index lists half sizes after whole ones ("4","5",…,"3.5"); show them in order.
  if (sizes.length && sizes.every((x) => /^\d+(\.\d+)?$/.test(x.label))) {
    sizes.sort((a, b) => parseFloat(a.label) - parseFloat(b.label));
  }
  const colour = typeof h.colour === "string" && h.colour ? h.colour : null;
  const type = Array.isArray(h.productType) ? h.productType[0] : null;
  return {
    brand: "jdsports",
    country,
    externalId: String(h.objectID),
    name: String(h.name).trim(),
    url: `${site}/product/${h.slug}/${h.objectID}/`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: Number.isFinite(was) && was > price ? toMinor(was) : null,
    currency: COUNTRIES[country].currency,
    inStock: h.inStock !== false,
    category: typeof type === "string" ? type : Array.isArray(h.category) ? (h.category[0] ?? null) : null,
    gender: genderOf(h.gender),
    variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: h.styleId ? `jdsports:${h.styleId}` : null,
    colorName: colour,
  };
}

/** The UK, or an EU shop from JD_EU_MARKETS (the registry's `jdsports` entry calls this for every market). */
export async function listJdSportsGb(country: CountryCode): Promise<ProductRecord[]> {
  const eu = JD_EU_MARKETS[country];
  if (country !== "GB" && !eu) return [];
  const index = eu?.index ?? INDEX;
  const site = eu?.site ?? SITE;
  const filter = eu?.filter ?? JD_GB_FILTER;
  // The search-only key, pinned (public, shipped in every JD page). Reading it
  // from the home page broke on 2026-10-11 when www.jdsports.co.uk started
  // answering 403 to runners AND to the Mac, while Algolia itself still
  // answers. The home page is only a fallback for when the pinned key is
  // retired. docs/collector-unblock-playbook.md.
  let cfg: { appId: string; key: string } | null = {
    appId: process.env.JDSPORTS_GB_ALGOLIA_APP ?? "YPTJLWZE3Q",
    key: process.env.JDSPORTS_GB_ALGOLIA_KEY ?? "406e0fd2fca1bb457ec819dbcd962294",
  };
  const probe = await getJson<any>(`https://${cfg.appId}-dsn.algolia.net/1/indexes/${index}/query`, {
    method: "POST", country, retries: 0,
    headers: { "X-Algolia-Application-Id": cfg.appId, "X-Algolia-API-Key": cfg.key, "Content-Type": "application/json" },
    body: JSON.stringify({ params: "hitsPerPage=0" }),
  }).catch(() => null);
  if (!probe) cfg = algoliaConfigOf(await getText(`${site}/`, { country, headers: { Accept: "text/html" } }));
  if (!cfg) throw new Error(`jdsports/${country}: pinned Algolia key refused and no algoliaConfig on the home page`);
  const byId = new Map<string, ProductRecord>();
  for (let page = 0; page < 3 && byId.size < CAP; page++) {
    await sleep(PAUSE_MS);
    const params = new URLSearchParams({
      query: "", hitsPerPage: String(HITS), page: String(page), filters: filter,
      attributesToHighlight: "[]", attributesToSnippet: "[]",
    });
    const data = await getJson<any>(`https://${cfg.appId}-dsn.algolia.net/1/indexes/${index}/query`, {
      method: "POST",
      country,
      headers: {
        "X-Algolia-Application-Id": cfg.appId,
        "X-Algolia-API-Key": cfg.key,
        "Content-Type": "application/json",
        Referer: `${site}/`,
      },
      body: JSON.stringify({ params: params.toString() }),
    });
    const hits: any[] = data?.hits ?? [];
    for (const h of hits) {
      const r = mapJdGb(h, country, site);
      if (r && r.listPrice != null && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (page + 1 >= Number(data?.nbPages ?? 0) || hits.length < HITS) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
