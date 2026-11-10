/**
 * The North Face and Timberland, United States — the same VF "Canvas" Nuxt
 * storefront as vans.com (see vans-us.ts, whose page reader this reuses).
 *
 * thenorthface.com and timberland.com answer a browser User-Agent from a
 * GitHub runner with Akamai's 403, and their catalog API sits behind
 * PerimeterX. The category PAGES are served from Netlify's edge and answer an
 * Apple networking-stack User-Agent (`CFNetwork/… Darwin/…`) with the full
 * HTML, whose `__NUXT_DATA__` payload carries the category's product list —
 * 48 products a page, `?page=N` for more. Runner-verified 2026-11-10 (probe
 * 42799467274: women's / men's / kids' sale pages and `?page=2`, 200 with the
 * full ~0.8–1.1 MB document; the same request with a browser UA: 403).
 *
 * Walked per sale section so each row carries its section's gender; a product
 * listed in two sections is kept once, unisex. One listing row is one colour of
 * one style. Prices (USD): `price.lowCurrent` / `price.lowOriginal`; a product
 * whose current or original price is a RANGE has no single was/now pair and is
 * skipped. The listing carries no sizes or stock; the sale shelves list what
 * can be bought, so rows are stored in stock.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { listingOf, VANS_HEADERS } from "./vans-us";

export type VfUsBrand = "thenorthface" | "timberland";
type Gender = ProductRecord["gender"];

interface VfSite {
  site: string;
  /** How the brand is written in the gallery's alt text ("… TNF Metal Pink HERO"). */
  altMark: string;
  sections: [path: string, gender: Gender][];
}

export const VF_US: Record<VfUsBrand, VfSite> = {
  thenorthface: {
    site: "https://www.thenorthface.com",
    altMark: "TNF",
    sections: [
      ["/en-us/c/sale/womens-sale-317775", "kadin"],
      ["/en-us/c/sale/mens-sale-317774", "erkek"],
      ["/en-us/c/sale/kids-sale-317776", "cocuk"],
    ],
  },
  timberland: {
    site: "https://www.timberland.com",
    altMark: "TBL",
    sections: [
      ["/en-us/c/sale/women-10190", "kadin"],
      ["/en-us/c/sale/men-10185", "erkek"],
      ["/en-us/c/sale/kids-10195", "cocuk"],
    ],
  },
};

const PAGE = 48;
const CAP = 1500;
const MAX_REQ = 24;
const PAUSE_MS = Number(process.env.VF_US_PAUSE_MS ?? 1200);

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const bigger = (u: string) => u.replace("/images/t_Thumbnail/", "/images/f_auto,q_auto,w_900/");

/** One listing product (one colour) → a record, or null unless it shows a single was/now pair. Pure. */
export function mapVfProduct(brand: VfUsBrand, p: any, gender: Gender): ProductRecord | null {
  const cfg = VF_US[brand];
  const id = String(p?.id ?? "").trim();
  const name = String(p?.name ?? "").replace(/\s+/g, " ").trim();
  if (!id || !name) return null;
  if (p?.currency && p.currency !== "USD") return null;
  const pr = p?.price ?? {};
  const cur = num(pr.lowCurrent), curHi = num(pr.highCurrent);
  const was = num(pr.lowOriginal), wasHi = num(pr.highOriginal);
  if (cur == null || was == null) return null;
  if ((curHi != null && curHi !== cur) || (wasHi != null && wasHi !== was)) return null;
  if (cur >= was) return null;
  const gallery: any[] = Array.isArray(p?.gallery) ? p.gallery : [];
  const shots: string[] = gallery.filter((g) => g?.type === "image" && typeof g?.src === "string").map((g) => bigger(g.src));
  const path = String(p?.url ?? "");
  if (!path) return null;
  const crumbs: any[] = Array.isArray(p?.breadcrumbs) ? p.breadcrumbs : [];
  // The hero's alt text names the colour: "<name> TNF <colour> HERO" / "… TBL <colour> HERO".
  const alt = String(gallery[0]?.alt ?? "");
  const colour = (alt.split(` ${cfg.altMark} `)[1] ?? "")
    .replace(/\s+(HERO\d*|ALT\d+|BACK|FRONT|Main)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  // Timberland has no styleId: its id is the style plus a 3-character colour code.
  const style = p?.styleId ? String(p.styleId) : brand === "timberland" && id.length > 8 ? id.slice(0, -3) : null;
  return {
    brand,
    country: "US",
    externalId: id,
    name,
    url: path.startsWith("http") ? path : `${cfg.site}${path}`,
    imageUrl: shots[0] ?? null,
    images: cleanGallery(shots, shots[0]),
    price: toMinor(cur),
    listPrice: toMinor(was),
    currency: "USD",
    inStock: true,
    category: String(p?.primaryCategoryName ?? crumbs[crumbs.length - 1]?.label ?? "").trim() || null,
    gender,
    variants: null,
    groupKey: style ? `${brand}:${style}` : null,
    colorName: colour && !/^no color$/i.test(colour) ? colour : null,
  };
}

export async function listVfUs(brand: VfUsBrand, country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const cfg = VF_US[brand];
  const byId = new Map<string, ProductRecord>();
  let req = 0;
  for (const [path, gender] of cfg.sections) {
    for (let page = 1; req < MAX_REQ && byId.size < CAP; page++) {
      if (req++) await new Promise((r) => setTimeout(r, PAUSE_MS));
      const html = await getText(`${cfg.site}${path}${page > 1 ? `?page=${page}` : ""}`, { country, headers: VANS_HEADERS, timeoutMs: 45_000 });
      const l = listingOf(html);
      if (!l) {
        // A wall page instead of the store: keep what earlier pages gave, but
        // never let a first-page refusal look like "no sale".
        if (!byId.size) throw new Error(`${brand}/US: no listing in ${path} page ${page} (blocked?)`);
        break;
      }
      if (l.currency && l.currency !== "USD") throw new Error(`${brand}/US: listing priced in ${l.currency}`);
      for (const p of l.products) {
        const r = mapVfProduct(brand, p, gender);
        if (!r) continue;
        const prev = byId.get(r.externalId);
        if (!prev) byId.set(r.externalId, r);
        else if (prev.gender !== gender && prev.gender !== "cocuk") prev.gender = null;
      }
      if (!l.products.length || page * PAGE >= l.total) break;
    }
  }
  return [...byId.values()].slice(0, CAP);
}
