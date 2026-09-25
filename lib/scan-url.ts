import { COUNTRIES, type CountryCode } from "./countries";

/**
 * Reading a scanned code, with no runtime dependencies.
 *
 * This lives apart from `live-lookup.ts` on purpose. That module imports
 * undici, which is Node-only, and the moment the mobile app imported a single
 * function from it Metro tried to bundle `node:events` and the export died:
 *
 *   lib/live-lookup.ts -> undici -> node:events   (unbundleable)
 *
 * TypeScript and the test suite both run in Node, so neither noticed; only a
 * real Metro export did. Anything the APP and the SERVER both need belongs in
 * a file like this one, free of platform imports.
 */

/**
 * The barcode hiding inside a scanned URL, if there is one.
 *
 * A garment tag usually carries TWO symbols: a linear EAN and a QR. Zara's QR
 * encodes `https://www.zara.com/qr/0106343940002` — a redirect whose path IS
 * the article code. Scanners lock onto whichever symbol they see first, so the
 * same tag resolved instantly one time (digits) and not at all the next (URL).
 *
 * Verified 2026-08-26 against the live API: `?barcode=0106343940002` returned
 * the shirt; `?url=http://www.zara.com/qr/0106343940002` returned nothing.
 *
 * Only `/qr/` style paths count. A normal product URL also contains long digit
 * runs (`…-p01063439.html?v1=529918046`) and must keep going down the URL path,
 * where the colour variant in `v1` is what makes the match exact.
 */
export function barcodeFromScanUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const m = u.pathname.match(/\/(?:qr|barcode|ean|gtin)\/(\d{8,20})\/?$/i);
  return m ? m[1] : null;
}

/**
 * Which market a pasted product url is for, or null if it does not say.
 *
 * Every brand encodes it differently and one of them lies about it: Zara's
 * British path segment is `uk`, not `gb`. Deriving the code from the segment
 * would read `uk` as "no country", and `/api/resolve` would then match a pasted
 * British link against the Turkish catalogue and answer with a lira price.
 *
 * `null` means "the url does not say", NOT "unsupported": callers read it as
 * Turkey, which is what every url without a country marker has always been.
 * A market we can reach but have not enabled — `/de/en/` — also returns null,
 * so a paste from Germany resolves against Turkey rather than writing a row for
 * a country nothing collects.
 *
 * Lives here rather than in `live-lookup.ts` for the reason at the top of this
 * file: the app imports this module, and `live-lookup.ts` pulls in undici.
 */

/**
 * Path segment or locale fragment → our country code. Every market the
 * collector sweeps, launched or not.
 *
 * This used to be a hand-written list of the first four markets, and it went
 * stale the day US, CA, AU, CH and NO launched: a pasted `zara.com/us/en/…`
 * read as "no country", fell back to Turkey, and a live Mango lookup for it
 * came back priced in lira. Deriving it from `COUNTRIES` means a market that
 * is added there is readable here without anyone remembering this file.
 * Unlaunched markets are included on purpose — they are swept, so their rows
 * exist, and a German link answered in lira is a wrong price, not a fallback.
 */
const SEGMENT_COUNTRY: Record<string, CountryCode> = {
  ...Object.fromEntries(
    (Object.keys(COUNTRIES) as CountryCode[]).map((c) => [c.toLowerCase(), c]),
  ),
  // Zara, Pull&Bear and Bershka all use `uk` for Britain. The single most
  // load-bearing entry in this table.
  uk: "GB",
};

export function countryFromUrl(raw: string): CountryCode | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const segments = u.pathname.split("/").filter(Boolean);
  const first = (segments[0] ?? "").toLowerCase();

  // H&M: /en_gb/… or /tr_tr/…  — Guess: /en-gb/… — take the half after the mark.
  const locale = first.match(/^([a-z]{2})[_-]([a-z]{2})$/);
  if (locale) return SEGMENT_COUNTRY[locale[2]] ?? null;

  // Inditex, Zara, Mango: the first segment IS the market.
  if (/^[a-z]{2}$/.test(first)) return SEGMENT_COUNTRY[first] ?? null;

  // Pandora puts it in the host (tr.pandora.net). Only the leftmost label, so a
  // `www.` host is never read as a country.
  const label = host.split(".")[0];
  if (/^[a-z]{2}$/.test(label)) return SEGMENT_COUNTRY[label] ?? null;

  return null;
}

