/**
 * Patagonia by url (`patagonia.com/product/<slug>/<pid>.html?dwvar_<pid>_color=<CODE>`,
 * also patagonia.ca). The site itself answers bots with an Akamai failover
 * page, so the style is read from Bloomreach Discovery (core.dxpapi.com,
 * account 7718 — the collector's feed, packages/collector/src/brands/patagonia.ts):
 * `price` is the style's regular price, `variants` one sku per colour with that
 * colour's current price, `colors`/`sizes` the orderable skus. The colour in
 * the url picks the row; without one the cheapest in-stock colour is quoted.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, json } from "../live-http";

const MARKETS = {
  US: { host: "patagonia.com", domainKey: "patagonia", site: "https://www.patagonia.com", currency: "USD" },
  CA: { host: "patagonia.ca", domainKey: "patagonia_en_ca", site: "https://www.patagonia.ca", currency: "CAD" },
} as const;
type Market = keyof typeof MARKETS;

const FIELDS = "pid,title,price,price_range,url,thumb_image,gender,sizes,colors,sku_price,sku_sale_price,sku_color,sku_thumb_images";

export function patagoniaRefFromUrl(url: string): { country: Market; pid: string; colour: string | null } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const h = u.hostname.toLowerCase().replace(/^www\./, "");
  const country = (Object.keys(MARKETS) as Market[]).find((c) => h === MARKETS[c].host);
  if (!country) return null;
  const pid = u.pathname.match(/\/product\/(?:[^/]+\/)?([A-Za-z0-9]+)\.html/)?.[1];
  if (!pid) return null;
  return { country, pid, colour: u.searchParams.get(`dwvar_${pid}_color`) };
}

const PREFIX: Record<string, string> = {
  "m's": "Men's", "w's": "Women's", "k's": "Kids'", "kids'": "Kids'", "b's": "Boys'", "g's": "Girls'", baby: "Baby",
};
const pretty = (t: string) =>
  t.replace(/\s+/g, " ").trim().split(" ").map((w, i) =>
    i === 0 && PREFIX[w.toLowerCase()] ? PREFIX[w.toLowerCase()] : w.replace(/(^|[-/(])([a-z])/g, (_, p, c) => p + c.toUpperCase()),
  ).join(" ");
const codeOf = (img: unknown) =>
  typeof img === "string" ? img.match(/\/hi-res\/[A-Za-z0-9-]+_([A-Za-z0-9]+)\.(?:jpg|png|webp)/)?.[1] ?? null : null;
const toMinor = (n: number) => Math.round(n * 100);

/** Map one Bloomreach style doc to the colour asked for. Pure. */
export function mapPatagoniaDoc(d: any, country: Market, colour: string | null): LiveProduct | null {
  const m = MARKETS[country];
  const pid = String(d?.pid ?? "");
  const regular = Math.max(Number(d?.price) || 0, ...((d?.price_range ?? []) as unknown[]).map(Number).filter(Number.isFinite));
  if (!pid || !d?.title || !(regular > 0)) return null;
  const inStock = new Set<string>((d.colors ?? []).map(String));
  const rows = (d.variants ?? [])
    .map((v: any) => ({ name: String(v?.sku_color ?? ""), price: Number(v?.sku_sale_price ?? v?.sku_price), img: v?.sku_thumb_images?.[0] }))
    .map((r: any) => ({ ...r, code: codeOf(r.img) }))
    .filter((r: any) => r.name && r.price > 0 && r.code);
  if (!rows.length) return null;
  const want = colour?.toUpperCase();
  const pick =
    rows.find((r: any) => r.code.toUpperCase() === want) ??
    [...rows].sort((a: any, b: any) => Number(inStock.has(b.name)) - Number(inStock.has(a.name)) || a.price - b.price)[0];
  const title = String(d.title);
  const first = title.trim().split(/\s+/)[0].toLowerCase();
  const gender = /^(k's|kids'?|b's|g's|baby|toddler)$/.test(first) ? "cocuk" : d.gender === "womens" ? "kadin" : d.gender === "mens" ? "erkek" : null;
  const base = String(d.url ?? `${m.site}/product/${pid}.html`).replace(/^https?:\/\/[^/]+/, m.site).split("?")[0];
  return {
    brand: "patagonia",
    externalId: `${pid}-${pick.code}`,
    name: pretty(title),
    url: `${base}?dwvar_${pid}_color=${pick.code}`,
    imageUrl: pick.img ?? null,
    price: toMinor(pick.price),
    listPrice: pick.price < regular - 0.005 ? toMinor(regular) : null,
    inStock: inStock.has(pick.name),
    category: null,
    type: null,
    gender,
    colorName: pick.name.replace(/(^|[\s/:-])([a-z])/g, (_: string, p: string, c: string) => p + c.toUpperCase()),
    country,
    currency: m.currency,
  };
}

export async function patagoniaUrl(url: string): Promise<LiveProduct | null> {
  const ref = patagoniaRefFromUrl(url);
  if (!ref) return null;
  const m = MARKETS[ref.country];
  const q = new URLSearchParams({
    account_id: "7718", domain_key: m.domainKey, request_type: "search", search_type: "keyword",
    q: "*", efq: `pid:("${ref.pid}")`, rows: "1", start: "0", fl: FIELDS,
    _br_uid_2: "uid=1000000000000", url: `${m.site}/`, ref_url: `${m.site}/`,
  });
  const body = await json<any>(
    `https://core.dxpapi.com/api/v1/core/?${q}`,
    { Accept: "application/json", "User-Agent": UA },
    countryFor("patagonia", ref.country),
  );
  const doc = body?.response?.docs?.find((d: any) => String(d?.pid) === ref.pid);
  return doc ? mapPatagoniaDoc(doc, ref.country, ref.colour) : null;
}
