/**
 * The brand QA's network half (2026-10-22): check one sampled deal against
 * its shop, and one brand page against the app's API. Platform-free (global
 * fetch, injectable for tests) like link-check.ts, whose verdict rules it
 * reuses: the product page is fetched ONCE, following redirects the way
 * `checkLink` does, and that one answer gives the link verdict (`verdictFor`),
 * the soft-404/wall test and the prices. The photo goes through `checkImage`.
 */
import { LINK_UA, checkImage, verdictFor, type LinkResult } from "../link-check";
import { isSoft404, isWallPage, pageFacts, shopifyFacts, shopifyJsUrl, type PageFacts, type ShopifyFacts } from "./page";
import { STALE_MS, near, type AppCheck, type LinkState, type PriceState, type SampleResult } from "./rules";

export interface Sample {
  id: number;
  country: string;
  brand: string;
  name: string;
  url: string;
  image_url: string | null;
  /** amount×100 */
  price: number;
  list: number | null;
  currency: string;
  last_seen: string | Date;
}

export interface Page {
  status: number | null;
  finalUrl: string | null;
  html: string;
  /** The answer's content-language header (Shopify Markets: en-US, en-DE…). */
  contentLanguage?: string | null;
  err?: string;
}

const MAX_BODY = 4_000_000;

/**
 * GET `url`, following at most 8 redirects by hand (so the chain is the one
 * `checkLink` judges), and read the final answer's body. Never throws.
 */
export async function fetchPage(
  url: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch; lang?: string; accept?: string } = {},
): Promise<Page> {
  const doFetch = opts.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  let cur = url;
  try {
    for (let hop = 0; hop <= 8; hop++) {
      const res = await doFetch(cur, {
        method: "GET",
        redirect: "manual",
        signal,
        headers: {
          "user-agent": LINK_UA,
          accept: opts.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": opts.lang ?? "en-US,en;q=0.9",
        },
      });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        try {
          await res.body?.cancel();
        } catch {
          /* already closed */
        }
        cur = new URL(loc, cur).toString();
        continue;
      }
      const buf = await res.arrayBuffer();
      const html = new TextDecoder("utf-8").decode(buf.byteLength > MAX_BODY ? buf.slice(0, MAX_BODY) : buf);
      return { status: res.status, finalUrl: cur, html, contentLanguage: res.headers.get("content-language") };
    }
    return { status: null, finalUrl: cur, html: "", err: "redirect loop" };
  } catch (err) {
    return { status: null, finalUrl: null, html: "", err: err instanceof Error ? err.name : "error" };
  }
}

const bareHost = (u: string) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};
const firstSeg = (u: string) => {
  try {
    return new URL(u).pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
  } catch {
    return "";
  }
};
const LOCALE_SEG = /^[a-z]{2}([-_][a-z]{2})?$/i;

/**
 * Can a "moved"/"not found" answer seen from this box be trusted for this
 * market? Turkey yes (as links.ts does). Elsewhere only when the redirect
 * stayed on the same host AND the same locale prefix (/en-us/… → /en-us/women):
 * a geo redirect from Germany changes one of the two (calvinklein.us → .ie,
 * showpo /ca/ → /row/), a pulled product does not.
 */
export function trustedFromHere(country: string, from: string, to: string | null): boolean {
  if (!to || bareHost(from) !== bareHost(to)) return false;
  if (country === "TR") return true;
  const a = firstSeg(from);
  return LOCALE_SEG.test(a) && a === firstSeg(to);
}

