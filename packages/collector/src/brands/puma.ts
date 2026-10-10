import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson, getText } from "../http";
import { toMinor } from "../normalize";

/**
 * Puma Turkey (tr.puma.com) is a Magento 2 shop run by the local distributor —
 * NOT Salesforce Commerce Cloud like puma.com elsewhere. Its GraphQL schema is
 * switched off (every query: "Cannot query field") and the Klevu search config
 * still in the page answers "webstore-not-found", so the routes that work are
 * the ones the page itself uses (measured 2026-10-10):
 *
 * - LISTING: `outlet.html?p=N&ajax=1` with `X-Requested-With` answers JSON —
 *   `content` (the product grid HTML, 36 cards a page) plus
 *   `ga4_view_item_list` (a JSON string with gender / division / colour per
 *   card). ~1,600 outlet products, ~45 pages.
 * - SIZES: a product page's `spConfig` (Magento's configurable-swatch JSON).
 *   One page covers EVERY colour of the style, with per-colour, per-size
 *   salable children — so the detail pass fetches one page per style, not
 *   per colour, for a rotating subset each run (the upsert keeps variants a
 *   previous run found, so coverage accumulates — same scheme as Koton).
 */
const SITE = "https://tr.puma.com";
const LIST = `${SITE}/outlet.html`;
const MAX_PAGES = Number(process.env.PUMA_MAX_PAGES ?? 56); // 2,016 products
const DETAIL_LIMIT = Number(process.env.PUMA_DETAIL_LIMIT ?? 400);
const AJAX = { "X-Requested-With": "XMLHttpRequest" };

export interface PumaCard {
  sku: string; // "402916_01" — style + colour code
  name: string;
  url: string;
  price: number; // major units
  oldPrice: number | null;
  images: string[];
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/** Every product card in a grid HTML fragment. */
export function parseCards(html: string): PumaCard[] {
  const out: PumaCard[] = [];
  const chunks = html.split("data-product-card").slice(1);
  for (const c of chunks) {
    const sku = c.match(/^\s*data-product-sku="([^"]+)"/)?.[1];
    const nameM = c.match(/class="product-item__name"\s+href="([^"]+)"[^>]*>([^<]+)</);
    const price = Number(c.match(/data-price-amount="([\d.]+)"\s+data-price-type="finalPrice"/)?.[1]);
    if (!sku || !nameM || !Number.isFinite(price) || price <= 0) continue;
    const old = Number(c.match(/data-price-amount="([\d.]+)"\s+data-price-type="oldPrice"/)?.[1]);
    const images = [
      ...new Set(
        [...c.matchAll(/class="product-item__img[^"]*"[^>]*?data-src="(https:\/\/images\.puma\.[^"]+)"/g)].map((m) => m[1]),
      ),
    ];
    out.push({
      sku,
      name: decode(nameM[2]),
      url: nameM[1],
      price,
      oldPrice: Number.isFinite(old) && old > price ? old : null,
      images,
    });
  }
  return out;
}

/** The ga4 item list the ajax listing returns beside the HTML, keyed by sku. */
export function parseGa4(raw: unknown): Map<string, any> {
  const map = new Map<string, any>();
  try {
    const items = (typeof raw === "string" ? JSON.parse(raw) : raw)?.ecommerce?.items ?? [];
    for (const it of items) if (it?.item_id) map.set(String(it.item_id), it);
  } catch {
    /* tracking blob missing or malformed: gender/category just stay null */
  }
  return map;
}

function genderOf(name: string, ga4: any): ProductRecord["gender"] {
  if (/[çc]ocuk|bebek|gen[çc]|\bkids?\b|\bjr\b/i.test(name)) return "cocuk";
  const g = String(ga4?.gender ?? "");
  if (/^kad[ıi]n/i.test(g) || /kad[ıi]n/i.test(name)) return "kadin";
  if (/^erkek/i.test(g) || /erkek/i.test(name)) return "erkek";
  return null;
}

const DIVISION: Record<string, string> = { "ayakkabı": "Ayakkabı", giyim: "Giyim", aksesuar: "Aksesuar" };

export function mapCard(card: PumaCard, ga4?: any): ProductRecord {
  const division = String(ga4?.division ?? "").toLocaleLowerCase("tr");
  return {
    brand: "puma",
    externalId: card.sku,
    name: card.name,
    url: card.url,
    imageUrl: card.images[0] ?? null,
    images: cleanGallery(card.images, card.images[0] ?? null),
    price: toMinor(card.price),
    listPrice: card.oldPrice != null ? toMinor(card.oldPrice) : null,
    currency: "TRY",
    inStock: ga4?.availability !== false,
    category: DIVISION[division] ?? null,
    gender: genderOf(card.name, ga4),
    variants: null,
    groupKey: `puma:${card.sku.split("_")[0]}`,
    colorName: typeof ga4?.color === "string" && ga4.color !== "undefined" ? ga4.color : null,
  };
}

