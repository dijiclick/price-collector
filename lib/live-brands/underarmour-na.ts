/**
 * Under Armour US / Canada by url (`www.underarmour.com/en-us/p/<slug>/<id>.html
 * ?dwvar_<id>_color=<code>`, same for `/en-ca/`). The site answers datacenter
 * egress with HTTP 418 "Client Challenge", so the product is read from the
 * locale's Constructor.io index (`browse/items?ids=<id>`) with the same
 * per-colour fold the collector uses (packages/collector/src/brands/
 * underarmour-na.ts): salePrice / listPrice per colour, single values only,
 * stock = any SKU of the colour `orderable`. The id is `<style>-<colour>`, as
 * the collector's. underarmour.com.tr (Akinon) is not this host and returns
 * null here; other locales (en-gb, de-de, …) return null too.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, json, toMinor } from "../live-http";

const HOST = "https://ezeubuswo-zone.cnstrc.com";
const SITE = "https://www.underarmour.com";
const MARKETS: Record<string, { key: string; country: "US" | "CA"; currency: string }> = {
  "en-us": { key: "key_Gz4VzKsXbR7b7fSh", country: "US", currency: "USD" },
  "en-ca": { key: "key_MbFu7hkkn75UIUIA", country: "CA", currency: "CAD" },
};

const VARIATIONS_MAP = JSON.stringify({
  dtype: "array",
  group_by: [{ name: "color", field: "data.colorWayId.color" }],
  values: {
    sale: { aggregation: "min", field: "data.salePrice" },
    saleMax: { aggregation: "max", field: "data.salePrice" },
    list: { aggregation: "max", field: "data.listPrice" },
    listMin: { aggregation: "min", field: "data.listPrice" },
    skus: { aggregation: "all", field: "data.sku" },
    ord: { aggregation: "all", field: "data.orderable" },
    colorWay: { aggregation: "first", field: "data.colorWay" },
    img: { aggregation: "first", field: "data.image_url" },
    img2: { aggregation: "first", field: "data.gridTileHoverImageURL" },
  },
});

/** {locale, id, color} out of an underarmour.com US/CA product url, or null. */
export function underarmourNaFromUrl(url: string): { locale: string; id: string; color: string | null } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)underarmour\.com$/i.test(u.hostname)) return null;
  const locale = u.pathname.match(/^\/(en-us|en-ca)\//i)?.[1]?.toLowerCase();
  const id = u.pathname.match(/\/p\/.*?([0-9]{7})\.html$/)?.[1];
  if (!locale || !id) return null;
  const color = u.searchParams.get(`dwvar_${id}_color`);
  return { locale, id, color: color && /^[A-Za-z0-9]{1,6}$/.test(color) ? color : null };
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const https = (u: unknown): string | null =>
  typeof u === "string" && /^(https?:)?\/\//.test(u) ? u.replace(/^(https?:)?\/\//, "https://") : null;

/** Map a `browse/items` body for one style. Pure. */
export function mapUnderArmourNaItem(body: any, locale: string, id: string, color: string | null): LiveProduct | null {
  const m = MARKETS[locale];
  const r = (body?.response?.results ?? []).find((x: any) => String(x?.data?.id) === id);
  const d = r?.data;
  if (!m || !d || typeof r.value !== "string" || typeof d.url !== "string") return null;
  if (d.priceCurrency && d.priceCurrency !== m.currency) return null;
  const own = (v: any) => {
    const skus: string[] = Array.isArray(v?.skus) ? v.skus.map(String) : [];
    return !skus.length || skus.some((s) => s.startsWith(`${id}-${v.color}-`));
  };
  const vs: any[] = (Array.isArray(r.variations_map) ? r.variations_map : []).filter((v: any) => v?.color != null && own(v) && num(v.sale) != null);
  const reduced = (v: any) => num(v.sale)! < (num(v.list) ?? 0) && num(v.saleMax) === num(v.sale) && num(v.listMin) === num(v.list);
  const v = (color ? vs.find((x) => String(x.color) === color) : null) ?? vs.find(reduced) ?? vs[0];
  if (!v) return null;
  const c = String(v.color);
  const sale = num(v.sale)!;
  const single = num(v.saleMax) === sale;
  const list = num(v.list);
  const photos = [https(v.img), https(v.img2)].filter((u): u is string => !!u);
  return {
    brand: "underarmour",
    externalId: `${id}-${c}`,
    name: r.value.replace(/\s+/g, " ").trim(),
    url: `${SITE}/${locale}${d.url.startsWith("/") ? "" : "/"}${d.url}?dwvar_${id}_color=${c}`,
    imageUrl: photos.find((u) => u.includes(`${id}-${c}`)) ?? photos[1] ?? photos[0] ?? null,
    price: toMinor(single ? sale : num(v.saleMax) ?? sale),
    listPrice: reduced(v) && list != null ? toMinor(list) : null,
    inStock: Array.isArray(v.ord) ? v.ord.some((o: unknown) => o === true || o === "true") : d.orderable !== false,
    category: typeof d.subHeader === "string" ? d.subHeader : null,
    type: null,
    gender: /^women/i.test(String(d.subHeader ?? "")) ? "kadin" : /^men/i.test(String(d.subHeader ?? "")) ? "erkek" : /^(boys|girls|kids|youth|baby|infant|toddler)/i.test(String(d.subHeader ?? "")) ? "cocuk" : null,
    colorName: typeof v.colorWay === "string" ? v.colorWay.trim() : null,
    country: m.country,
    currency: m.currency,
  };
}

export async function underarmourNaUrl(url: string): Promise<LiveProduct | null> {
  const p = underarmourNaFromUrl(url);
  if (!p) return null;
  const m = MARKETS[p.locale];
  const q = new URLSearchParams({ key: m.key, ids: p.id, variations_map: VARIATIONS_MAP });
  const body = await json<any>(`${HOST}/browse/items?${q}`, { Accept: "application/json", "User-Agent": UA }, countryFor("underarmour", m.country));
  return mapUnderArmourNaItem(body, p.locale, p.id, p.color);
}
