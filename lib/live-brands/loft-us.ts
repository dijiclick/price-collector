/**
 * LOFT US (loft.com) by url — same platform and url shape as Ann Taylor
 * (`/…/<pid>.html`, `/…/grp_<pid>_<colour>.html`). The slug `loft` already
 * belongs to LOFT Turkey (loft.com.tr, ./loft.ts); this resolver answers only
 * loft.com urls, so the two combine as `loft: (u) => loftUrl(u) ?? loftUsUrl(u)`
 * by host. Id = the style id, as packages/collector/src/brands/anninc.ts stores.
 */
import type { LiveProduct } from "../live-lookup";
import { sfccVariationLookup, type SfccShop } from "./_sfccvariation";
import { annIncPidFromUrl } from "./anntaylor";

export const LOFT_US_SHOP: SfccShop = { brand: "loft", web: "https://www.loft.com", site: "Sites-Loft-Site/default", gender: "kadin" };

export const isLoftUsUrl = (url: string) => annIncPidFromUrl(url, "loft.com") !== null;

export async function loftUsUrl(url: string): Promise<LiveProduct | null> {
  const id = annIncPidFromUrl(url, "loft.com");
  if (!id) return null;
  return sfccVariationLookup(LOFT_US_SHOP, id.pid, id.colour, url.split("#")[0], id.pid, !/\/grp_/.test(url));
}
