/**
 * Cotton On group, Australia (cottonon.com/AU — Salesforce Commerce Cloud,
 * site `cog-au`). No proxy, no key: the storefront's own category grid answers
 * `?start=N&sz=200&format=ajax` with plain HTML tiles (measured 2026-10-11 from a
 * Turkish home line; a GitHub runner got the home page 200 / 1 MB — the probe's
 * "wall" flag was the reCAPTCHA on the login form, not a challenge page).
 *
 * Scope: the group's sale categories on that one site — Cotton On (incl. Body,
 * Rubi, Men: `co/co-sale`, ~530 rows), Supré (`supre/s-sale`, ~170) and Factorie
 * (`factorie/f-sale`, ~20). Every tile carries both prices in its aria-label
 * ("Standard Price AUD 59.99, Sale Price AUD 30.00") and a GA4 JSON blob with
 * family id, brand, colour and category path.
 *
 * Sizes: tiles carry none, and the PDP is one request per product. But the grid's
 * size refinement (`prefn1=size&prefv1=10 / S`) lists exactly the products whose
 * size is orderable online — checked against 12 PDPs, including sizes the PDP
 * marks "out of stock", which the refinement correctly leaves out. So one
 * refinement query per size value gives every product's in-stock sizes. Only
 * in-stock sizes are known (a size never seen is simply absent). A category's
 * sizes are fetched only when ALL its size values fit the request budget, so a
 * product never shows a partial size list. Same for time: see TIME_BUDGET_MS.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const COTTONON_SITES: Partial<Record<CountryCode, string>> = {
  AU: "https://cottonon.com/AU",
  // 2026-10-21: same SFCC grid, SGD. Only `co/co-sale` exists there (Supré and
  // Factorie answer 410 and are skipped by the loop below).
  SG: "https://cottonon.com/SG",
};

interface SaleCategory {
  path: string;
  /** Fallback gender when the tile's brand/path doesn't say. */
  gender: ProductRecord["gender"];
}
export const COTTONON_SALE: SaleCategory[] = [
  { path: "co/co-sale", gender: null },
  { path: "supre/s-sale", gender: "kadin" },
  { path: "factorie/f-sale", gender: null },
];

const PAGE = 200;
const MAX_REQUESTS = Number(process.env.COTTONON_MAX_REQUESTS ?? 60);
const PAUSE_MS = Number(process.env.COTTONON_PAUSE_MS ?? 300);
/**
 * The grid is rendered server-side at ~40 ms per tile (a 200-tile page is 7-9 s
 * to first byte), so wall time is set by how many tiles are rendered, not by
 * bytes. Size passes start only while their estimated render fits this budget.
 */
const TIME_BUDGET_MS = Number(process.env.COTTONON_TIME_BUDGET_MS ?? 165_000);
const MS_PER_TILE = 45;
const CAP = 1500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const unescapeHtml = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

export interface CottonOnTile {
  itemId: string;
  name: string;
  url: string;
  image: string | null;
  altImage: string | null;
  label: string;
  ga4: any;
  path: string;
}

/** Split a grid response into raw tiles. Pure. */
export function parseTiles(html: string): CottonOnTile[] {
  const out: CottonOnTile[] = [];
  const chunks = html.split('<li class="grid-tile').slice(1);
  for (const c of chunks) {
    const itemId = c.match(/data-itemid="([^"]+)"/)?.[1];
    const link = c.match(/class="name-link" href="([^"]+)"[^>]*>\s*([^<]+?)\s*<\/a>/);
    const label = c.match(/class="product-pricing" aria-label="([^"]+)"/)?.[1];
    if (!itemId || !link || !label) continue;
    const img = c.match(/class="thumb-link"[\s\S]*?<img src="([^"]+)"/)?.[1] ?? null;
    const alt = c.match(/data-alternative="([^"]+)"/)?.[1] ?? null;
    const ga4Raw = c.match(/class="ga4-gtm-product-data" data-gtag="([^"]+)"/)?.[1];
    const gtmRaw = c.match(/class="gtm-product-data" data-gtag="([^"]+)"/)?.[1];
    let ga4: any = {};
    let path = "";
    try {
      ga4 = ga4Raw ? JSON.parse(unescapeHtml(ga4Raw)) : {};
    } catch {}
    try {
      path = gtmRaw ? String(JSON.parse(unescapeHtml(gtmRaw)).category ?? "") : "";
    } catch {}
    out.push({
      itemId,
      name: unescapeHtml(link[2]),
      url: unescapeHtml(link[1]).split("?")[0],
      image: img ? unescapeHtml(img) : null,
      altImage: alt ? unescapeHtml(alt) : null,
      label: unescapeHtml(label),
      ga4,
      path,
    });
  }
  return out;
}

