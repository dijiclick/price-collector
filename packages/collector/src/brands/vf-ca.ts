/**
 * VF brands in Canada — Vans (vans.com/en-ca), The North Face
 * (thenorthface.com/en-ca) and Timberland (timberland.com/en-ca), 2026-11-10.
 *
 * All three are VF's "Canvas" Nuxt storefront, the one vans-us.ts reads for the
 * US: Akamai in front, the pages served from Netlify's edge to an Apple
 * networking-stack User-Agent (`CFNetwork/… Darwin/…`). A GitHub runner gets
 * 200 on every en-ca sale section (probes 42799158188, 42799588340,
 * 42800083035); the Mac is geo-refused (403), so this adapter is for the
 * runners.
 *
 * A section's first page is read from Nuxt's own payload file
 * (`<section>/_payload.json`, ~160-330 KB — the page itself is ~800 KB): the
 * same devalue-flattened array as the page's `__NUXT_DATA__`, holding the
 * category listing (48 products, `total`, `currency: "CAD"`). The payload file
 * ignores `?page=` (it is keyed by path), so later pages are read from the
 * HTML page (`?page=N`), exactly as vans-us.ts does.
 *
 * One product is one colour of a style. Prices are CAD: `price.lowCurrent` /
 * `price.lowOriginal`; a product whose current or original price is a RANGE
 * (sizes priced differently) has no single was/now pair and is skipped. The
 * listing carries no per-size stock.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { VANS_HEADERS, listingOf, unflattenNuxt } from "./vans-us";

export type VfBrand = "vans" | "thenorthface" | "timberland";

interface VfSite {
  site: string;
  /** Sale sections, women first; a product listed in two is kept once (unisex). */
  sections: [path: string, gender: ProductRecord["gender"]][];
}

export const VF_CA: Record<VfBrand, VfSite> = {
  vans: {
    site: "https://www.vans.com",
    sections: [
      ["/en-ca/c/sale/womens-sale-5413", "kadin"],
      ["/en-ca/c/sale/mens-sale-5412", "erkek"],
      ["/en-ca/c/sale/kids-sale-5414", "cocuk"],
    ],
  },
  thenorthface: {
    site: "https://www.thenorthface.com",
    sections: [
      ["/en-ca/c/sale/womens-sale-317775", "kadin"],
      ["/en-ca/c/sale/mens-sale-317774", "erkek"],
      ["/en-ca/c/sale/kids-sale-317776", "cocuk"],
      // Bags, hats and gear that sit in no gender section.
      ["/en-ca/c/sale-829803", null],
    ],
  },
  timberland: {
    site: "https://www.timberland.com",
    sections: [
      ["/en-ca/c/sale/womens-sale-10190", "kadin"],
      ["/en-ca/c/sale/mens-sale-10185", "erkek"],
      ["/en-ca/c/sale/kids-sale-10195", "cocuk"],
    ],
  },
};

const PAGE = 48;
const CAP = 1500;
const MAX_REQ = 22;
const PAUSE_MS = Number(process.env.VF_PAUSE_MS ?? 1200);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Listing = { total: number; products: any[]; currency: string | null };

