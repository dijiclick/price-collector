/**
 * The daily brand QA's verdict rules (2026-10-22). Pure, so the rules live in
 * one tested place; run.ts does the fetching and lib/brand-qa.ts serves the
 * result at /api/health/quality.
 *
 * Every sample (one in-stock deal from feed_items) gets four answers:
 *   link   ok | bad (404/410 on its own path, a soft 404, a redirect to a
 *          category/home page — see link-check.ts) | blocked | unknown
 *   photo  ok | bad (404/410, or a placeholder) | blocked | unknown
 *   price  match | mismatch (the page states prices in OUR currency and none
 *          is ours) | unknown (blocked, no price on the page, another currency)
 *   fake   true when the shop shows no "was" price for what we sell as reduced
 *          (Shopify: no variant has a compare_at_price; JSON-LD: our list price
 *          is just the top of an AggregateOffer's size range — Sephora −%81,
 *          2026-09-18)
 * Blocked and unknown are NEVER failures: this box is in Germany, and most
 * Turkish shops (and Akamai/Cloudflare walls) refuse it.
 */

export type LinkState = "ok" | "bad" | "blocked" | "unknown";
export type PriceState = "match" | "mismatch" | "unknown";

export interface SampleResult {
  id: number;
  name: string;
  url: string;
  image: string | null;
  /** Ours, amount×100. */
  price: number;
  list: number | null;
  currency: string;
  lastSeen: string;
  link: LinkState;
  /** What the link check saw: http status, where it ended, why. */
  linkNote?: string;
  finalUrl?: string | null;
  http?: number | null;
  img: LinkState;
  imgNote?: string;
  priceCheck: PriceState;
  /** The page's prices in our currency (amount×100), for the evidence. */
  shopPrices?: number[];
  priceNote?: string;
  fake: boolean;
  fakeNote?: string;
  stale: boolean;
}

export interface AppCheck {
  /** HTTP status of /api/deals, 0 when it did not answer. */
  status: number;
  items: number;
  noImage: number;
}

export interface PairCounts {
  sampled: number;
  link_bad: number;
  img_bad: number;
  price_mismatch: number;
  fake_discount: number;
  blocked: number;
  stale: number;
  app_empty: boolean;
}

export type Verdict = "ok" | "warn" | "bad";

/** A deal not seen by its collector for this long is stale. */
export const STALE_MS = 24 * 3_600_000;
/** Within max(2 minor units, 1.1%) is the same price (rounding, cents shown or not). */
export const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(2, b * 0.011);

/** Did this sample prove something wrong? (Blocked/unknown never do.) */
export const faulty = (s: SampleResult) =>
  s.link === "bad" || s.img === "bad" || s.priceCheck === "mismatch" || s.fake;

export function countPair(samples: SampleResult[], app: AppCheck | null, dbDeals: number): PairCounts {
  const n = (f: (s: SampleResult) => boolean) => samples.filter(f).length;
  return {
    sampled: samples.length,
    link_bad: n((s) => s.link === "bad"),
    img_bad: n((s) => s.img === "bad"),
    price_mismatch: n((s) => s.priceCheck === "mismatch"),
    fake_discount: n((s) => s.fake),
    // The page itself refused us: nothing about this sample could be proven.
    blocked: n((s) => s.link === "blocked"),
    stale: n((s) => s.stale),
    app_empty: dbDeals > 0 && !!app && app.status === 200 && app.items === 0,
  };
}

/**
 * The pair's verdict and the reasons, in plain words for the fixer.
 *   bad  — the app's brand page is empty while the DB has deals, or at least
 *          two samples PROVED wrong (link, photo, price or fake "was" price,
 *          in any mix): one is bad luck, two is a pattern.
 *   warn — one sample proved wrong; most samples stale; the app's brand page
 *          errored, or shows deals without a photo.
 *   ok   — everything else, including pairs we could not verify at all
 *          (walled) and pairs with no deals (the crawler watchdog owns empties).
 */
export function judgePair(
  samples: SampleResult[],
  app: AppCheck | null,
  dbDeals: number,
): { counts: PairCounts; verdict: Verdict; reasons: string[] } {
  const c = countPair(samples, app, dbDeals);
  const reasons: string[] = [];
  const bad = samples.filter(faulty).length;
  if (c.app_empty) reasons.push(`app brand page empty while the DB has ${dbDeals} deals`);
  if (c.link_bad) reasons.push(`${c.link_bad}/${c.sampled} links broken (404, category or home page)`);
  if (c.img_bad) reasons.push(`${c.img_bad}/${c.sampled} photos broken`);
  if (c.price_mismatch) reasons.push(`${c.price_mismatch}/${c.sampled} prices differ from the shop`);
  if (c.fake_discount) reasons.push(`${c.fake_discount}/${c.sampled} discounts the shop does not show (no was-price / size range)`);
  const staleMany = c.sampled > 0 && c.stale * 2 > c.sampled;
  if (staleMany) reasons.push(`${c.stale}/${c.sampled} deals not seen by the collector for 24 h+`);
  const appErr = dbDeals > 0 && (!app || app.status !== 200);
  if (appErr) reasons.push(`app brand page answered ${app?.status || "nothing"}`);
  const noImg = !!app && app.noImage > 0;
  if (noImg) reasons.push(`app brand page shows ${app!.noImage} deals without a photo`);

  const verdict: Verdict = c.app_empty || bad >= 2 ? "bad" : bad === 1 || staleMany || appErr || noImg ? "warn" : "ok";
  return { counts: c, verdict, reasons };
}