/** "Standard Price AUD 59.99, Sale Price AUD 30.00" → both prices in major units. */
export function parsePrices(label: string): { price: number; list: number | null } | null {
  const std = label.match(/Standard Price [A-Z]{3}\s*([\d,]+(?:\.\d+)?)/);
  const sale = label.match(/Sale Price [A-Z]{3}\s*([\d,]+(?:\.\d+)?)/);
  const n = (m: RegExpMatchArray | null) => (m ? parseFloat(m[1].replace(/,/g, "")) : NaN);
  const s = n(sale);
  const l = n(std);
  if (Number.isFinite(s) && s > 0) return { price: s, list: Number.isFinite(l) && l > s ? l : null };
  if (Number.isFinite(l) && l > 0) return { price: l, list: null };
  return null;
}

/** Path segments that are sections, not product types. */
const GENERIC_SEGMENT = /^(cog .*catalog|cotton on( (men|women|kids|body))?|body|rubi|supr[eé]|factorie|sale|new arrivals|women|men|kids|clothing)$/i;

/** Larger rendition of a Demandware image URL. */
const big = (u: string | null) =>
  u ? u.replace(/([?&])sw=\d+/, "$1sw=800").replace(/([?&])sh=\d+/, "$1sh=1200") : null;

export function genderOfTile(t: CottonOnTile, fallback: ProductRecord["gender"]): ProductRecord["gender"] {
  const brand = String(t.ga4?.item_brand ?? "");
  const hay = `${brand} | ${t.path}`;
  if (/\b(kids?|baby|girls?|boys?|youth)\b/i.test(hay)) return "cocuk";
  if (/\bmen\b/i.test(hay) && !/\bwomen\b/i.test(hay)) return "erkek";
  if (/\bwomen\b/i.test(hay) || /^(body|rubi|supr[eé])$/i.test(brand)) return "kadin";
  return fallback;
}

/** Map one tile. Pure. Returns null when the tile has no usable price. */
export function mapTile(
  t: CottonOnTile,
  country: CountryCode,
  fallbackGender: ProductRecord["gender"] = null,
): ProductRecord | null {
  const p = parsePrices(t.label);
  if (!p) return null;
  const image = big(t.image);
  const segs = t.path
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && !GENERIC_SEGMENT.test(s));
  const color = typeof t.ga4?.color === "string" && t.ga4.color.trim() ? t.ga4.color.trim() : null;
  const family = t.ga4?.item_id != null ? String(t.ga4.item_id) : null;
  return {
    brand: "cottonon",
    country,
    externalId: t.itemId,
    name: t.name,
    url: t.url,
    imageUrl: image,
    images: cleanGallery([image, big(t.altImage)], image),
    price: toMinor(p.price),
    listPrice: p.list != null ? toMinor(p.list) : null,
    currency: COUNTRIES[country].currency,
    inStock: true, // the grid only lists orderable products
    category: segs.length ? segs[segs.length - 1] : null,
    gender: genderOfTile(t, fallbackGender),
    variants: null,
    groupKey: family ? `cottonon:${family}` : null,
    colorName: color,
  };
}

export interface SizeFacet {
  value: string; // raw, still URL-encoded, as the site emits it
  label: string;
  count: number;
}

