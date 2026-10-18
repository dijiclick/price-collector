/**
 * Atasay (www.atasay.com, Turkish gold/diamond jeweller; an Akinon "omnishop"
 * storefront) through its Segmentify search (2026-10-18).
 *
 * THE SITE IS GEO-WALLED. `?format=json` (see _akinon.ts) answers a Turkish
 * home line, but every host on the shop's AWS load balancer answers HTTP 403
 * from `awselb/2.0` to anything outside Turkey: GitHub's runners (probe run
 * 39127592961) AND our Hetzner box. No proxy for Turkey, so the store's own
 * API is out.
 *
 * Its search box is Segmentify (api key in GTM container GTM-TWJHCV9, tag
 * `cdn.segmentify.com/<key>/search.js`). The instant search is one plain POST
 * that answers the runner with 200 (same probe run):
 *
 *   POST https://gandalf.segmentify.com/add/events/v1.json?apiKey=<key>
 *   Origin: https://www.atasay.com           (required: else NO_DOMAIN_APIKEY_MATCH)
 *   [{"name":"SEARCH","type":"instant","query":"<q>",…}]
 *
 * Each row carries `price` and, on a markdown, `oldPrice` — the same pair the
 * product page prints (checked against four PDPs' `price`/`retail_price`).
 * The faceted (paged) search is not enabled on this account
 * (`executable: false`), so a query returns at most ~56 rows: 8 top products
 * plus up to 8 for each of its 6 best categories. Coverage therefore comes
 * from MANY queries: a fixed list, picked 2026-10-18 by greedy set cover over
 * 286 candidates (name words, bigrams and group-code prefixes like `DM177`,
 * `VLRG29` — Segmentify prefix-matches `groupId`). 60 queries reach 825
 * discounted products; all 286 candidates together reach 905. Refresh the list
 * when the count sags (new collections bring new group-code prefixes).
 *
 * Sizes: rings have sizes on the PDP, which the feed does not carry, so
 * `variants` is null. The id is the SKU (`productId`, the number ending the
 * url), which lib/live-brands/atasay.ts finds by searching for it.
 */
import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "atasay";
export const SITE = "https://www.atasay.com";
/** Public Segmentify api key the site loads through GTM (not a secret). */
export const SEGMENTIFY_KEY = "a60372ab-4b04-4f0c-b815-71f72ece3dc3";
export const ENDPOINT = `https://gandalf.segmentify.com/add/events/v1.json?apiKey=${SEGMENTIFY_KEY}`;

/** Greedy set cover, 2026-10-18 (see header). Order matters: biggest gain first. */
export const QUERIES = [
  "gümüş", "DM1", "DWT", "g-h", "pırlanta erkek", "simulant", "vs-sı", "DAS6", "DONE", "VLRG2",
  "zümrüt", "gümüş taşlı", "DAS4", "yakut", "safir", "karat e-f", "DM177L", "DAS30", "hematit", "pırlanta taşlı",
  "karat sı2", "VLRG44K", "kuru", "pırlanta baget", "VLRD29KP", "DWTKYZ01", "VLRD29B", "seçilebilir gümüş", "DM177YTK", "VLRG44G",
  "VLRG29BZ", "deri", "DM177YTL", "emerald", "gümüş aslan", "küpe safir", "DM177TK", "DM177TL", "DAS39KU", "elmaslı",
  "DONEKP", "VLRG48KU", "sarı", "kartal", "mekik", "lgs", "VLRG44B", "VLRG0", "pırlanta kolye", "DONE03",
  "DWTKYZ02", "DM177YP", "60cm", "DWTKKP", "karat", "pembe", "DM11", "VLRD2", "ruby", "elmas kolye",
];

const MAX_QUERIES = Number(process.env.ATASAY_MAX_QUERIES ?? QUERIES.length);
const CAP = Number(process.env.ATASAY_MAX_PRODUCTS ?? 1500);
const PAUSE_MS = Number(process.env.ATASAY_PAUSE_MS ?? 250);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A per-run visitor id: Segmentify wants one, and a fixed one would pile every run onto one "user". */
const visitor = () => Math.random().toString(36).slice(2, 12);

export function atasayBody(query: string, user = visitor(), session = visitor()): string {
  return JSON.stringify([
    {
      name: "SEARCH",
      type: "instant",
      query,
      userId: user,
      sessionId: session,
      device: "PC",
      lang: "TR",
      currency: "TRY",
      pageUrl: `${SITE}/`,
    },
  ]);
}