/** The JSON object literal that starts at `from` (balanced braces, strings respected). */
export function objectAt(text: string, from: number): any | null {
  const start = text.indexOf("{", from);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Magento's configurable-product config out of a product page. */
export function spConfigOf(html: string): any | null {
  const at = html.indexOf('"spConfig"');
  return at < 0 ? null : objectAt(html, at + 10);
}

export interface ColourDetail {
  sizes: SizeVariant[];
  barcodes: string[];
  price: number | null; // major, this colour's own final price
  oldPrice: number | null;
}

/**
 * Per-colour sizes from a style's spConfig, keyed by colour code ("01", "02").
 *
 * A colour option lists its children (`all_products`) and which of them are
 * salable (`products`); a size option lists its children too, so the child at
 * the intersection is that colour in that size. The colour code itself is not
 * in the option — it is read off a child's image path (`/402916/02/`), which is
 * how the shop names the colour in every sku and url.
 */
export function coloursOf(cfg: any, style: string): Map<string, ColourDetail> {
  const out = new Map<string, ColourDetail>();
  const attrs: any[] = Object.values(cfg?.attributes ?? {});
  const colour = attrs.find((a) => a?.code === "color");
  const size = attrs.find((a) => a?.code === "size");
  if (!colour) return out;
  const codeRe = new RegExp(`/${style}/(\\d{2})/`);
  for (const opt of colour.options ?? []) {
    const all: string[] = (opt.all_products ?? [...(opt.products ?? []), ...(opt.out_of_stock ?? [])]).map(String);
    const salable = new Set<string>((opt.products ?? []).map(String));
    let code: string | null = null;
    for (const child of all) {
      const imgs: any[] = cfg?.images?.[child] ?? [];
      for (const im of imgs) {
        code = String(im?.img ?? im?.full ?? im?.thumb ?? "").match(codeRe)?.[1] ?? null;
        if (code) break;
      }
      if (code) break;
    }
    if (!code) continue;
    const childSet = new Set(all);
    const sizes: SizeVariant[] = [];
    const barcodes: string[] = [];
    for (const s of size?.options ?? []) {
      const child = (s.all_products ?? s.products ?? []).map(String).find((c: string) => childSet.has(c));
      if (!child) continue;
      const label = String(s.label ?? "").trim();
      if (!label) continue;
      const qty = Number(cfg?.quantities?.[child]?.real_qty);
      sizes.push({
        label,
        availability: !salable.has(child) ? "out_of_stock" : qty > 0 && qty <= 2 ? "low_on_stock" : "in_stock",
      });
      const ean = cfg?.skus?.[child];
      if (typeof ean === "string" && /^\d{8,14}$/.test(ean)) barcodes.push(ean);
    }
    const any = all.find((c) => cfg?.optionPrices?.[c]);
    const p = any ? cfg.optionPrices[any] : null;
    const fin = Number(p?.finalPrice?.amount);
    const old = Number(p?.oldPrice?.amount);
    out.set(code, {
      sizes,
      barcodes,
      price: Number.isFinite(fin) && fin > 0 ? fin : null,
      oldPrice: Number.isFinite(old) && Number.isFinite(fin) && old > fin ? old : null,
    });
  }
  return out;
}

/** Run `fn` over `items` with bounded concurrency. */
async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

export const brand = "puma";

export async function listProducts(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await getJson<any>(`${LIST}?p=${page}&ajax=1`, { headers: AJAX, proxy: true }).catch(() => null);
    const cards = parseCards(String(data?.content ?? ""));
    if (cards.length === 0) break;
    const ga4 = parseGa4(data?.ga4_view_item_list);
    for (const c of cards) if (!byId.has(c.sku)) byId.set(c.sku, mapCard(c, ga4.get(c.sku)));
  }

  // Detail pass: one product page per STYLE fills every listed colour of it.
  const byStyle = new Map<string, ProductRecord[]>();
  for (const r of byId.values()) {
    const style = r.externalId.split("_")[0];
    byStyle.set(style, [...(byStyle.get(style) ?? []), r]);
  }
  const styles = [...byStyle.keys()];
  for (let j = styles.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [styles[j], styles[k]] = [styles[k], styles[j]];
  }
  await pool(styles.slice(0, DETAIL_LIMIT), 3, async (style) => {
    const recs = byStyle.get(style)!;
    const html = await getText(recs[0].url).catch(() => null);
    const cfg = html ? spConfigOf(html) : null;
    if (!cfg) return;
    const colours = coloursOf(cfg, style);
    for (const r of recs) {
      const d = colours.get(r.externalId.split("_")[1] ?? "");
      if (!d || d.sizes.length === 0) continue;
      r.variants = { colors: r.colorName ? [r.colorName] : [], sizes: d.sizes };
      r.inStock = d.sizes.some((s) => s.availability !== "out_of_stock");
      if (d.barcodes.length) r.barcodes = d.barcodes;
    }
  });

  return [...byId.values()];
}
