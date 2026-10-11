/**
 * Ounass — Al Tayer's luxury marketplace (UAE ounass.ae, KSA
 * en-saudi.ounass.com). Measured 2026-10-11:
 *
 * - The PLP itself answers JSON when asked (`Accept: application/json`): 24
 *   style-colours per page with price, strikethrough, per-size stock, colour,
 *   class and gallery, in the market's currency (KSA rows are SAR; the
 *   `slashedPriceInAED` beside them proves it). `fh_start_index` pages it;
 *   no page-size parameter is honoured (fh_view_size/view_size/viewSize all
 *   ignored), and the app's `/api/v2/...` path sits behind the same wall.
 * - Cloudflare rate-limits per IP hard: the first request from an address is
 *   served, the next one seconds later gets a 429 challenge. So the first page
 *   goes direct and, on the first refusal, the rest of the run goes through the
 *   residential proxy (DataImpulse rotates the exit per connection, so every
 *   page is a fresh IP — measured 6/6 pages 200 through the AE exit).
 * - Every response carries a ~15.6 KB Content-Security-Policy header, which is
 *   over undici's default 16 KB header limit (UND_ERR_HEADERS_OVERFLOW on a
 *   runner). That is why this adapter brings its own dispatchers with a larger
 *   `maxHeaderSize` instead of using http.ts.
 * - Cost: ~34 KB on the wire per page through the proxy (17 KB headers +
 *   ~10 KB gzip body + TLS). The default cap of 720 rows is 30 pages, i.e.
 *   ~1 MB of proxy traffic per market per run. OUNASS_MAX_PRODUCTS tunes it.
 */
import { Agent, ProxyAgent, type Dispatcher } from "undici";
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { toMinor } from "../normalize";
import { proxyUrlFor } from "../../../../lib/live-lookup";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const SITE: Partial<Record<CountryCode, string>> = {
  AE: "https://www.ounass.ae",
  SA: "https://en-saudi.ounass.com",
};
/** Sale departments and the share of the cap each may take. */
const DEPARTMENTS: { path: string; gender: ProductRecord["gender"]; share: number }[] = [
  { path: "/women/sale", gender: "kadin", share: 0.7 },
  { path: "/men/sale", gender: "erkek", share: 0.3 },
];
const PAGE = 24;
// 360, not 720: owner wants the proxy budget "very very little" (2026-10-11) —
// ~0.5 MB a market per run, ~0.2 GB a month at the 4-hourly intl sweep.
const CAP = Number(process.env.OUNASS_MAX_PRODUCTS ?? 360);
const PAUSE_MS = Number(process.env.OUNASS_PAUSE_MS ?? 700);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const direct = new Agent({ maxHeaderSize: 65536 });
const proxies = new Map<string, Dispatcher | undefined>();
function proxyFor(country: CountryCode): Dispatcher | undefined {
  const exit = COUNTRIES[country].proxyExit;
  if (!proxies.has(exit)) {
    const url = proxyUrlFor(process.env.DATAIMPULSE_PROXY, exit);
    proxies.set(exit, url ? new ProxyAgent({ uri: url, maxHeaderSize: 65536 }) : undefined);
  }
  return proxies.get(exit);
}

const abs = (u: unknown): string | null =>
  typeof u === "string" && u ? (u.startsWith("//") ? `https:${u}` : u.startsWith("http") ? u : null) : null;

function genderOf(sc: any, fallback: ProductRecord["gender"]): ProductRecord["gender"] {
  const g = String(sc?.gender ?? sc?.group ?? "").toLowerCase();
  if (/kid|girl|boy|baby/.test(g)) return "cocuk";
  if (/women|ladies/.test(g)) return "kadin";
  if (/\bmen/.test(g)) return "erkek";
  return fallback;
}

/** Map one PLP style-colour. Pure. */
export function mapOunass(country: CountryCode, sc: any, fallback: ProductRecord["gender"] = null): ProductRecord | null {
  const site = SITE[country];
  const price = Number(sc?.price);
  const was = Number(sc?.slashedPrice);
  if (!site || !sc?.styleColorId || !sc?.name || typeof sc?.url !== "string" || !(price > 0)) return null;
  const designer = String(sc.designerCategoryEnglishName ?? sc.designerCategoryName ?? "").trim();
  const title = String(sc.nameInEnglish ?? sc.name).replace(/\s+/g, " ").trim();
  const sizes: SizeVariant[] = [];
  if (sc.showSizeSelector !== false) {
    const seen = new Set<string>();
    for (const s of sc.sizes ?? []) {
      const label = String(s?.sizeCode ?? "").trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      const q = Number(s?.stock ?? 0);
      sizes.push({ label, availability: q <= 0 ? "out_of_stock" : q <= 2 ? "low_on_stock" : "in_stock" });
    }
  }
  const imgs = [abs(sc.thumbnail), abs(sc.hoverImage)].filter((u): u is string => !!u);
  const colour = String(sc.colorInEnglish ?? "").trim() || null;
  return {
    brand: "ounass",
    country,
    externalId: String(sc.styleColorId),
    name: designer && !title.toLowerCase().includes(designer.toLowerCase()) ? `${designer} ${title}` : title,
    url: `${site}${sc.url.startsWith("/") ? "" : "/"}${sc.url}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: was > price ? toMinor(was) : null,
    currency: COUNTRIES[country].currency,
    inStock: sc.outOfStock !== true && (sizes.length === 0 || sizes.some((s) => s.availability !== "out_of_stock")),
    category: String(sc.subClass ?? sc.class ?? "").trim() || null,
    gender: genderOf(sc, fallback),
    variants: sizes.length || colour ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: sc.parentSku ? `ounass:${sc.parentSku}` : null,
    colorName: colour,
  };
}

export const ounassPageUrl = (country: CountryCode, path: string, start: number) =>
  `${SITE[country]}${path}?fh_start_index=${start}`;

/** One page. Direct until the site refuses once, then the proxy for the rest of the run. */
async function page(country: CountryCode, url: string, state: { proxied: boolean }): Promise<any | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const dispatcher = state.proxied ? proxyFor(country) : direct;
    if (state.proxied && !dispatcher) return null;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json", "Accept-Language": `en-${country},en;q=0.9` },
        // @ts-expect-error undici dispatcher is accepted by Node's fetch
        dispatcher,
      });
      if (res.ok && /json/.test(res.headers.get("content-type") ?? "")) return await res.json();
      await res.arrayBuffer().catch(() => null);
    } catch {
      /* network error: fall through to the proxy */
    }
    state.proxied = true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

export async function listOunass(country: CountryCode): Promise<ProductRecord[]> {
  if (!SITE[country]) return [];
  const state = { proxied: false };
  const byId = new Map<string, ProductRecord>();
  let first = true;
  for (const dep of DEPARTMENTS) {
    const want = Math.round(CAP * dep.share);
    let taken = 0;
    for (let start = 0; taken < want; start += PAGE) {
      if (!first) await new Promise((r) => setTimeout(r, PAUSE_MS));
      first = false;
      const data = await page(country, ounassPageUrl(country, dep.path, start), state);
      const rows: any[] = data?.plp?.styleColors ?? [];
      if (!data && byId.size === 0) throw new Error(`ounass/${country}: PLP refused (direct and proxy)`);
      for (const sc of rows) {
        const r = mapOunass(country, sc, dep.gender);
        if (!r || r.listPrice == null || byId.has(r.externalId)) continue;
        byId.set(r.externalId, r);
        taken++;
      }
      if (rows.length < PAGE || start + PAGE >= Number(data?.plp?.pagination?.totalItems ?? 0)) break;
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
