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
