/**
 * J.Crew group — J.Crew (jcrew.com), J.Crew Factory (factory.jcrew.com) and
 * Madewell (madewell.com) — through the Constructor.io index each storefront
 * browses with.
 *
 * All three sites sit behind Akamai (403 on every page from a runner, and from
 * a plain curl on the Mac), but their product grids come from Constructor.io
 * (`ac.cnstrc.com`) with a public storefront key loaded by the page
 * (`cnstrc.com/js/cust/<site>_*.js`, then `key=` on every browse call).
 * Constructor answers a plain GET from a GitHub runner — no proxy (probe run
 * 38220601704, 2026-10-12: 200 for the J.Crew US and CA sale, Factory and
 * Madewell sale).
 *
 * One result is one style; its SKUs (size × colour) are folded server-side by
 * `variations_map`, grouped by orderable × sizing × colour, so a single page
 * of 200 styles carries every colour's price and its in-stock vs. sold-out
 * sizes — real per-size stock without a request per product.
 *
 * Markets: J.Crew and Factory sell to Canada in CAD from the same index
 * (`price_cad` / `listPrice_cad`, `allowedCountries`, `/ca/` path). Madewell's
 * index carries USD only, so Madewell is US-only.
 *
 * J.Crew Factory: 99% of its catalogue carries a struck-through "Comparable
 * value" (an outside reference price, not a price Factory ever charged), so
 * the whole shop would read as 50–70% off. Only the Clearance section counts:
 * the site's own clearance grid (`group_id/sale`, `displayOn=standard_<cur>`),
 * and in it only the colours whose SKUs sit in a `sale~…` group. Their list
 * price is still the comparable value — it is what the site strikes through —
 * so Factory percentages run high by design.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export type JcrewBrand = "jcrew" | "jcrewfactory" | "madewell";

interface Site {
  key: string; // public storefront key
  host: string;
  /** Market → path prefix on the site. */
  markets: Partial<Record<CountryCode, string>>;
  /** Factory: restrict the grid and the colours to its clearance section. */
  clearanceOnly?: boolean;
  /** J.Crew / Factory SKUs carry `allowedCountries`, `productSizingName`, `masterSize`; Madewell's do not. */
  jcrewSchema: boolean;
}

export const JCREW_SITES: Record<JcrewBrand, Site> = {
  jcrew: { key: "key_GZ67TnLoJ8IV4vZ2", host: "https://www.jcrew.com", markets: { US: "", CA: "/ca" }, jcrewSchema: true },
  jcrewfactory: {
    key: "key_nu9b76kKatVvDK9C",
    host: "https://factory.jcrew.com",
    markets: { US: "", CA: "/ca" },
    clearanceOnly: true,
    jcrewSchema: true,
  },
  madewell: { key: "key_HSygYnVncGyVbd4S", host: "https://www.madewell.com", markets: { US: "" }, jcrewSchema: false },
};

const API = "https://ac.cnstrc.com";
/** Constructor wants a client id and session; any stable UUID will do. */
const CLIENT_ID = "6f1d2c3e-4b5a-4c6d-8e7f-a1b2c3d4e5f6";
const PAGE_SIZE = 200;
const MAX_PAGES = 25;
const CAP = 1500;
const PAUSE_MS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const cur = (country: CountryCode) => (country === "CA" ? "cad" : "usd");

