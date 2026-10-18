/**
 * Ann Taylor (anntaylor.com, US) by url: `/…/<pid>.html` or, for a grouped
 * style, `/…/grp_<pid>_<colour>.html`, optionally `?dwvar_<pid>_color=<code>`.
 * The id is the style id, as the collector stores it
 * (packages/collector/src/brands/anninc.ts). Price: the shop's own
 * Product-Variation JSON, "price as marked" included (see _sfccvariation.ts).
 */
import type { LiveProduct } from "../live-lookup";
import { colourParam, sfccVariationLookup, type SfccShop } from "./_sfccvariation";

export const ANNTAYLOR_SHOP: SfccShop = { brand: "anntaylor", web: "https://www.anntaylor.com", site: "Sites-AnnTaylor-Site/default", gender: "kadin" };

/** Ann Inc. product urls → style id + colour, for the given host. */
export function annIncPidFromUrl(url: string, host: string): { pid: string; colour: string | null } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname.toLowerCase().replace(/^www\./, "") !== host) return null;
  const m = u.pathname.match(/\/(?:grp_)?(\d{5,})(?:_([A-Za-z0-9]+))?\.html$/);
  if (!m) return null;
  return { pid: m[1], colour: colourParam(u, m[1]) ?? m[2] ?? null };
}

export async function anntaylorUrl(url: string): Promise<LiveProduct | null> {
  const id = annIncPidFromUrl(url, "anntaylor.com");
  if (!id) return null;
  return sfccVariationLookup(ANNTAYLOR_SHOP, id.pid, id.colour, url.split("#")[0], id.pid, !/\/grp_/.test(url));
}
