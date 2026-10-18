/**
 * Atasay by url (`atasay.com/tr/<slug>-<sku>/`). The shop's own Akinon JSON
 * (`?format=json`) answers only Turkish IPs (AWS load balancer 403 elsewhere,
 * Vercel included), so this asks the same Segmentify search the collector
 * reads (packages/collector/src/brands/atasay.ts): searching for the SKU
 * returns exactly that product, with the same price/oldPrice pair and the same
 * id (`productId` = the SKU ending the url).
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, dispatcher, toMinor } from "../live-http";

const SITE = "https://www.atasay.com";
const ENDPOINT = "https://gandalf.segmentify.com/add/events/v1.json?apiKey=a60372ab-4b04-4f0c-b815-71f72ece3dc3";

/** The SKU ending an Atasay product url, or null. */
export function atasaySkuFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!u.hostname.toLowerCase().endsWith("atasay.com")) return null;
  return u.pathname.match(/-(\d{6,})\/?$/)?.[1] ?? null;
}

const title = (s: string) => s.toLocaleLowerCase("tr").replace(/(^|[\s-])\S/g, (c) => c.toLocaleUpperCase("tr"));

/** Map one Segmentify row, same rules as the collector's mapAtasay. Pure. */
export function mapAtasayLive(p: any): LiveProduct | null {
  const price = Number(p?.price);
  const old = Number(p?.oldPrice);
  const url = typeof p?.url === "string" ? p.url.split("?")[0] : "";
  if (!p?.productId || !p?.name || !url.startsWith(SITE) || !Number.isFinite(price) || price <= 0) return null;
  const paths: string[] = (Array.isArray(p.category) ? p.category : []).map((c: unknown) => String(c ?? "").trim()).filter(Boolean);
  const real = paths.find((c) => !/^AYNI GÜN KARGO/i.test(c)) ?? paths.find((c) => c.split(">").length >= 3) ?? null;
  const leaf = real ? real.split(">").pop()!.trim() : "";
  const g = [p.name, ...paths].join(" | ").toLocaleLowerCase("tr");
  const gender = /çocuk|bebek/.test(g) ? "cocuk" : /erkek/.test(g) ? "erkek" : /kadın|bayan/.test(g) ? "kadin" : null;
  return {
    brand: "atasay",
    externalId: String(p.productId),
    name: String(p.name).trim(),
    url,
    imageUrl: typeof p.image === "string" ? p.image : null,
    price: toMinor(price),
    listPrice: Number.isFinite(old) && old > price && price >= old * 0.1 ? toMinor(old) : null,
    inStock: p.inStock !== false,
    category: leaf ? title(leaf) : null,
    type: null,
    gender,
    colorName: null,
    country: "TR",
    currency: "TRY",
  };
}

/** The search row that IS the pasted product, or null. Pure. */
export function pickAtasayRow(body: any, sku: string): any | null {
  const s = body?.search?.[0]?.[0];
  const rows = [...(s?.products ?? []), ...Object.values<any[]>(s?.categoryProducts ?? {}).flat()];
  return rows.find((p) => String(p?.productId) === sku) ?? null;
}

export async function atasayUrl(url: string): Promise<LiveProduct | null> {
  const sku = atasaySkuFromUrl(url);
  if (!sku) return null;
  const visitor = Math.random().toString(36).slice(2, 12);
  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Accept: "application/json", "User-Agent": UA, Origin: SITE, Referer: `${SITE}/` },
      body: JSON.stringify([
        { name: "SEARCH", type: "instant", query: sku, userId: visitor, sessionId: visitor, device: "PC", lang: "TR", currency: "TRY", pageUrl: `${SITE}/` },
      ]),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(countryFor("atasay")),
    });
    if (!r.ok) {
      console.warn(`live-lookup: gandalf.segmentify.com refused with HTTP ${r.status}`);
      return null;
    }
    const row = pickAtasayRow(await r.json(), sku);
    return row ? mapAtasayLive(row) : null;
  } catch (err) {
    console.warn(`live-lookup: gandalf.segmentify.com unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
