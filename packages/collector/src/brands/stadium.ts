/**
 * Stadium (SE/FI) — the reduced-price ("Röda priser") clothes, shoes and
 * winter accessories, through the Algonomy/RichRelevance Find API the storefront itself
 * searches with (2026-10-21).
 *
 * stadium.se/.fi sit behind Vercel's attack-mode checkpoint (429 to every
 * client, Mac and runner alike); the search provider does not. The public
 * site API keys ride in every product's click-tracking URL in the page HTML
 * (`apiclick?a=<apiKey>`). No cookie, no proxy:
 *   GET https://recs.richrelevance.com/rrserver/api/find/v1/<apiKey>
 *       ?query=*&lang=sv&rows=200&start=N&placement=search_page.find
 *       &filter={!tag=tagcategoryids}tagcategoryids:"<Röda priser>"
 *       &filter=categoryId:"<Alla kläder | Alla skor | Vinteraccessoarer>"
 *
 * `complete_price` is the shop's own price object: `Current.Type` 2 is the
 * red (reduced) price and `Reference` the ordinary price it strikes through,
 * with the percentage it shows. Rows without a Reference are skipped. Only
 * products filed under the shop's own "all clothes" / "all shoes" / winter
 * accessories roots are kept (the red-price tag also covers dumbbells, garden
 * toys, bikes...), queried one root at a time (`categoryId:"<root>"`; the
 * Find API ignores OR between them). Category ids are shared by both markets.
 *
 * stadium.dk redirects to stadium.se — Stadium does not sell online in Denmark.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const STADIUM_MARKETS: Partial<Record<CountryCode, { apiKey: string; lang: string; origin: string; currency: number }>> = {
  SE: { apiKey: "b84090fc5b2323f5", lang: "sv", origin: "https://www.stadium.se", currency: 1 },
  FI: { apiKey: "0b8339cd9c553cb0", lang: "fi", origin: "https://www.stadium.fi", currency: 2 },
};

/** "TAG - Röda priser": the shop's red-price tag (same id in SE and FI). */
const RED_PRICE_TAG = "0e04a3a4-dc73-48de-a10c-ef372c0f4641";
/**
 * The shop's fashion roots, collected in this order until each running total
 * is reached: Alla kläder / Alla skor / Vinteraccessoarer (Kaikki vaatteet /
 * Kaikki kengät / Talviset asusteet). Measured 2026-10-21: SE 2,715 / 867 /
 * 350 red-price rows, FI 1,823 / 468 / 184.
 */
export const STADIUM_SECTIONS: { id: string; upTo: number }[] = [
  { id: "6708f4694c67481f5a8ca1ec", upTo: 950 },
  { id: "6708f48d4c67481f5a8ca1ed", upTo: 1350 },
  { id: "6708f517c5e11f562fdc3bc4", upTo: 1500 },
];
const FASHION_ROOTS = new Set(STADIUM_SECTIONS.map((s) => s.id));
/** Top-level Dam / Herr / Barn category ids (Naiset / Miehet / Lapset). */
const GENDER_ROOTS: Record<string, NonNullable<ProductRecord["gender"]>> = {
  "669e4ff67863fd5f9dccf028": "kadin",
  "669e4ff63354542d600e2603": "erkek",
  "669e4ff6b87b94537d62c38b": "cocuk",
};

const ROWS = 200;
const CAP = 1500;
const MAX_REQUESTS = 16;
const PAUSE_MS = Number(process.env.STADIUM_PAUSE_MS ?? 600);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function stadiumUrl(country: CountryCode, categoryId: string, start: number): string {
  const m = STADIUM_MARKETS[country]!;
  const filters = [
    `{!tag=tagcategoryids}tagcategoryids:"${RED_PRICE_TAG.replace(/-/g, "\\-")}"`,
    `categoryId:"${categoryId}"`,
    `{!tag=has_online_stock}has_online_stock:"true"`,
  ];
  const q = new URLSearchParams({
    query: "*",
    lang: m.lang,
    rows: String(ROWS),
    start: String(start),
    placement: "search_page.find",
    sessionId: "modadrop",
    userId: "modadrop",
  });
  for (const f of filters) q.append("filter", f);
  return `https://recs.richrelevance.com/rrserver/api/find/v1/${m.apiKey}?${q}`;
}

const parse = (s: unknown): any => {
  if (typeof s !== "string") return s ?? null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** Map one Find doc. Returns null for anything that is not a real reduced fashion item. Pure. */
export function mapStadium(d: any, country: CountryCode): ProductRecord | null {
  const m = STADIUM_MARKETS[country];
  if (!m || !d?.id || !d?.name || typeof d?.linkId !== "string") return null;
  const ids: string[] = Array.isArray(d.categoryId) ? d.categoryId : [];
  if (!ids.some((i) => FASHION_ROOTS.has(i))) return null;
  const cp = parse(d.complete_price);
  if (!cp || cp.Currency !== m.currency) return null;
  const cur = Number(cp.Current?.Amount);
  const ref = Number(cp.Reference?.Amount);
  if (cp.Current?.Type !== 2 || !Number.isFinite(cur) || cur <= 0 || !Number.isFinite(ref) || ref <= cur) return null;
  const img = parse(d.image)?.Url ?? d.imageurloriginal ?? null;
  const img2 = parse(d.secondaryimage)?.Url ?? null;
  // Unisex items sit under several gender roots: only a single one is a gender.
  const genders = [...new Set(ids.map((i) => GENDER_ROOTS[i]).filter(Boolean))];
  const gender = genders.length === 1 ? genders[0] : null;
  const names: string[] = Array.isArray(d.categoryName) ? d.categoryName : [];
  const brand = typeof d.brand === "string" ? d.brand.trim() : "";
  const title = String(d.name).trim();
  const colors = (parse(d.colorvariants) ?? []).map((c: any) => c?.Name).filter((c: unknown): c is string => typeof c === "string");
  return {
    brand: "stadium",
    country,
    externalId: String(d.id),
    name: brand && !title.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${title}` : title,
    url: `${m.origin}${d.linkId}`,
    imageUrl: img,
    images: cleanGallery([img, img2], img),
    price: toMinor(cur),
    listPrice: toMinor(ref),
    currency: COUNTRIES[country].currency,
    inStock: d.has_online_stock === true || d.in_stock === true,
    category: names[0] ?? null,
    maker: brand || null,
    gender,
    variants: colors.length ? { colors, sizes: [] } : null,
  };
}

export async function listStadium(country: CountryCode, cap = CAP): Promise<ProductRecord[]> {
  const m = STADIUM_MARKETS[country];
  if (!m) return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const sec of STADIUM_SECTIONS) {
    const target = Math.min(cap, sec.upTo);
    for (let start = 0; byId.size < target; start += ROWS) {
      if (requests >= MAX_REQUESTS) throw new Error(`stadium/${country}: request cap hit at ${byId.size} rows`);
      if (requests > 0) await sleep(PAUSE_MS);
      requests++;
      const data = await getJson<any>(stadiumUrl(country, sec.id, start), { country });
      const p = data?.placements?.[0];
      if (!p || !Array.isArray(p.docs)) throw new Error(`stadium/${country}: Find answered without docs (${sec.id}, ${start})`);
      if (start === 0 && !p.docs.length) throw new Error(`stadium/${country}: no red-price products under ${sec.id}`);
      for (const d of p.docs) {
        const r = mapStadium(d, country);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (p.docs.length < ROWS || start + ROWS >= Number(p.numFound ?? 0)) break;
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
}
