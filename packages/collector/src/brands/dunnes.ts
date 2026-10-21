/**
 * Dunnes Stores (dunnesstores.com, Ireland, EUR) — a VTEX store. 2026-10-21.
 *
 * Route: VTEX's public catalogue search
 * `/api/catalog_system/pub/products/search?O=OrderByBestDiscountDESC&_from&_to`
 * (50 a page, deepest reduction first). Each SKU's `commertialOffer` carries
 * `Price` (now) and `ListPrice` (the struck price the site prints); a product
 * is kept only when one of its SKUs has ListPrice above Price. Paging stops
 * after two pages in a row with no reduction (the sort is per product, so the
 * tail is full-price rows). Measured: ~450 reduced of ~4,960 products — a real
 * markdown list. Answers GitHub runners (probe run 39634392109).
 *
 * Fashion only: the product's top category must be Women, Men, Kids or School
 * (Home, Seasonal, gifts are dropped). SKUs are size×colour; per-size stock is
 * `AvailableQuantity`.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const SITE = "https://www.dunnesstores.com";
const PAGE = 50;
const MAX_PAGES = 30;
const CAP = 1500;
const PAUSE_MS = Number(process.env.DUNNES_PAUSE_MS ?? 800);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const searchUrl = (from: number) =>
  `${SITE}/api/catalog_system/pub/products/search?O=OrderByBestDiscountDESC&_from=${from}&_to=${from + PAGE - 1}`;

const TOP: Record<string, ProductRecord["gender"]> = { women: "kadin", men: "erkek", kids: "cocuk", school: "cocuk" };

/** "/Women/Clothing/Dresses/" → "women". */
const topOf = (cats: unknown): string | null => {
  const c = Array.isArray(cats) && cats.length ? String(cats[cats.length - 1]) : "";
  return c.split("/").filter(Boolean)[0]?.toLowerCase() ?? null;
};

/** Map one search product. Pure; null unless a SKU is reduced and it is fashion. */
export function mapDunnes(p: any, country: CountryCode = "IE"): ProductRecord | null {
  if (!p?.productId || !p?.productName || !p?.link) return null;
  const top = topOf(p.categories);
  if (!top || !(top in TOP)) return null;
  const items: any[] = Array.isArray(p.items) ? p.items : [];
  const offers = items.map((it) => ({ it, o: it?.sellers?.[0]?.commertialOffer ?? {} }));
  const reduced = offers.filter(({ o }) => Number(o.ListPrice) > Number(o.Price) && Number(o.Price) > 0);
  if (!reduced.length) return null;
  const pool = reduced.some(({ o }) => Number(o.AvailableQuantity) > 0) ? reduced.filter(({ o }) => Number(o.AvailableQuantity) > 0) : reduced;
  const lead = pool.reduce((a, b) => (Number(b.o.Price) < Number(a.o.Price) ? b : a));

  const sizes: SizeVariant[] = [];
  for (const { it, o } of offers) {
    const label = String((Array.isArray(it?.Size) ? it.Size[0] : it?.Size) ?? "").trim();
    if (!label) continue;
    const q = Number(o.AvailableQuantity) || 0;
    const prev = sizes.find((s) => s.label === label);
    const availability = q <= 0 ? "out_of_stock" : q <= 2 ? "low_on_stock" : "in_stock";
    if (!prev) sizes.push({ label, availability });
    else if (prev.availability === "out_of_stock" && q > 0) prev.availability = availability;
  }
  const imgs: string[] = (lead.it?.images ?? [])
    .map((im: any) => im?.imageUrl)
    .filter((u: unknown): u is string => typeof u === "string" && u.startsWith("http"));
  const colour = (Array.isArray(lead.it?.colour) ? lead.it.colour[0] : lead.it?.colour) ?? null;
  const cats: string[] = Array.isArray(p.categories) ? p.categories : [];
  const leaf = cats[0] ? String(cats[0]).split("/").filter(Boolean).slice(1).join(" / ") : null;
  const brand = typeof p.brand === "string" && p.brand.trim() && !/^dunnes stores$/i.test(p.brand.trim()) ? p.brand.trim() : null;
  return {
    brand: "dunnes",
    country,
    externalId: String(p.productId),
    name: String(p.productName).replace(/\s+/g, " ").trim(),
    url: String(p.link).replace(/^http:/, "https:"),
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(Number(lead.o.Price)),
    listPrice: toMinor(Number(lead.o.ListPrice)),
    currency: "EUR",
    inStock: offers.some(({ o }) => Number(o.AvailableQuantity) > 0),
    category: leaf || null,
    maker: brand,
    gender: TOP[top],
    variants: sizes.length ? { colors: colour ? [String(colour)] : [], sizes } : null,
    colorName: colour ? String(colour) : null,
  };
}

export async function listDunnes(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "IE") return [];
  const byId = new Map<string, ProductRecord>();
  let dry = 0;
  for (let n = 0; n < MAX_PAGES && byId.size < CAP; n++) {
    if (n > 0) await sleep(PAUSE_MS);
    const rows = await getJson<any[]>(searchUrl(n * PAGE), { country });
    if (!Array.isArray(rows)) throw new Error(`dunnes/IE: page ${n} is not a product array`);
    let reducedHere = 0;
    for (const p of rows) {
      const its: any[] = p?.items ?? [];
      if (its.some((it) => Number(it?.sellers?.[0]?.commertialOffer?.ListPrice) > Number(it?.sellers?.[0]?.commertialOffer?.Price))) reducedHere++;
      const r = mapDunnes(p, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (rows.length < PAGE) break;
    dry = reducedHere ? 0 : dry + 1;
    if (dry >= 2) break;
    if (n === MAX_PAGES - 1) throw new Error(`dunnes/IE: still reduced rows after ${MAX_PAGES} pages`);
  }
  if (!byId.size) throw new Error("dunnes/IE: no reduced fashion products");
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
