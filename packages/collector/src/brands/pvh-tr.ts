/**
 * Calvin Klein and Tommy Hilfiger TURKEY (tr.calvinklein.com, tr.tommy.com —
 * PVH's Turkish partner runs both on the same ASP.NET storefront), 2026-10-12.
 *
 * LISTING. Both sites search through PersonaClick, keyed by a public shop id in
 * the home page (`personaclick("init", "<id>")`):
 *
 *   https://api.personaclick.com/search?shop_id=<id>&type=full_search
 *     &search_query=<brand word>&limit=200&page=N
 *
 * The brand word matches the brand field, so it returns the whole in-stock
 * catalogue (CK 1,567 rows / 8 pages, Tommy 1,977 / 10 on 2026-10-12). Rows are
 * one COLOUR each (`id` = model + colour code, `group_id` = model) with the
 * public price and, when marked down, `oldprice` = the strikethrough the site
 * shows. Member-only prices ("Üyelere Özel İndirim") never appear here: those
 * rows carry no `oldprice` and the PDP shows them at full price to a guest.
 * Both answer a GitHub runner with 200 (probe run 38235646734). No proxy.
 *
 * SIZES. `fashion_original_sizes` lists only the sizes in stock, so it cannot
 * say which size sold out (and a restock alert needs exactly that). The PDP
 * HTML has every size with `data-stock` — the PDPs also answer runners — so a
 * rotating shuffled subset gets full per-size stock each run; the upsert keeps
 * earlier variants for the rest (`variants: null` = keep), the Akinon pattern.
 */
import { cleanGallery, type ProductRecord, type SizeVariant, type ProductVariants } from "../types";
import { getJson, getText } from "../http";
import { toMinor } from "../normalize";

export type PvhTrBrand = "calvinklein" | "tommyhilfiger";

interface Shop {
  site: string;
  shopId: string;
  query: string;
}

export const PVH_TR: Record<PvhTrBrand, Shop> = {
  calvinklein: { site: "https://tr.calvinklein.com", shopId: "b287fbbb905f71c26d35797140e15c", query: "calvin" },
  tommyhilfiger: { site: "https://tr.tommy.com", shopId: "664f5176dd5e00d440b1054e7903b4", query: "tommy" },
};

const PAGE_SIZE = 200;
const MAX_PAGES = Number(process.env.PVHTR_MAX_PAGES ?? 12);
const CAP = Number(process.env.PVHTR_MAX_PRODUCTS ?? 1500);
const DETAIL_LIMIT = Number(process.env.PVHTR_DETAIL_LIMIT ?? 40);
const CONCURRENCY = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const searchUrl = (brand: PvhTrBrand, page: number): string => {
  const s = PVH_TR[brand];
  return `https://api.personaclick.com/search?shop_id=${s.shopId}&type=full_search&search_query=${s.query}&limit=${PAGE_SIZE}&page=${page}`;
};

const fold = (s: string) =>
  s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").replace(/[Şş]/g, "s").replace(/[Ğğ]/g, "g").replace(/[Öö]/g, "o").replace(/[Üü]/g, "u").toLowerCase();

const param = (p: any, key: string): string | null => {
  const v = (p?.params ?? []).find((x: any) => x?.key === key)?.values?.[0];
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

/** The section from the name's prefix ("Kız Çocuk …", "Bebek …", "Kadın …"); the feed's flag as a fallback. */
export function genderOf(p: any): ProductRecord["gender"] {
  const name = fold(String(p?.name ?? ""));
  if (/^(bebek|cocuk|kiz cocuk|erkek cocuk|unisex cocuk|genc)\b|\bcocuk\b/.test(name) || p?.fashion_feature === "child") return "cocuk";
  if (/^kadin\b/.test(name)) return "kadin";
  if (/^erkek\b/.test(name)) return "erkek";
  return p?.fashion_gender === "f" ? "kadin" : p?.fashion_gender === "m" ? "erkek" : null;
}

/** Map one PersonaClick row. Pure; `null` for rows without a usable price, id or own url. */
export function mapPvhTr(brand: PvhTrBrand, p: any): ProductRecord | null {
  const { site } = PVH_TR[brand];
  const price = Number(p?.price_full ?? p?.price);
  const old = Number(p?.oldprice_full ?? p?.oldprice);
  if (!p?.id || !p?.name || typeof p?.url !== "string" || !Number.isFinite(price) || price <= 0) return null;
  const url = p.url.split("?")[0];
  if (!url.startsWith(`${site}/`)) return null;
  const img = typeof p.image_url === "string" ? p.image_url : p.image_url_resized?.original ?? null;
  const colour = param(p, "color");
  return {
    brand,
    country: "TR",
    externalId: String(p.id),
    name: String(p.name).trim(),
    url,
    imageUrl: img,
    images: cleanGallery([], img),
    price: toMinor(price),
    listPrice: Number.isFinite(old) && old - price > 0.005 ? toMinor(old) : null,
    currency: "TRY",
    // The search only returns sellable rows; the PDP pass refines this.
    inStock: true,
    category: param(p, "kategori"),
    gender: genderOf(p),
    variants: null,
    groupKey: p.group_id ? `${brand}:${p.group_id}` : null,
    colorName: colour,
  };
}

const decode = (s: string) =>
  s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

/** Every size on a PDP with its stock: `<a … data-stock="0" … data-js="size-item">2XL</a>`. Pure. */
export function pdpSizes(html: string): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b([^>]*\bdata-js="size-item"[^>]*)>([\s\S]*?)<\/a>/g)) {
    const stock = Number(/\bdata-stock="(\d+)"/.exec(m[1])?.[1] ?? NaN);
    const label = decode(m[2]) || (/\btitle="([^"]*)"/.exec(m[1])?.[1] ?? "").trim();
    if (!label || !Number.isFinite(stock) || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, availability: stock > 2 ? "in_stock" : stock > 0 ? "low_on_stock" : "out_of_stock" });
  }
  // A lone one-size label is a bag or a cap, not a size anyone waits for.
  if (out.length === 1 && /^(os|standart|std|tek ebat|tek beden)$/i.test(out[0].label)) return [];
  return out;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

export async function listPvhTr(brand: PvhTrBrand): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  let rowsSeen = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) await sleep(500);
    const d = await getJson<any>(searchUrl(brand, page), { retries: 2 }).catch((e) => {
      if (page === 1) throw new Error(`${brand}/TR: PersonaClick search refused (${e?.message ?? e})`);
      return null;
    });
    const rows: any[] = Array.isArray(d?.products) ? d.products : [];
    rowsSeen += rows.length;
    for (const p of rows) {
      const r = mapPvhTr(brand, p);
      if (r && r.listPrice != null && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  if (rowsSeen === 0) throw new Error(`${brand}/TR: PersonaClick search returned no products`);
  const records = [...byId.values()].slice(0, CAP);

  // Full per-size stock for a rotating shuffled subset (the feed only lists sizes in stock).
  const pick = [...records];
  for (let j = pick.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [pick[j], pick[k]] = [pick[k], pick[j]];
  }
  await pool(pick.slice(0, DETAIL_LIMIT), CONCURRENCY, async (r) => {
    const html = await getText(r.url, { timeoutMs: 20_000 }).catch(() => null);
    if (!html) return;
    const sizes = pdpSizes(html);
    if (!sizes.length) return;
    const variants: ProductVariants = { colors: r.colorName ? [r.colorName] : [], sizes };
    r.variants = variants;
    r.inStock = sizes.some((s) => s.availability !== "out_of_stock");
  });

  return [...records.filter((r) => r.inStock), ...records.filter((r) => !r.inStock)];
}