export const ATASAY_HEADERS = { "Content-Type": "text/plain", Origin: SITE, Referer: `${SITE}/` };

/** Every row of an instant-search answer: the top products and each category's. */
export function atasayRows(body: any): any[] {
  const s = body?.search?.[0]?.[0];
  if (!s) return [];
  return [...(s.products ?? []), ...Object.values<any[]>(s.categoryProducts ?? {}).flat()];
}

const title = (s: string) => s.toLocaleLowerCase("tr").replace(/(^|[\s-])\S/g, (c) => c.toLocaleUpperCase("tr"));

/**
 * The product type: the leaf of the first real category path
 * ("PIRLANTA > YÜZÜK > PIRLANTA TEKTAŞ YÜZÜK" → "Pırlanta Tektaş Yüzük").
 * "AYNI GÜN KARGO" (same-day shipping) is a merchandising bucket, used only
 * when it has a leaf of its own.
 */
export function atasayCategory(cats: unknown): string | null {
  const paths = (Array.isArray(cats) ? cats : []).map((c) => String(c ?? "").trim()).filter(Boolean);
  // A same-day path names a type only three levels down ("AYNI GÜN KARGO >
  // Pırlanta > Pırlanta Yüzük"); "AYNI GÜN KARGO > Erkek" is just a section.
  const real =
    paths.find((p) => !/^AYNI GÜN KARGO/i.test(p)) ??
    paths.find((p) => p.split(">").length >= 3) ??
    null;
  if (!real) return null;
  const leaf = real.split(">").pop()!.trim();
  return leaf ? title(leaf) : null;
}

export function atasayGender(name: string, cats: unknown): ProductRecord["gender"] {
  const s = [name, ...(Array.isArray(cats) ? cats : [])].join(" | ").toLocaleLowerCase("tr");
  if (/çocuk|bebek/.test(s)) return "cocuk";
  if (/erkek/.test(s)) return "erkek";
  if (/kadın|bayan/.test(s)) return "kadin";
  return null;
}

/** Map one Segmentify row. Pure; null for rows without a usable id, url or price. */
export function mapAtasay(p: any): ProductRecord | null {
  const price = Number(p?.price);
  const old = Number(p?.oldPrice);
  const id = p?.productId;
  const url = typeof p?.url === "string" ? p.url.split("?")[0] : "";
  if (!id || !p?.name || !url.startsWith(SITE) || !Number.isFinite(price) || price <= 0) return null;
  const img = typeof p.image === "string" && /^https?:\/\//.test(p.image) ? p.image : null;
  return {
    brand,
    country: "TR",
    externalId: String(id),
    name: String(p.name).trim(),
    url,
    imageUrl: img,
    images: img ? [img] : null,
    price: toMinor(price),
    // A strike price under a tenth of the price is a data error, not a deal.
    listPrice: Number.isFinite(old) && old > price && price >= old * 0.1 ? toMinor(old) : null,
    currency: "TRY",
    inStock: p.inStock !== false,
    category: atasayCategory(p.category),
    gender: atasayGender(String(p.name), p.category),
    variants: null,
    colorName: null,
  };
}

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (country !== "TR") return [];
  const byId = new Map<string, ProductRecord>();
  const user = visitor();
  const session = visitor();
  let answered = 0;
  for (const [i, q] of QUERIES.slice(0, MAX_QUERIES).entries()) {
    if (byId.size >= CAP) break;
    if (i > 0) await sleep(PAUSE_MS);
    const d = await getJson<any>(ENDPOINT, {
      method: "POST",
      body: atasayBody(q, user, session),
      headers: ATASAY_HEADERS,
      retries: 1,
    }).catch(() => null);
    if (d?.statusCode !== "SUCCESS") {
      if (i === 0) throw new Error(`atasay: Segmentify search refused (${d?.statusCode ?? "no answer"})`);
      continue;
    }
    answered++;
    for (const row of atasayRows(d)) {
      const r = mapAtasay(row);
      if (r && r.listPrice != null && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  }
  // Fewer than half the queries answering is a partial walk; failing the brand
  // keeps the delist sweep from marking the unseen half out of stock.
  if (answered < Math.ceil(Math.min(MAX_QUERIES, QUERIES.length) / 2)) {
    throw new Error(`atasay: only ${answered} Segmentify queries answered`);
  }
  return [...byId.values()].slice(0, CAP);
}