/**
 * The product url inside whatever the user pasted or a shop app shared.
 *
 * Shop apps rarely share a bare url. They share a sentence — "Bunu gördün mü?
 * https://www.zara.com/…" — and a person copying from a message thread copies
 * the whole bubble. `/api/resolve` answered those with 400 `invalid_url`,
 * because it only accepted a string that STARTED with http. The share-sheet
 * path in the app already digs the url out (`shareUrlFrom`), but paste did
 * not, and neither did any other client, so the server does it too.
 *
 * Also accepts a scheme-less `www.zara.com/…` or `zara.com/…` — what a url
 * looks like after it has been copied out of a browser's address bar on some
 * phones. Trailing sentence punctuation is trimmed; quotes and brackets around
 * the url are not part of it.
 */
export function urlFromText(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const clean = (s: string) => s.replace(/[.,;:!?)\]}>"'»”’]+$/u, "");
  const withScheme = /https?:\/\/[^\s<>"'«»“”]+/i.exec(text);
  if (withScheme) return clean(withScheme[0]);
  // No scheme: only take something that is plainly a host with a path, so a
  // search query like "zara gömlek" is never mistaken for a link.
  const bare = /(?:^|\s)((?:[a-z0-9-]+\.)+[a-z]{2,}(?:\.[a-z]{2})?\/[^\s<>"'«»“”]*)/i.exec(text);
  if (bare) return `https://${clean(bare[1])}`;
  return null;
}

/**
 * The host every stored url of a brand uses. A pasted link that differs only
 * in host — `m.`, no `www.`, `hm.com` for `www2.hm.com` — is the same page, and
 * the exact-url match in the catalogue only works if the host is the stored one.
 * Brands whose ids carry no long digit run (Guess, Penti, Pandora) have no
 * other way to match, so for them a host mismatch was a guaranteed miss.
 */
const CANONICAL_HOST: Record<string, string> = {
  "zara.com": "www.zara.com",
  "bershka.com": "www.bershka.com",
  "stradivarius.com": "www.stradivarius.com",
  "pullandbear.com": "www.pullandbear.com",
  "massimodutti.com": "www.massimodutti.com",
  "oysho.com": "www.oysho.com",
  "hm.com": "www2.hm.com",
  "guess.eu": "www.guess.eu",
  "mango.com": "shop.mango.com",
  "koton.com": "www.koton.com",
  "penti.com": "www.penti.com",
  "boyner.com.tr": "www.boyner.com.tr",
  "beymen.com": "www.beymen.com",
  "gratis.com": "www.gratis.com",
  "sephora.com.tr": "www.sephora.com.tr",
  "rossmann.com.tr": "www.rossmann.com.tr",
  "watsons.com.tr": "www.watsons.com.tr",
};

/**
 * Query parameters that only say where a click came from. Dropping them never
 * changes the product; keeping them makes the url miss the exact match.
 * Deliberately a deny-list: Zara's `v1` (the colour) and Pull&Bear's
 * `pelement` are part of what the stored url means and must survive.
 */
const TRACKING_PARAM = /^(utm_\w+|gclid|gbraid|wbraid|fbclid|igshid|igsh|ttclid|twclid|msclkid|yclid|srsltid|_branch_\w+|~\w+|mc_cid|mc_eid|_ga|_gl|ref|referrer|share(?:_\w+)?|sc_\w+|adj_\w+|af_\w+|is_retargeting|deep_link_\w+|shortlink)$/i;

/** A pasted product url in the form the catalogue stores it. */
export function canonicalProductUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw); } catch { return raw; }
  if (!/^https?:$/.test(u.protocol)) return raw;
  u.protocol = "https:";
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const bare = host.replace(/^(?:www2?|m|mobile|shop|touch)\./, "");
  u.hostname = CANONICAL_HOST[bare] ?? host;
  // H&M's country picker keeps the page a browser asked for in `orguri`
  // (`www.hm.com/entrance.ahtml?orguri=%2Ftr_tr%2Fproductpage.…html`), and that
  // is what gets copied from the address bar on a first visit.
  const orguri = u.searchParams.get("orguri");
  if (bare === "hm.com" && orguri?.startsWith("/")) {
    try { return new URL(orguri, `https://${u.hostname}`).toString(); } catch { /* fall through */ }
  }
  for (const k of [...u.searchParams.keys()]) {
    if (TRACKING_PARAM.test(k)) u.searchParams.delete(k);
  }
  u.hash = "";
  return u.toString();
}