/** The size refinement's values and product counts. Pure. */
export function parseSizeFacet(html: string): SizeFacet[] {
  const i = html.indexOf('id="refinement-size"');
  if (i < 0) return [];
  const seg = html.slice(i, i + 80_000);
  const out: SizeFacet[] = [];
  const seen = new Set<string>();
  const re = /prefn1=size&amp;prefv1=([^"&]+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (let m: RegExpExecArray | null; (m = re.exec(seg)); ) {
    const value = m[1];
    if (seen.has(value)) continue;
    seen.add(value);
    const text = unescapeHtml(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const cm = text.match(/(\d+)\s*$/);
    const label = decodeURIComponent(value.replace(/\+/g, " ")).trim();
    out.push({ value, label, count: cm ? Number(cm[1]) : 0 });
  }
  return out;
}

export const parseTotal = (html: string): number =>
  Number(html.match(/data-totalitemcount="(\d+)"/)?.[1] ?? 0);

export const parseItemIds = (html: string): string[] =>
  [...html.matchAll(/data-itemid="([^"]+)"/g)].map((m) => m[1]);

async function fetchGrid(url: string, country: CountryCode): Promise<string> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await getText(url, { country, headers: { Accept: "text/html" } });
    } catch (e) {
      last = e;
      await sleep(2000 * (attempt + 1));
    }
  }
  throw last;
}

const gridUrl = (site: string, path: string, start: number, extra = "") =>
  `${site}/${path}/?${extra}start=${start}&sz=${PAGE}&format=ajax`;

export async function listCottonOn(country: CountryCode): Promise<ProductRecord[]> {
  const site = COTTONON_SITES[country];
  if (!site) return [];
  const t0 = Date.now();
  let requests = 0;
  const get = async (url: string) => {
    if (requests > 0) await sleep(PAUSE_MS);
    requests++;
    return fetchGrid(url, country);
  };

  const byId = new Map<string, ProductRecord>();
  const facets: { cat: SaleCategory; sizes: SizeFacet[]; ids: string[] }[] = [];

  for (const cat of COTTONON_SALE) {
    let html: string;
    try {
      html = await get(gridUrl(site, cat.path, 0));
    } catch (e) {
      if (cat === COTTONON_SALE[0]) throw e;
      continue;
    }
    const total = parseTotal(html);
    const ids: string[] = [];
    const take = (h: string) => {
      for (const t of parseTiles(h)) {
        const r = mapTile(t, country, cat.gender);
        ids.push(t.itemId);
        if (r && r.listPrice != null && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
    };
    take(html);
    for (let start = PAGE; start < total && requests < MAX_REQUESTS; start += PAGE) {
      take(await get(gridUrl(site, cat.path, start)));
    }
    facets.push({ cat, sizes: parseSizeFacet(html), ids });
  }

  // Per-size in-stock sets, a whole category at a time while the budget allows.
  for (const { cat, sizes } of facets) {
    const live = sizes.filter((s) => s.count > 0);
    const cost = live.reduce((n, s) => n + Math.ceil(s.count / PAGE), 0);
    const eta = live.reduce((n, s) => n + s.count, 0) * MS_PER_TILE + live.length * (PAUSE_MS + 400);
    if (!live.length || requests + cost > MAX_REQUESTS || Date.now() - t0 + eta > TIME_BUDGET_MS) continue;
    const have = new Map<string, string[]>();
    for (const s of live) {
      for (let start = 0; start < s.count; start += PAGE) {
        const h = await get(gridUrl(site, cat.path, start, `prefn1=size&prefv1=${s.value}&`));
        for (const id of parseItemIds(h)) {
          const l = have.get(id) ?? [];
          if (!l.includes(s.label)) l.push(s.label);
          have.set(id, l);
        }
      }
    }
    for (const [id, labels] of have) {
      const r = byId.get(id);
      if (!r || r.variants) continue;
      const sizes: SizeVariant[] = labels.map((label) => ({ label, availability: "in_stock" }));
      r.variants = { colors: r.colorName ? [r.colorName] : [], sizes };
    }
  }

  if (process.env.COTTONON_DEBUG) console.error(`cottonon/${country}: ${requests} requests`);
  return [...byId.values()].slice(0, CAP);
}