/** The server-side fold of a style's SKUs: orderable → sizing → colour → values. */
export function variationsMap(brand: JcrewBrand, country: CountryCode): object {
  const site = JCREW_SITES[brand];
  const sfx = country === "CA" ? "_cad" : "";
  const values: Record<string, { aggregation: string; field: string }> = {
    price: { aggregation: "min", field: `data.price${sfx}` },
    list: { aggregation: "min", field: `data.listPrice${sfx}` },
    sizes: { aggregation: "all", field: site.jcrewSchema ? "data.masterSize" : "data.size" },
    colorName: { aggregation: "first", field: site.jcrewSchema ? "data.color-value" : "data.color-name" },
    displayOn: { aggregation: "first", field: "data.displayOn" },
  };
  if (site.jcrewSchema) values.stock = { aggregation: "all", field: "data.stockLevel" };
  if (site.clearanceOnly) values.groups = { aggregation: "first", field: "data.group_ids" };
  else values.shot = { aggregation: "first", field: "data.shotType" };
  const group_by = [
    { name: "orderable", field: "data.orderable" },
    // Madewell SKUs often lack productSizingName, and a missing group field drops the style.
    ...(site.jcrewSchema ? [{ name: "sizing", field: "data.productSizingName" }] : []),
    { name: "color", field: "data.color" },
  ];
  return { group_by, values, dtype: "object" };
}

export function browseUrl(brand: JcrewBrand, country: CountryCode, page: number): string {
  const site = JCREW_SITES[brand];
  const p = new URLSearchParams();
  p.set("key", site.key);
  p.set("c", "ciojs-client-2.76.1");
  p.set("i", CLIENT_ID);
  p.set("s", "1");
  p.set("page", String(page));
  p.set("num_results_per_page", String(PAGE_SIZE));
  // Styles with at least one orderable SKU; the fold still lists the sold-out sizes.
  p.append("filters[orderable]", "True");
  if (site.jcrewSchema) {
    p.append("filters[allowedCountries]", "ALL");
    p.append("filters[allowedCountries]", country);
    p.append("filters[isAppExclusive]", "False");
  }
  if (site.clearanceOnly) p.append("filters[displayOn]", `standard_${cur(country)}`);
  p.set("variations_map", JSON.stringify(variationsMap(brand, country)));
  return `${API}/browse/group_id/sale?${p}`;
}

interface Fold {
  price?: number | null;
  list?: number | null;
  sizes?: unknown[];
  stock?: unknown[];
  colorName?: string | null;
  displayOn?: string | null;
  shot?: string | null;
  groups?: unknown;
}
interface Group {
  orderable: boolean;
  sizing: string | null;
  v: Fold;
}

/** Flatten `variations_map` to colour → its groups. */
function colours(res: any, jcrewSchema: boolean): Map<string, Group[]> {
  const out = new Map<string, Group[]>();
  for (const [ord, inner] of Object.entries<any>(res?.variations_map ?? {})) {
    const bySizing: [string | null, any][] = jcrewSchema ? Object.entries<any>(inner ?? {}) : [[null, inner]];
    for (const [sizing, byColour] of bySizing) {
      for (const [colour, v] of Object.entries<any>(byColour ?? {})) {
        if (!v || typeof v !== "object") continue;
        const list = out.get(colour) ?? [];
        list.push({ orderable: ord === "true", sizing, v });
        out.set(colour, list);
      }
    }
  }
  return out;
}

const num = (x: unknown): number | null => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function genderOf(g: unknown): ProductRecord["gender"] {
  const s = String(g ?? "").toLowerCase();
  if (s === "women" || s === "womens") return "kadin";
  if (s === "men" || s === "mens") return "erkek";
  if (/^(girls|boys|kids|baby)/.test(s)) return "cocuk";
  return null;
}