/** The category listing inside a `_payload.json` body (the bare devalue array), or null. */
export function listingOfPayload(raw: string): Listing | null {
  let arr: unknown;
  try { arr = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  const data = unflattenNuxt(arr)?.data ?? {};
  for (const [k, v] of Object.entries<any>(data)) {
    if (/^\d+-\d+$/.test(k) && Array.isArray(v?.products)) {
      return { total: Number(v.total) || 0, products: v.products, currency: v.currency ?? null };
    }
  }
  return null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const bigger = (u: string) => u.replace("/images/t_Thumbnail/", "/images/f_auto,q_auto,w_900/");

/** Map one listing product (one colour). Pure; null unless a single-priced reduction. */
export function mapVfCa(b: VfBrand, p: any, gender: ProductRecord["gender"]): ProductRecord | null {
  const id = String(p?.id ?? "").trim();
  const name = String(p?.name ?? "").trim();
  const path = String(p?.url ?? "");
  if (!id || !name || !path.startsWith("/en-ca/")) return null;
  if (p?.currency && p.currency !== "CAD") return null;
  const pr = p?.price ?? {};
  const cur = num(pr.lowCurrent), curHi = num(pr.highCurrent);
  const was = num(pr.lowOriginal), wasHi = num(pr.highOriginal);
  if (cur == null || was == null) return null;
  if ((curHi != null && curHi !== cur) || (wasHi != null && wasHi !== was)) return null;
  if (cur >= was) return null;
  const shots: string[] = (Array.isArray(p?.gallery) ? p.gallery : [])
    .filter((g: any) => g?.type === "image" && typeof g?.src === "string")
    .map((g: any) => bigger(g.src));
  const crumbs: any[] = Array.isArray(p?.breadcrumbs) ? p.breadcrumbs : [];
  // The colour option whose id is this product (The North Face lists them); else none.
  const colourOpt = (Array.isArray(p?.attributes) ? p.attributes : [])
    .filter((a: any) => a?.type === "color")
    .flatMap((a: any) => (Array.isArray(a?.options) ? a.options : []))
    .find((o: any) => o?.id === id);
  const colour = typeof colourOpt?.label === "string" && colourOpt.label.trim() ? colourOpt.label.trim() : null;
  const style = String(p?.styleId ?? "").trim() || /-([A-Z0-9]{6,})(?:\?|$)/.exec(path)?.[1] || "";
  return {
    brand: b,
    country: "CA",
    externalId: id,
    name,
    url: `${VF_CA[b].site}${path}`,
    imageUrl: shots[0] ?? null,
    images: cleanGallery(shots, shots[0]),
    price: toMinor(cur),
    listPrice: toMinor(was),
    currency: "CAD",
    inStock: colourOpt ? colourOpt.available !== false : true,
    category: String(p?.primaryCategoryName ?? crumbs[crumbs.length - 1]?.label ?? "").trim() || null,
    gender,
    variants: colour ? { colors: [colour], sizes: [] } : null,
    groupKey: style && style !== id ? `${b}:${style}` : null,
    colorName: colour,
  };
}

export async function listVfCa(b: VfBrand, country: CountryCode): Promise<ProductRecord[]> {
  const cfg = VF_CA[b];
  if (country !== "CA" || !cfg) return [];
  const byId = new Map<string, ProductRecord>();
  let req = 0, listings = 0;
  for (const [path, gender] of cfg.sections) {
    for (let page = 1; req < MAX_REQ && byId.size < CAP; page++) {
      if (req++) await sleep(PAUSE_MS);
      const url = page === 1 ? `${cfg.site}${path}/_payload.json` : `${cfg.site}${path}?page=${page}`;
      const body = await getText(url, { country, headers: VANS_HEADERS, timeoutMs: 45_000 }).catch((e) => {
        console.warn(`${b}/CA: ${path} page ${page} failed: ${String(e).slice(0, 100)}`);
        return null;
      });
      const l = body == null ? null : page === 1 ? listingOfPayload(body) : listingOf(body);
      // A block page or a missing section: keep what the other sections gave.
      if (!l) break;
      if (l.currency && l.currency !== "CAD") throw new Error(`${b}/CA: listing priced in ${l.currency}`);
      listings++;
      for (const p of l.products) {
        const r = mapVfCa(b, p, gender);
        if (!r) continue;
        const prev = byId.get(r.externalId);
        if (!prev) byId.set(r.externalId, r);
        // The catch-all section (gender null) must not blank a row a gender section already placed.
        else if (gender !== null && prev.gender !== gender && prev.gender !== "cocuk" && prev.gender !== null) prev.gender = null;
      }
      if (!l.products.length || page * PAGE >= l.total) break;
    }
  }
  // Never let a wall on every section look like "no sale on".
  if (listings === 0) throw new Error(`${b}/CA: no sale listing could be read (blocked?)`);
  return [...byId.values()].slice(0, CAP);
}