/**
 * The catalogue `external_id`s a pasted url can only mean, for brands whose
 * url carries the stored id verbatim.
 *
 * Why this exists: `products` has no index on `url`, so `findProductByUrl` is
 * a sequential scan of ~1.8M rows — measured 3.5s for the exact-url pass and
 * 15s for Zara's id-in-url fallback. The `(brand, country, external_id)` key
 * IS indexed, so a url we can map to its id is a millisecond lookup instead.
 *
 * Every entry mirrors how that brand's collector builds `externalId`; a brand
 * whose stored id is not in its url (Koton, Oysho, Bershka) returns
 * nothing and keeps the slow path.
 */
export function externalIdsFromUrl(brand: string | undefined, raw: string): string[] {
  let u: URL;
  try { u = new URL(raw); } catch { return []; }
  let path = u.pathname;
  try { path = decodeURIComponent(path); } catch { /* keep raw */ }
  const one = (m: RegExpMatchArray | null | undefined, prefix = "") => (m ? [prefix + m[1]] : []);
  switch (brand) {
    case "zara": {
      // `v1` is the colour variant and is what zara.ts stores; without it the
      // `-p0…` reference names every colour at once and cannot pick one.
      const v1 = u.searchParams.get("v1");
      return v1 && /^\d{4,}$/.test(v1) ? [v1] : [];
    }
    case "massimodutti":
    case "stradivarius":
    case "pullandbear":
      return one(path.match(/-l(\d{6,})(?:[/?#]|$)/i), "l");
    case "hm":
      return one(path.match(/productpage\.(\d{7,})\.html/i));
    case "guess":
      return one(path.match(/\/([A-Z0-9]{6,}-[A-Z0-9]{2,})\.html$/i)).map((s) => s.toUpperCase());
    case "mango":
      return one(path.match(/\/p\/.*?\/(\d{6,9})(?:\/|$)/));
    case "beymen":
      return one(path.match(/_(\d{4,})\/?$/));
    case "boyner":
      return one(path.match(/-p-(\d{5,})\/?$/));
    case "gratis":
      // `/p-<id>` too: the collector's own fallback url when a product has no share link.
      return one(path.match(/(?:^|[-/])p-(\d{5,})\/?$/));
    case "rossmann":
      // The url key ends in the sku (`…-p-kt26080223`); verified to equal
      // external_id on all 9,368 stored rows of that shape.
      return one(path.match(/-p-([a-z]{2,4}\d{5,})\/?$/i)).map((s) => s.toUpperCase());
    case "pandora":
      return one(path.match(/\/([A-Z0-9]{5,}(?:-[A-Z0-9]+)?)\.html$/i)).map((s) => s.toUpperCase());
    case "penti":
      return one(path.match(/\/p\/([A-Z0-9][A-Z0-9-]{5,})\/?$/i)).map((s) => s.toUpperCase());
    case "sephora":
      return one(path.match(/-(P\d{5,})\.html$/i)).map((s) => s.toUpperCase());
    case "watsons":
      return one(path.match(/\/p\/(BP_\d+)\/?$/i)).map((s) => s.toUpperCase());
    default:
      return [];
  }
}
