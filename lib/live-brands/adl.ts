/**
 * ADL by url (`adl.com.tr/<category>/<slug>-p-<CODE>`), SAP Commerce OCC v2
 * site `adl` — the Vakko resolver (_sapocc.ts) with one difference: ADL's
 * strike price is `originalPrice`, not `firstStrikePrice`, so the body is
 * shimmed before the shared mapper reads it. The code is the collector's
 * external_id (packages/collector/src/brands/adl.ts).
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, json } from "../live-http";
import { mapOccDetail, occCodeFromUrl, type OccShop } from "./_sapocc";

export const ADL: OccShop = {
  brand: "adl",
  api: "https://api.adl.com.tr/occ/v2/adl",
  web: "https://www.adl.com.tr",
  host: "adl.com.tr",
};

/** Map a `products/<CODE>?fields=FULL` body. Pure. */
export function mapAdlDetail(d: any): LiveProduct | null {
  if (!d) return null;
  const r = mapOccDetail(ADL, { ...d, firstStrikePrice: d.firstStrikePrice ?? d.originalPrice });
  // ADL is a women's label; its categories never name a section.
  return r ? { ...r, gender: r.gender ?? "kadin" } : null;
}

export async function adlUrl(url: string): Promise<LiveProduct | null> {
  const code = occCodeFromUrl(url, ADL.host);
  if (!code) return null;
  const d = await json<any>(
    `${ADL.api}/products/${encodeURIComponent(code)}?fields=FULL&lang=tr&curr=TRY`,
    { Accept: "application/json", "User-Agent": UA },
    countryFor("adl"),
  );
  return mapAdlDetail(d);
}