/** "womens~categories~clothing~knits-and-tees~crewneck" → "Knits and tees"; Madewell reads its URL path. */
function categoryOf(d: any, jcrewSchema: boolean): string | null {
  let seg: string | undefined;
  if (jcrewSchema) {
    const parts = String(d?.defaultCategoryId ?? "").split("~");
    seg = parts[2] === "clothing" ? parts[3] : parts[2];
  } else {
    const parts = String(d?.url ?? "").split("/p/")[1]?.split("/") ?? [];
    seg = parts[1] === "clothing" ? parts[2] : parts[1];
  }
  if (!seg) return null;
  const t = seg.replace(/-/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : null;
}

/** J.Crew's and Factory's photos come from the Scene7 facade on www.jcrew.com, which answers runners too. */
const jcrewImg = (name: string) => `https://www.jcrew.com/s7-img-facade/${name}?fmt=jpeg&qlt=90&wid=1200&hei=1200`;
/** Madewell's facade answers phones but 403s datacenter IPs; Scene7's public hosts serve a placeholder instead. */
const madewellImg = (name: string) => `https://www.madewell.com/images/${name}?wid=1000&hei=1270&fmt=jpeg&fit=crop&qlt=80`;

function photosOf(brand: JcrewBrand, d: any, id: string, colour: string, groups: Group[]): string[] {
  if (brand === "madewell") {
    const fam = (d?.familyDetails ?? []).flatMap((f: any) => f?.colors ?? []).find((c: any) => c?.id === colour);
    const shots: string[] = Array.isArray(fam?.shotType)
      ? fam.shotType.map(String)
      : String(groups.find((g) => g.v.shot)?.v.shot ?? d?.shotType ?? "_m").split("|");
    // A merged Petite/Tall style (NW671) shows its parent's (NW330) photos: the child id 404s on
    // 221 of 225 such colours (2026-10-21), the parent id answers for all of them.
    const parent = String(d?.parentProduct ?? "");
    const photoId = /^[A-Z0-9]+$/.test(parent) ? parent : id;
    return shots.filter((s) => /^_[a-z0-9]+$/i.test(s)).map((s) => madewellImg(`${photoId}_${colour}${s}`));
  }
  const attr = (d?.colorVariationAttributes ?? []).find((a: any) => a?.color === colour);
  const shots = String(attr?.skuShotType ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^_[a-z0-9]+$/i.test(s));
  // The bare name is the grid's laydown shot; the suffixed ones are the PDP gallery.
  return [jcrewImg(`${id}_${colour}`), ...shots.map((s) => jcrewImg(`${id}_${colour}${s}`))];
}

/** The fit a J.Crew PDP opens on; Madewell has no sizing level (null). */
const isDefaultFit = (sizing: string | null) => !sizing || /^(classic|standard|regular)$/i.test(sizing);
const isDeal = (g: Group) => num(g.v.price)! < num(g.v.list)!;

function sizesOf(groups: Group[]): SizeVariant[] {
  const byLabel = new Map<string, SizeVariant["availability"]>();
  const rank = { out_of_stock: 0, low_on_stock: 1, in_stock: 2 } as const;
  for (const g of groups) {
    const sizes = (g.v.sizes ?? []).map((s) => String(s ?? "").trim());
    const stock = g.v.stock ?? [];
    const aligned = stock.length === sizes.length;
    sizes.forEach((size, i) => {
      if (!size) return;
      const label = isDefaultFit(g.sizing) ? size : `${size} ${g.sizing}`;
      let a: SizeVariant["availability"] = g.orderable ? "in_stock" : "out_of_stock";
      if (g.orderable && aligned) {
        const n = Number(stock[i]);
        if (Number.isFinite(n) && n <= 0) a = "out_of_stock";
        else if (Number.isFinite(n) && n <= 3) a = "low_on_stock";
      }
      const prev = byLabel.get(label);
      if (!prev || rank[a] > rank[prev]) byLabel.set(label, a);
    });
  }
  return [...byLabel].map(([label, availability]) => ({ label, availability }));
}

/**
 * Factory: the colour is in the Clearance section (its SKUs are in a `sale~…`
 * group — the grid's style can hold full-price colours too) and is shown in
 * this market's currency.
 */
function inClearance(groups: Group[], country: CountryCode): boolean {
  const c = cur(country);
  return groups.some((g) => {
    const ids = Array.isArray(g.v.groups) ? g.v.groups.map(String) : [];
    const shown = String(g.v.displayOn ?? "").split("|");
    return ids.some((id) => id.startsWith("sale~")) && (shown.includes(`standard_${c}`) || shown.includes(`sale_${c}`));
  });
}

/** Map one Constructor result (one style) to its reduced colours. Pure. */
export function mapJcrewResult(brand: JcrewBrand, res: any, country: CountryCode): ProductRecord[] {
  const site = JCREW_SITES[brand];
  const prefix = site.markets[country];
  const d = res?.data;
  const id = String(d?.id ?? "");
  if (prefix === undefined || !id || !res?.value) return [];
  const out: ProductRecord[] = [];
  for (const [colour, groups] of colours(res, site.jcrewSchema)) {
    // Fits price apart (CS864 Deco Blue: Petite CAD 102, Classic 188), so the row is priced from one
    // group and links that fit: orderable first, then a discounted one, then the site's default fit.
    const head = [...groups].sort((a, b) => Number(b.orderable) - Number(a.orderable));
    const priced = groups
      .filter((g) => num(g.v.price) != null && num(g.v.list) != null)
      .sort((a, b) => Number(b.orderable) - Number(a.orderable) || Number(isDeal(b)) - Number(isDeal(a)) || Number(isDefaultFit(b.sizing)) - Number(isDefaultFit(a.sizing)))[0];
    if (!priced) continue;
    // min / min, never min-sale vs max-list: a size range is not a discount.
    const sale = num(priced.v.price)!;
    const list = num(priced.v.list)!;
    if (sale >= list) continue;
    if (site.clearanceOnly && !inClearance(groups, country)) continue;
    const sizes = sizesOf(groups);
    const inStock = sizes.length ? sizes.some((s) => s.availability !== "out_of_stock") : groups.some((g) => g.orderable);
    const rawColour = String(head.find((g) => g.v.colorName)?.v.colorName ?? "").trim();
    const colourName = rawColour ? titleCase(rawColour) : null;
    const photos = photosOf(brand, d, id, colour, groups);
    const url =
      brand === "madewell"
        ? `${String(d.url ?? `${site.host}/p/${id}/`).split("?")[0]}?ccode=${encodeURIComponent(colour)}`
        : `${site.host}${prefix}/p/${id}?color_name=${encodeURIComponent(slug(rawColour || colour))}` +
          // The PDP opens on Classic; `fit=` (the site's own links carry it) selects the priced fit.
          (priced.sizing && !isDefaultFit(priced.sizing) ? `&fit=${encodeURIComponent(priced.sizing)}` : "");
    out.push({
      brand,
      country,
      externalId: `${id}-${colour}`,
      name: String(res.value).trim(),
      url,
      imageUrl: photos[0] ?? null,
      images: cleanGallery(photos, photos[0] ?? null),
      price: toMinor(sale),
      listPrice: toMinor(list),
      currency: COUNTRIES[country].currency,
      inStock,
      category: categoryOf(d, site.jcrewSchema),
      gender: genderOf(d.productGender),
      variants: sizes.length ? { colors: colourName ? [colourName] : [], sizes } : null,
      groupKey: `${brand}-${id}`,
      colorName: colourName,
    });
  }
  return out;
}

export async function listJcrew(brand: JcrewBrand, country: CountryCode): Promise<ProductRecord[]> {
  if (JCREW_SITES[brand]?.markets[country] === undefined) return [];
  const byId = new Map<string, ProductRecord>();
  let inStock = 0;
  for (let page = 1; page <= MAX_PAGES && inStock < CAP; page++) {
    if (page > 1) await sleep(PAUSE_MS);
    const data = await getJson<any>(browseUrl(brand, country, page), { country });
    const results: any[] = data?.response?.results ?? [];
    for (const res of results) {
      for (const r of mapJcrewResult(brand, res, country)) {
        if (byId.has(r.externalId)) continue;
        byId.set(r.externalId, r);
        if (r.inStock) inStock++;
      }
    }
    const total = Number(data?.response?.total_num_results ?? 0);
    if (results.length < PAGE_SIZE || page * PAGE_SIZE >= total) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