/** The link's state from the one page fetch. Pure, for tests. */
export function linkState(s: Pick<Sample, "url" | "country"> & { name?: string }, page: Page, title: string | null): { state: LinkState; note?: string; r: LinkResult } {
  const r = verdictFor(s.url, page.status, page.finalUrl);
  if (page.status === null) return { state: "unknown", note: page.err ?? "no answer", r };
  if (isWallPage(page.status, page.html, title)) return { state: "blocked", note: `wall (http ${page.status})`, r };
  if (r.verdict === "gone") return { state: "bad", note: `http ${page.status}${r.note ? ` (${r.note})` : ""}`, r };
  if (r.verdict === "moved") {
    return trustedFromHere(s.country, s.url, page.finalUrl)
      ? { state: "bad", note: `redirects to a listing: ${page.finalUrl}`, r }
      : { state: "unknown", note: `redirect, untrusted from here: ${page.finalUrl}`, r };
  }
  if (r.verdict === "ok" && isSoft404(title, s.name)) {
    return page.finalUrl === s.url || trustedFromHere(s.country, s.url, page.finalUrl)
      ? { state: "bad", note: `not-found page: "${title}"`, r }
      : { state: "unknown", note: `not-found page after a redirect: ${page.finalUrl}`, r };
  }
  if (r.verdict === "ok") return { state: "ok", r };
  return { state: "unknown", note: r.note ?? `http ${page.status}`, r };
}

/** The country of a content-language ("en-US" → "US"), null when it names none. */
export function marketOf(contentLanguage: string | null | undefined): string | null {
  const m = (contentLanguage ?? "").trim().match(/^[a-z]{2,3}[-_]([a-z]{2})\b/i);
  return m ? m[1].toUpperCase() : null;
}

/** Image urls that are a shop's "no photo" stand-in, not the product. */
const PLACEHOLDER = /placeholder|no[-_]?image|noimage|image[-_]?not[-_]?available|no[-_]?photo|default[-_]?product|coming[-_]?soon/i;

export function imageState(url: string | null, r: LinkResult | null): { state: LinkState; note?: string } {
  if (!url) return { state: "bad", note: "no photo url" };
  if (PLACEHOLDER.test(url) || (r?.finalUrl && PLACEHOLDER.test(r.finalUrl))) return { state: "bad", note: "placeholder image" };
  if (!r) return { state: "unknown" };
  if (r.verdict === "gone") return { state: "bad", note: `http ${r.http}` };
  if (r.verdict === "ok") return { state: "ok" };
  if (r.http === 403 || r.http === 429 || r.http === 401) return { state: "blocked", note: `http ${r.http}` };
  return { state: "unknown", note: r.note };
}

/**
 * Our price against the shop's, and whether our "was" price is the shop's.
 * Pure, for tests. Only prices in our currency (or with none stated) count;
 * Shopify .js prices count only when the page says which currency it priced
 * in and it is ours.
 */
export function judgePrice(
  s: Pick<Sample, "price" | "list" | "currency">,
  facts: PageFacts,
  shop: ShopifyFacts | null,
): { price: PriceState; shopPrices: number[]; note?: string; fake: boolean; fakeNote?: string } {
  const ours = s.currency.toUpperCase();
  const fromPage = facts.prices.filter((p) => p.currency === null || p.currency === ours).map((p) => p.amount);
  const shopOk = !!shop && facts.currency === ours;
  const all = [...new Set([...fromPage, ...(shopOk ? shop!.prices : [])])];
  const others = [...new Set(facts.prices.filter((p) => p.currency && p.currency !== ours).map((p) => p.currency))];
  let price: PriceState = "unknown";
  let note: string | undefined;
  if (all.some((p) => near(p, s.price))) price = "match";
  else if (all.length) price = "mismatch";
  else note = others.length ? `shop answered in ${others.join("/")}` : facts.currency && facts.currency !== ours ? `shop answered in ${facts.currency}` : "no price on the page";

  let fake = false;
  let fakeNote: string | undefined;
  const list = s.list ?? 0;
  if (list > s.price) {
    const range = facts.ranges.find(
      (r) => r.multi && (r.currency === null || r.currency === ours) && r.low < r.high && near(r.low, s.price) && near(r.high, list),
    );
    if (range) {
      fake = true;
      fakeNote = `our was-price is the top of the shop's price range ${range.low}–${range.high}`;
    } else if (shopOk && price === "match" && list > s.price * 1.02 && !shop!.hasWasPrice) {
      fake = true;
      fakeNote = "the shop shows no was-price (no compare_at_price on any variant)";
    }
  }
  return { price, shopPrices: all.slice(0, 8), note, fake, fakeNote };
}

