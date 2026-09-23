import type { CountryCode } from "./countries";

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

/** Path segment or locale fragment → our country code. Only markets we serve. */
const SEGMENT_COUNTRY: Record<string, CountryCode> = {
  tr: "TR",
  ae: "AE",
  sa: "SA",
  gb: "GB",
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
