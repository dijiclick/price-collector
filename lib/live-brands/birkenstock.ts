/**
 * Birkenstock US (birkenstock.com/us) by url: `/us/<slug>/<pid>.html`, where
 * the pid already names the colour (`…-u_27`) — the id the collector stores
 * (packages/collector/src/brands/birkenstock.ts). Price from the shop's own
 * Product-Variation JSON. Other markets' urls (`/gb/…`, `/de/…`) are not ours.
 */
import type { LiveProduct } from "../live-lookup";
import { sfccVariationLookup, type SfccShop } from "./_sfccvariation";

export const BIRKENSTOCK_SHOP: SfccShop = { brand: "birkenstock", web: "https://www.birkenstock.com", site: "Sites-US-Site/en_US" };

export function birkenstockPidFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname.toLowerCase().replace(/^www\./, "") !== "birkenstock.com") return null;
  return u.pathname.match(/^\/us\/(?:[^/]+\/)*([A-Za-z0-9-]+_[A-Za-z0-9]+)\.html$/)?.[1] ?? null;
}

export async function birkenstockUrl(url: string): Promise<LiveProduct | null> {
  const pid = birkenstockPidFromUrl(url);
  if (!pid) return null;
  return sfccVariationLookup(BIRKENSTOCK_SHOP, pid, null, url.split("#")[0]);
}