/** Check one sampled deal: page (link + prices), Shopify .js when it helps, photo. Never throws. */
export async function checkSample(
  s: Sample,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch; now?: number } = {},
): Promise<SampleResult> {
  // Abroad, NO accept-language: with one, Shopify Markets answers this German
  // box as its en-DE market — EUR prices, often still labelled USD/AUD (Quay,
  // Glossier, Spell, Benetton IT, 2026-10-22). Without one it answers the
  // store's own market (content-language en-US, en-AU, it-IT).
  const lang = s.country === "TR" ? "tr-TR,tr;q=0.9,en;q=0.8" : "";
  const page = await fetchPage(s.url, { timeoutMs: opts.timeoutMs, fetchImpl: opts.fetchImpl, lang });
  const facts = page.html ? pageFacts(page.html) : { title: null, prices: [], ranges: [], currency: null, shopify: false };
  const link = linkState(s, page, facts.title);

  let pr: ReturnType<typeof judgePrice> = { price: "unknown", shopPrices: [], note: link.state === "ok" ? undefined : "page not checked", fake: false };
  if (link.state === "ok") {
    let shop: ShopifyFacts | null = null;
    // Shopify answers /products/<handle>.js with every variant's price and
    // compare_at_price: the cheapest honest source of the shop's "was" price.
    // But Shopify Markets picks the market from this box's IP as soon as an
    // accept-language is sent, and the German market of a US/AU store drops
    // every compare_at_price (Princess Polly, Universal Store, 2026-10-22). An
    // EMPTY accept-language gets the store's primary market; the answer is
    // used only when its content-language names the sample's own country.
    const js = facts.shopify && (s.list ?? 0) > s.price ? shopifyJsUrl(page.finalUrl ?? s.url) : null;
    if (js) {
      const r = await fetchPage(js, { timeoutMs: opts.timeoutMs, fetchImpl: opts.fetchImpl, lang: "", accept: "application/json" });
      try {
        if (r.status === 200 && marketOf(r.contentLanguage) === s.country) shop = shopifyFacts(JSON.parse(r.html));
      } catch {
        /* not json: a theme that does not serve .js */
      }
    }
    const market = marketOf(page.contentLanguage);
    pr = facts.shopify && market && market !== s.country
      ? { price: "unknown", shopPrices: [], note: `Shopify answered for its ${market} market`, fake: false }
      : judgePrice(s, facts, shop);
  }

  const imgR = s.image_url && /^https?:\/\//.test(s.image_url)
    ? await checkImage(s.image_url, { timeoutMs: opts.timeoutMs, fetchImpl: opts.fetchImpl })
    : null;
  const img = imageState(s.image_url, imgR);
  const seen = new Date(s.last_seen).getTime();
  return {
    id: s.id,
    name: s.name,
    url: s.url,
    image: s.image_url,
    price: s.price,
    list: s.list,
    currency: s.currency,
    lastSeen: new Date(seen).toISOString(),
    link: link.state,
    linkNote: link.note,
    finalUrl: page.finalUrl !== s.url ? page.finalUrl : undefined,
    http: page.status,
    img: img.state,
    imgNote: img.note,
    priceCheck: pr.price,
    shopPrices: pr.shopPrices.length ? pr.shopPrices : undefined,
    priceNote: pr.note,
    fake: pr.fake,
    fakeNote: pr.fakeNote,
    stale: (opts.now ?? Date.now()) - seen > STALE_MS,
  };
}

/** The app's brand page, exactly as the app asks for it. Never throws. */
export async function checkApp(
  api: string,
  country: string,
  brand: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<AppCheck> {
  const page = await fetchPage(`${api}/api/deals?country=${country}&brand=${encodeURIComponent(brand)}&limit=12`, {
    timeoutMs: opts.timeoutMs ?? 30_000,
    fetchImpl: opts.fetchImpl,
    accept: "application/json",
  });
  if (page.status !== 200) return { status: page.status ?? 0, items: 0, noImage: 0 };
  try {
    const j = JSON.parse(page.html) as { deals?: { imageUrl?: string | null }[] };
    const deals = Array.isArray(j.deals) ? j.deals : [];
    return { status: 200, items: deals.length, noImage: deals.filter((d) => !d.imageUrl).length };
  } catch {
    return { status: 0, items: 0, noImage: 0 };
  }
}
