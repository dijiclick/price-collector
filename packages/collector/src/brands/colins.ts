import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { decodeEntities, trMoney } from "../../../../lib/live-brands/_browser";

/**
 * Colin's (colins.com.tr) runs on Inveon, server-rendered HTML with no public
 * JSON API. Each listing card carries everything in two attributes:
 * `data-ga` (GA4 item: id, colour) and `data-variants` — a JSON array of the
 * card's colours, each with id, url, images, price, oldPrice and sizes.
 * `?pagesize=200&pagenumber=N` pages it (measured 2026-10-10: 200 per page
 * honoured; plain fetch, no bot manager).
 *
 * Sale trees walked: the giyim + jean "indirimdekiler" pages for both
 * sections, then the outlet trees. Unioned by colour id, discounted rows only.
 *
 * SIZES — a caveat. `data-variants[].sizes` lists only sizes IN STOCK; a sold
 * out size is simply absent (checked against the product page of 50694, whose
 * S and M are `data-stock="nostock"` and missing from its card). So listing
 * sizes are all marked in_stock, and a rotating subset of product pages (each
 * ~1 MB) is read to record the sold-out ones too.
 */
const SITE = "https://www.colins.com.tr";
const SOURCES: { path: string; gender: ProductRecord["gender"] }[] = [
  { path: "/c/kadin-giyim-indirimdekiler-1280", gender: "kadin" },
  { path: "/c/erkek-giyim-indirimdekiler-1282", gender: "erkek" },
  { path: "/c/kadin-jean-indirimdekiler-1268", gender: "kadin" },
  { path: "/c/erkek-jean-indirimdekiler-1275", gender: "erkek" },
  { path: "/c/kadin-outlet-269", gender: "kadin" },
  { path: "/c/erkek-outlet-267", gender: "erkek" },
];
const PAGE_SIZE = 200;
const MAX_PAGES = Number(process.env.COLINS_MAX_PAGES ?? 15);
const MAX_PRODUCTS = Number(process.env.COLINS_MAX_PRODUCTS ?? 2000);
const DETAIL_LIMIT = Number(process.env.COLINS_DETAIL_LIMIT ?? 100);
const CONCURRENCY = 3;

const genderOf = (s: string, fallback: ProductRecord["gender"]): ProductRecord["gender"] => {
  const t = s.toLocaleLowerCase("tr");
  if (/çocuk|kız|bebek/.test(t)) return "cocuk";
  if (/kad[ıi]n/.test(t)) return "kadin";
  if (/erkek/.test(t)) return "erkek";
  return fallback;
};

/** Read one attribute's raw value off an opening tag (single- or double-quoted). */
function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}=(?:'([^']*)'|"([^"]*)")`));
  return m ? decodeEntities(m[1] ?? m[2] ?? "") : null;
}

/**
 * id → taxonomy, from the page's Insider listing object
 * (`"id": "51007", … "taxonomy": ['Tüm Ürünler','Kadın Giyim','Kadın Kazak']`).
 */
export function parseTaxonomy(html: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of html.matchAll(/"id":\s*"(\d+)",\s*"name":\s*"(?:[^"\\]|\\.)*",\s*"taxonomy":\s*\[([^\]]*)\]/g)) {
    out.set(m[1], [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1].trim()).filter(Boolean));
  }
  return out;
}

export interface ColinsCard {
  ga: any;
  variants: any[];
}

/** Every product card on a listing page. */
export function parseCards(html: string): ColinsCard[] {
  const cards: ColinsCard[] = [];
  for (const m of html.matchAll(/<div id="product_cart_\d+"[^>]*>/g)) {
    const tag = m[0];
    const raw = attr(tag, "data-variants");
    if (!raw) continue;
    try {
      const variants = JSON.parse(raw);
      let ga: any = {};
      try { ga = JSON.parse(attr(tag, "data-ga") ?? "{}"); } catch { /* optional */ }
      if (Array.isArray(variants) && variants.length) cards.push({ ga, variants });
    } catch { /* a malformed card is skipped, not fatal */ }
  }
  return cards;
}

