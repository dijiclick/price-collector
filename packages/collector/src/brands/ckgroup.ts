/**
 * Charles & Keith and Pedro (one group, one Salesforce Commerce Cloud org) in
 * Singapore and Hong Kong, 2026-10-21.
 *
 * No API key, no proxy: the storefront's own grid endpoint
 * `/on/demandware.store/Sites-<ck|pd>-<cc>-Site/en_<CC>/Search-UpdateGrid?cgid=…&page=N&sz=…`
 * answers server-rendered tiles to a plain GET. Paging is `page` (1-based);
 * `start` is ignored by this site (every `start` returns page 1).
 *
 * Each tile is one colour (`data-pid-without-size`) and prints the shop's own
 * strikethrough: `<span class="strike-through list">…S$75.90…</span>` and
 * `<span class="sales …">S$60.70</span>` — the price every guest sees, GST
 * included. The `data-ga` JSON beside it carries name, colour and category but
 * its `price` is GST-exclusive, so prices are never read from it.
 *
 * Scope: Charles & Keith's sale category (`mcsale`, women's bags/shoes/
 * accessories); Pedro has no sale category, only its "Exclusive Deals"
 * (`pwexclusivedeal` women, `pmexclusivedeal` men) — online prices shown with a
 * strikethrough to every visitor, not member or coupon prices. Tiles without a
 * strikethrough are dropped. A grid tile is orderable unless it says otherwise
 * (`data-availability`).
 */
import { cleanGallery, type ProductRecord } from "../types";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { decodeEntities, jsonOf } from "./_sfcchtml";

export type CkGroupSlug = "charleskeith" | "pedro";

interface Shop {
  host: string;
  /** Site-id prefix: `Sites-<code>-<cc>-Site`. */
  code: string;
  /**
   * The site's own page size. `page=N` starts at (N-1) × this, whatever `sz`
   * asks for, so a page of `sz = step × k` tiles is fetched as page 1, 1+k, …
   */
  step: number;
  /** Markets with a deals category (Pedro HK has none: no sale, no exclusive deals). */
  markets: CountryCode[];
  /** Markets served from their own domain instead of `host` (same SFCC org, same grid). */
  hosts?: Partial<Record<CountryCode, string>>;
  cats: { cgid: string; gender: ProductRecord["gender"] }[];
}

export const CKGROUP: Record<CkGroupSlug, Shop> = {
  charleskeith: {
    host: "https://www.charleskeith.com",
    code: "ck",
    step: 18,
    markets: ["SG", "HK", "AE", "SA", "QA", "KW", "AU", "KR"],
    // AU and KR added 2026-10-21: same grid, AUD / KRW ("₩119,900"), English locale.
    // Gulf, 2026-10-21: UAE/Saudi/Qatar each have their own domain (the
    // charleskeith.com path answers "technical problems" for ae/qa); Kuwait
    // stays on charleskeith.com. Same `mcsale` grid, same 18-tile step.
    hosts: {
      AE: "https://www.charleskeith.ae",
      SA: "https://www.charleskeith.sa",
      QA: "https://www.charleskeith.qa",
    },
    cats: [{ cgid: "mcsale", gender: "kadin" }],
  },
  pedro: {
    host: "https://www.pedroshoes.com",
    code: "pd",
    step: 32,
    markets: ["SG"],
    cats: [
      { cgid: "pwexclusivedeal", gender: "kadin" },
      { cgid: "pmexclusivedeal", gender: "erkek" },
    ],
  },
};

/** Markets both shops run, with the English locale (HK's default is zh_HK). */
export const CKGROUP_MARKETS: Partial<Record<CountryCode, { cc: string; locale: string }>> = {
  SG: { cc: "sg", locale: "en_SG" },
  HK: { cc: "hk", locale: "en_HK" },
  AE: { cc: "ae", locale: "en_AE" },
  SA: { cc: "sa", locale: "en_SA" },
  QA: { cc: "qa", locale: "en_QA" },
  KW: { cc: "kw", locale: "en_KW" },
  // Charles & Keith only (Pedro AU/HK have no strikethrough category; their
  // "Promotions" page is editorial, 2026-10-21).
  AU: { cc: "au", locale: "en_AU" },
  KR: { cc: "kr", locale: "en_KR" },
};

