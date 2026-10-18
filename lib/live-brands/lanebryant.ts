/**
 * Lane Bryant (lanebryant.com, US) by url: `/<slug>/prd-<pid>.html`, optionally
 * `?dwvar_<pid>_color=<code>`. Id = the style id, as
 * packages/collector/src/brands/lanebryant.ts stores. Price from the shop's
 * Product-Variation JSON (its `sales` already includes the clearance extra-off).
 */
import type { LiveProduct } from "../live-lookup";
import { colourParam, sfccVariationLookup, type SfccShop } from "./_sfccvariation";

export const LANEBRYANT_SHOP: SfccShop = { brand: "lanebryant", web: "https://www.lanebryant.com", site: "Sites-LaneBryant-Site/default", gender: "kadin" };

export function lanebryantPidFromUrl(url: string): { pid: string; colour: string | null } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname.toLowerCase().replace(/^www\./, "") !== "lanebryant.com") return null;
  const pid = u.pathname.match(/\/prd-(\d{4,})\.html$/)?.[1];
  return pid ? { pid, colour: colourParam(u, pid) } : null;
}

export async function lanebryantUrl(url: string): Promise<LiveProduct | null> {
  const id = lanebryantPidFromUrl(url);
  if (!id) return null;
  return sfccVariationLookup(LANEBRYANT_SHOP, id.pid, id.colour, url.split("#")[0]);
}