export function mapVariant(
  v: any,
  card: ColinsCard,
  taxonomy: Map<string, string[]>,
  fallback: ProductRecord["gender"],
): ProductRecord | null {
  const id = v?.id;
  const price = trMoney(v?.price);
  if (!id || !v.url || !Number.isFinite(price) || price <= 0) return null;
  const old = trMoney(v.oldPrice);
  const tax = taxonomy.get(String(id)) ?? [];
  const shots: string[] = (v.imageUrls ?? []).filter((u: unknown) => typeof u === "string");
  const sizes: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const s of v.sizes ?? []) {
    const label = String(s?.name ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: "in_stock" });
  }
  const ids = card.variants.map((x) => Number(x?.id)).filter((n) => n > 0);
  const primary = Number(card.ga?.id) === Number(id);
  return {
    brand: "colins",
    country: "TR",
    externalId: String(id),
    name: String(v.name ?? "").trim(),
    url: `${SITE}${v.url}`,
    imageUrl: shots[0] ?? null,
    images: cleanGallery(shots),
    price: toMinor(price),
    listPrice: Number.isFinite(old) && old > price ? toMinor(old) : null,
    currency: "TRY",
    // A card lists only in-stock sizes; none listed means sold out.
    inStock: sizes.length > 0,
    category: tax.length ? tax[tax.length - 1] : (card.ga?.category ?? null),
    gender: genderOf([...tax, String(v.name ?? "")].join(" "), fallback),
    variants: sizes.length ? { colors: [], sizes } : null,
    // The card's own colour set — Inveon's grouping, not a name guess.
    groupKey: ids.length > 1 ? `colins:${Math.min(...ids)}` : null,
    colorName: primary && card.ga?.variant ? String(card.ga.variant) : null,
  };
}

/** Full size list, sold-out sizes included, from a product page. */
export function parsePdpSizes(html: string): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/data-stock="(\w+)"\s+data-name="([^"]*)"/g)) {
    const label = decodeEntities(m[2]).trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, availability: m[1] === "havestock" ? "in_stock" : "out_of_stock" });
  }
  return out;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

export const brand = "colins";

export async function listProducts(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  // Women's sale alone exceeds the cap, so each section gets half of it.
  const perGender = Math.ceil(MAX_PRODUCTS / 2);
  const count = new Map<ProductRecord["gender"], number>();
  const full = (g: ProductRecord["gender"]) => (count.get(g) ?? 0) >= perGender;
  const take = (html: string, gender: ProductRecord["gender"]) => {
    const tax = parseTaxonomy(html);
    for (const card of parseCards(html)) {
      for (const v of card.variants) {
        if (full(gender)) return;
        const rec = mapVariant(v, card, tax, gender);
        if (!rec || rec.listPrice == null || byId.has(rec.externalId)) continue;
        byId.set(rec.externalId, rec);
        count.set(gender, (count.get(gender) ?? 0) + 1);
      }
    }
  };
  for (const src of SOURCES) {
    if (full(src.gender)) continue;
    const url = (n: number) => `${SITE}${src.path}?pagesize=${PAGE_SIZE}&pagenumber=${n}`;
    const first = await getText(url(1)).catch(() => "");
    if (!first) continue;
    take(first, src.gender);
    const last = Math.min(MAX_PAGES, Number(first.match(/id="totalpagesNumber">\s*(\d+)/)?.[1] ?? 1));
    // A batch at a time, so a section that fills up stops costing requests.
    for (let n = 2; n <= last && !full(src.gender); n += CONCURRENCY) {
      const batch = Array.from({ length: Math.min(CONCURRENCY, last - n + 1) }, (_, k) => n + k);
      const pages = await Promise.all(batch.map((k) => getText(url(k)).catch(() => "")));
      for (const html of pages) take(html, src.gender);
    }
  }
  const records = [...byId.values()];

  const pick = [...records];
  for (let j = pick.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [pick[j], pick[k]] = [pick[k], pick[j]];
  }
  await pool(pick.slice(0, DETAIL_LIMIT), CONCURRENCY, async (r) => {
    const html = await getText(r.url).catch(() => "");
    const sizes = html ? parsePdpSizes(html) : [];
    if (!sizes.length) return;
    r.variants = { colors: [], sizes };
    r.inStock = sizes.some((s) => s.availability !== "out_of_stock");
  });
  return records;
}
