/**
 * Sporting Life (sportinglife.ca) — Canada only, sporting goods and outdoor
 * fashion (Canada Goose, Moose Knuckles, Arc'teryx, The North Face, UGG, ...).
 *
 * Salesforce Commerce Cloud (SiteGenesis, `Sites-SportingLife-Site`) behind
 * Cloudflare. Cloudflare refuses Turkish and German IPs, but the sale grid
 * answers a GitHub runner with no proxy (probe runs 39134357131 and
 * 39135071313, 2026-10-18). `format=page-element` is SiteGenesis' own
 * "load more" response: only the `<ul id="search-result-items">` grid, no
 * page chrome. The grid is the data — there is no JSON listing on this stack.
 *
 * One tile = one style; `data-colors-to-show` lists the colours on sale and the
 * tile prints `price-standard` (regular) and `price-sales` (now). Tiles priced
 * as a range are skipped. `data-itemid` (`<style>-<vendor style>`) is the id
 * and the name link's path the canonical url. The grid lists only orderable
 * styles, so every row is in stock; sizes are not on the tile.
 *
 * Women's sale (clothing + footwear, newest markdowns first) then men's, 96
 * tiles a page; equipment and kids are left out.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "sportinglife";

const SITE = "https://www.sportinglife.ca";
const PAGE = 96;
const CAP = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Walk {
  label: string;
  gender: "kadin" | "erkek";
  refine: string;
  /** Most tiles taken from this walk (women first, the audience). */
  max: number;
}
export const WALKS: Walk[] = [
  { label: "women", gender: "kadin", refine: "Women's", max: 1100 },
  { label: "men", gender: "erkek", refine: "Men's", max: 500 },
];

export function gridUrl(w: Walk, start: number): string {
  const p = new URLSearchParams({
    prefn1: "gender",
    prefv1: w.refine,
    prefn2: "division",
    prefv2: "Clothing|Footwear",
    sz: String(PAGE),
    start: String(start),
    format: "page-element",
  });
  return `${SITE}/en-CA/sale/?${p}`;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&eacute;/g, "é")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

/** "$1,299.98" → 129998. A range ("$80.98 - $99.98") or anything else → null. */
export function dollars(s: string | undefined | null): number | null {
  const t = decode(String(s ?? ""));
  const m = t.match(/^\$\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?$/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, "")) * 100 + Number(m[2] ?? 0);
  return n > 0 ? n : null;
}

const text = (html: string, cls: string): string | null => {
  const m = html.match(new RegExp(`<span[^>]*class="${cls}[^"]*"[^>]*>([\\s\\S]*?)</span>`));
  return m ? decode(m[1].replace(/<[^>]+>/g, " ")) : null;
};

/** Map one `<li class="grid-tile">`. Pure; null unless a single, genuinely reduced price. */
export function mapTile(tile: string, gender: Walk["gender"]): ProductRecord | null {
  const id = tile.match(/data-itemid="([^"]+)"/)?.[1]?.trim();
  const path = tile.match(/<a[^>]*class="name-link"[^>]*href="([^"]+)"/)?.[1] ?? tile.match(/<a[^>]*href="([^"]+)"[^>]*class="name-link"/)?.[1];
  const title = text(tile, "product-name");
  if (!id || !path || !title) return null;
  const regular = dollars(text(tile, "price-standard"));
  const price = dollars(text(tile, "price-sales"));
  if (regular == null || price == null || !(price < regular)) return null;
  if (/\b(kids?|boys?|girls?|juniors?|youth|toddler|infant)'?s?\b/i.test(title)) return null;

  const make = text(tile, "product-brand") ?? "";
  const name = make && !title.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${title}` : title;
  // Swatch links carry the colour code in the url and its display name in the title.
  const names = new Map<string, string>();
  for (const m of tile.matchAll(/<a[^>]*href="[^"]*_color=([^"&]+)[^"]*"[^>]*class="swatch color-swatch[^"]*"[^>]*title="([^"]+)"/g)) {
    names.set(decode(m[1]).toUpperCase(), decode(m[2]));
  }
  const colours = decode(tile.match(/data-colors-to-show="([^"]*)"/)?.[1] ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => names.get(c.toUpperCase()) ?? c.toLowerCase().replace(/(^|-)([a-z])/g, (_, a, b) => a + b.toUpperCase()).replace(/-/g, " "));
  const wrap = tile.slice(tile.indexOf("product-image-wrapper"));
  const front = wrap.match(/<img[^>]*\ssrc="(https:[^"]+)"/)?.[1];
  const back = wrap.match(/<img[^>]*\sdata-src="(https:[^"]+)"/)?.[1];
  const img = front ? decode(front) : null;
  const url = new URL(decode(path), SITE).toString().split("?")[0];
  const crumbs = url.replace(`${SITE}/en-CA/`, "").split("/");
  // …/women/clothing/coats-jackets/puffers/<slug>/<id>.html → "puffers"
  const category = crumbs.length > 3 ? crumbs[crumbs.length - 3].replace(/-/g, " ") : null;

  return {
    brand,
    country: "CA",
    externalId: id,
    name,
    url,
    imageUrl: img,
    images: cleanGallery([back ? decode(back) : null], img),
    price,
    listPrice: regular,
    currency: "CAD",
    inStock: true,
    category,
    gender,
    variants: colours.length ? { colors: colours, sizes: [] } : null,
    groupKey: null,
    colorName: colours.length === 1 ? colours[0] : null,
  };
}

/** Split a page-element grid into tiles. */
export function tilesOf(html: string): string[] {
  return html.split(/<li\s+class="grid-tile/).slice(1);
}

export async function listSportingLife(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "CA") return [];
  const byId = new Map<string, ProductRecord>();
  let tiles = 0;
  const problems: string[] = [];
  for (const w of WALKS) {
    let taken = 0;
    for (let start = 0; taken < w.max && byId.size < CAP; start += PAGE) {
      if (tiles > 0) await sleep(700);
      const html = await getText(gridUrl(w, start), { country, timeoutMs: 45_000, headers: { Accept: "text/html" } }).catch((e) => {
        problems.push(`${w.label}@${start}: ${String(e).slice(0, 120)}`);
        return "";
      });
      const page = tilesOf(html);
      tiles += page.length;
      for (const t of page) {
        const r = mapTile(t, w.gender);
        if (r && !byId.has(r.externalId)) {
          byId.set(r.externalId, r);
          taken++;
        }
      }
      if (page.length < PAGE) break;
    }
  }
  if (tiles === 0) throw new Error(`sportinglife: every sale page returned no tiles (${problems.slice(0, 3).join("; ")})`);
  return [...byId.values()].slice(0, CAP);
}

export const listProducts = listSportingLife;