/** The shop's host for a market. */
const hostOf = (s: Shop, country: CountryCode): string => s.hosts?.[country] ?? s.host;

/** Steps per request: C&K 180 tiles (~9 MB), Pedro 192. */
const STEPS = (s: Shop) => Math.floor(200 / s.step);
const MAX_PAGES = 12;
const PAUSE_MS = 600;
const CAP = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The i-th request (0-based) of a category's grid. */
export function gridUrl(slug: CkGroupSlug, country: CountryCode, cgid: string, i: number): string {
  const s = CKGROUP[slug];
  const m = CKGROUP_MARKETS[country]!;
  const k = STEPS(s);
  return `${hostOf(s, country)}/on/demandware.store/Sites-${s.code}-${m.cc}-Site/${m.locale}/Search-UpdateGrid?cgid=${cgid}&page=${1 + i * k}&sz=${s.step * k}`;
}

/** "S$1,075.90" / "HK$ 899.00" → 1075.9 / 899. */
export function moneyOf(s: string | undefined): number {
  const n = parseFloat(String(s ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/** "bagsSale" / "crossbodybagsSale" → "bags" / "crossbody bags"; NA → null. */
export function categoryOf(ga: any): string | null {
  const raw = [ga?.item_category3, ga?.item_category2].find(
    (c) => typeof c === "string" && c && c !== "NA" && !/^m?c?sale$/i.test(c),
  ) as string | undefined;
  if (!raw) return null;
  const t = raw
    .replace(/sale$/i, "")
    .replace(/(bags|shoes|wallets|accessories|sandals|heels|flats|sneakers|boots|jewellery|sunglasses)$/i, " $1")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return t || null;
}

/** Split an UpdateGrid response into tiles and map each. Pure. */
export function parseGrid(
  html: string,
  slug: CkGroupSlug,
  country: CountryCode,
  gender: ProductRecord["gender"],
): ProductRecord[] {
  const shop = CKGROUP[slug];
  const out: ProductRecord[] = [];
  const parts = html.split(/<div class="[^"]*\bjs-product-tile-wrapper\b/).slice(1);
  for (const c of parts) {
    const id = c.match(/data-pid-without-size="([^"]+)"/)?.[1];
    if (!id) continue;
    const ga = jsonOf<any>(decodeEntities(c.match(/data-ga="([^"]*)"/)?.[1] ?? "")) ?? {};
    const list = moneyOf(c.match(/class="strike-through list">\s*<span\s+class="value[^"]*">\s*([^<]+)</)?.[1]);
    const sale = moneyOf(c.match(/<span\s+class="sales[^"]*">\s*([^<]+)</)?.[1]);
    if (!(sale > 0 && list > sale)) continue;
    const cur = c.match(/data-currency="([A-Z]{3})"/)?.[1] ?? c.match(/itemprop="priceCurrency" content="([A-Z]{3})"/)?.[1] ?? ga.currency;
    if (cur && cur !== COUNTRIES[country].currency) {
      throw new Error(`${slug}/${country}: grid priced in ${cur}, not ${COUNTRIES[country].currency}`);
    }
    const imgs = [...c.matchAll(/<img[^>]*\ssrc="([^"]+)"[^>]*class="[^"]*js-tile-carousel-img/g)]
      .map((m) => decodeEntities(m[1]).replace(/([?&])sw=\d+&sh=\d+/, "$1sw=756&sh=1008"));
    const alt = decodeEntities(c.match(/class="[^"]*js-tile-carousel-img[^"]*"[^>]*alt="([^"]*)"/)?.[1] ?? "");
    const altParts = alt.split(",").map((s) => s.trim());
    const name = String(ga.item_name ?? altParts[0] ?? "").trim();
    if (!name) continue;
    const colour = altParts.length >= 3 ? altParts[altParts.length - 2] : null;
    const href = c.match(/class="full-pdp-link[^"]*"[^>]*href="([^"]+)"/)?.[1] ?? c.match(/href="(\/[a-z]{2}\/[^"]+\.html)"/)?.[1];
    const url = typeof ga.item_url === "string" && ga.item_url.startsWith("http") ? ga.item_url : href ? `${hostOf(shop, country)}${href}` : null;
    if (!url) continue;
    const avail = c.match(/data-availability="([^"]+)"/)?.[1];
    out.push({
      brand: slug,
      country,
      externalId: id,
      name,
      url,
      imageUrl: imgs[0] ?? null,
      images: cleanGallery(imgs, imgs[0] ?? null),
      price: toMinor(sale),
      listPrice: toMinor(list),
      currency: COUNTRIES[country].currency,
      inStock: avail ? !/out_of_stock|not_available|preorder_unavailable/i.test(avail) : true,
      category: categoryOf(ga),
      gender,
      variants: null,
      groupKey: c.match(/data-mpid="([^"]+)"/)?.[1] ? `${slug}:${c.match(/data-mpid="([^"]+)"/)![1]}` : null,
      colorName: colour,
    });
  }
  return out;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * GET with the session cookies a browser would keep. Charles & Keith runs an
 * A/B split that 302s a cookieless request to the same URL plus `&ampv=<arm>`
 * and, still without the cookie it just set, 302s again — a redirect loop for
 * a plain fetch. Following the hops by hand with the `Set-Cookie`s it sends
 * lands on the grid in one hop (no challenge, no bot wall). Returns the body
 * and the URL it finally came from (which names the arm).
 */
export async function fetchGrid(url: string, jar: Map<string, string>): Promise<{ html: string; url: string }> {
  let u = url;
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(u, {
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        "Accept-Language": "en;q=0.9",
        ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
      },
    });
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const kv = sc.split(";")[0];
      const i = kv.indexOf("=");
      if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      u = new URL(loc, u).toString();
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${u}`);
    return { html: await res.text(), url: u };
  }
  throw new Error(`too many redirects for ${url}`);
}

/**
 * The "personalised PLP" arm (`ampv=plp-personalised-ahp-treatment…`) caps the
 * grid at 50 tiles and re-orders it per visitor, so paging through it is not
 * stable. The arm is fixed per session (cookie), so a session is opened with a
 * one-tile request and re-rolled until it lands in the control arm.
 */
export const isPersonalisedArm = (finalUrl: string): boolean => /ampv=[^&]*ahp-treatment/.test(finalUrl);
const SESSION_TRIES = 8;

async function openSession(slug: CkGroupSlug, country: CountryCode, cgid: string): Promise<Map<string, string>> {
  for (let t = 0; t < SESSION_TRIES; t++) {
    const jar = new Map<string, string>();
    const { url } = await fetchGrid(gridUrl(slug, country, cgid, 0).replace(/sz=\d+/, "sz=1"), jar);
    if (!isPersonalisedArm(url)) return jar;
    await sleep(300);
  }
  throw new Error(`${slug}/${country}: every session landed in the personalised (50-tile) arm`);
}

export async function listCkGroup(slug: CkGroupSlug, country: CountryCode): Promise<ProductRecord[]> {
  if (!CKGROUP_MARKETS[country] || !CKGROUP[slug].markets.includes(country)) return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const cat of CKGROUP[slug].cats) {
    const jar = await openSession(slug, country, cat.cgid);
    const size = CKGROUP[slug].step * STEPS(CKGROUP[slug]);
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) throw new Error(`${slug}/${country}: ${cat.cgid} still paging after ${MAX_PAGES} pages`);
      if (requests++ > 0) await sleep(PAUSE_MS);
      const { html, url } = await fetchGrid(gridUrl(slug, country, cat.cgid, page), jar);
      if (isPersonalisedArm(url)) throw new Error(`${slug}/${country}: session switched to the personalised arm on page ${page}`);
      const tiles = (html.match(/data-pid-without-size="/g) ?? []).length;
      let fresh = 0;
      for (const r of parseGrid(html, slug, country, cat.gender)) {
        if (!byId.has(r.externalId)) {
          byId.set(r.externalId, r);
          fresh++;
        }
      }
      if (process.env.CKGROUP_DEBUG) console.error(`${slug}/${country} ${cat.cgid} p${page}: ${tiles} tiles, ${fresh} new`);
      // Pages must not overlap; if they do, the site's page step changed.
      if (tiles >= size && fresh < tiles * 0.8) {
        throw new Error(`${slug}/${country}: ${cat.cgid} page ${page} repeats ${tiles - fresh}/${tiles} tiles — page step changed?`);
      }
      // A short page is the last one.
      if (tiles < size) break;
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listCharlesKeith = (c: CountryCode) => listCkGroup("charleskeith", c);
export const listPedro = (c: CountryCode) => listCkGroup("pedro", c);
