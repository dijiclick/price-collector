/**
 * New Balance Turkey by url. The product page (`/urun/<routePath>`) is a
 * Next.js page whose server-rendered props in `__NEXT_DATA__` hold the whole
 * product — prices and per-barcode stock — so one HTML fetch is the lookup.
 * Same fields as the collector (packages/collector/src/brands/newbalance.ts).
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, dispatcher, toMinor } from "../live-http";

const SITE = "https://www.newbalance.com.tr";
const IMG = "https://newbalance.sm.mncdn.com/";

async function html(url: string, country: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "tr-TR,tr;q=0.9" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(country),
    });
    if (!r.ok) {
      console.warn(`live-lookup: newbalance.com.tr refused with HTTP ${r.status}`);
      return null;
    }
    return await r.text();
  } catch (err) {
    console.warn(`live-lookup: newbalance.com.tr unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** The product object out of a PDP's `__NEXT_DATA__`, or null. */
export function nbProductFromHtml(page: string): any | null {
  const m = page.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1])?.props?.pageProps?.data?.response?.product ?? null;
  } catch {
    return null;
  }
}

export function mapNbProduct(p: any): LiveProduct | null {
  const price = Number(p?.salesPrice ?? p?.discountPrice);
  if (!p?.id || !p?.name || !Number.isFinite(price) || price <= 0) return null;
  const base = Number(p.basePrice);
  const stock: Record<string, number> = p.stocksByBarcode ?? {};
  const qty = Object.values(stock).map(Number);
  const docs: any[] = (p.documents ?? []).filter((d: any) => typeof d?.filePath === "string" && (d.documentType ?? "Image") === "Image");
  const img = docs.find((d) => d.isDefault) ?? docs[0];
  const attr = (code: string): string | null =>
    (p.attributes ?? []).find((a: any) => a?.attribute?.integrationCode === code)?.attributeValues?.[0]?.value ?? null;
  const g = String(attr("attr_gender") ?? "");
  const cats: any[] = p.categories ?? [];
  const cat = cats.find((c) => c?.isDefault) ?? cats[cats.length - 1];
  return {
    brand: "newbalance",
    externalId: String(p.id),
    name: String(p.name).replace(/\s+/g, " ").trim(),
    url: `${SITE}/urun/${p.routePath}`,
    imageUrl: img ? IMG + String(img.filePath).replace(/^\/+/, "") : null,
    price: toMinor(price),
    listPrice: Number.isFinite(base) && base > price ? toMinor(base) : null,
    inStock: qty.length ? qty.some((n) => n > 0) : true,
    category: cat?.name ?? null,
    type: null,
    gender: /kad[ıi]n/i.test(g) ? "kadin" : /erkek/i.test(g) ? "erkek" : /[çc]ocuk|bebek|gen[çc]/i.test(g) ? "cocuk" : null,
    colorName: attr("attr_color"),
    country: "TR",
    currency: "TRY",
  };
}

export async function newbalanceUrl(url: string): Promise<LiveProduct | null> {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const m = u.pathname.match(/^\/urun\/([^/?#]+)\/?$/);
  if (!m) return null;
  const page = await html(`${SITE}/urun/${m[1]}`, countryFor("newbalance"));
  const p = page ? nbProductFromHtml(page) : null;
  return p ? mapNbProduct(p) : null;
}
