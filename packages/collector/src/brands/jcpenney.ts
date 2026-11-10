/**
 * JCPenney (US) — the department store's CLEARANCE shelves, through the search
 * API its own storefront calls.
 *
 * www.jcpenney.com is behind Akamai (403 to a GitHub runner on every page), but
 * `search-api.jcpenney.com/v1/search-service/g/<dept>?id=<deptId>` — the JSON
 * behind each gallery page — answers a runner directly, no proxy (probes
 * 42797942075, 42798181706, 42799363621; 2026-11-10). It is geo-fenced to the
 * US: a Turkish line gets Akamai's 403, so this adapter can only be exercised
 * from a runner.
 *
 * JCPenney runs high-low pricing: most of the catalogue is permanently "SALE"
 * against an "original" price (23,404 of the women's department on
 * 2026-11-10), which is not a markdown. Only `priceType: "CLEARANCE"` — the
 * store's own final markdown, 2,922 women's products that day — is collected,
 * via the gallery's `s1_deals_and_promotions=CLEARANCE` facet. Fine jewellery
 * is left out on purpose (its "original" prices are the least credible in the
 * store and the brand field is "more brands").
 *
 * One row is one product (all colours). Prices are ranges across colours and
 * sizes: the TOP of the current range against the BOTTOM of the original one,
 * kept only if that still shows a markdown. Coupon prices (`fpacPrice*`, "extra
 * 25% off with code") are opt-in and never read. `brand` is the maker — JCPenney
 * sells Nike, Levi's, adidas, Clarks… next to its own labels.
 *
 * The gallery serves 48 products a page ("medium" grid) and at most 25 pages.
 * No sizes in this feed; "Available for Shipping" is the stock flag.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "jcpenney";

const API = "https://search-api.jcpenney.com/v1/search-service";
const SITE = "https://www.jcpenney.com";
const IMG = "https://jcpenney.scene7.com/is/image/JCPenney";
const PAGE = 48;
const CAP = 2000;
const PAUSE_MS = Number(process.env.JCPENNEY_PAUSE_MS ?? 900);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Gender = ProductRecord["gender"];
interface Dept {
  /** Path segment and department id of the gallery. */
  slug: string;
  id: string;
  gender: Gender;
  /** Stored as the category when the department itself is the product type. */
  label: string | null;
  /** Pages of 48 to read — this department's share of the cap. */
  pages: number;
}

/** Women first: the audience, and the biggest clearance shelf. 45 requests in all. */
export const DEPARTMENTS: Dept[] = [
  { slug: "women", id: "dept20000013", gender: "kadin", label: null, pages: 22 },
  { slug: "shoes", id: "dept20000018", gender: null, label: "Shoes", pages: 12 },
  { slug: "handbags-accessories", id: "dept20000019", gender: "kadin", label: "Handbags & Accessories", pages: 4 },
  { slug: "men", id: "dept20000014", gender: "erkek", label: null, pages: 7 },
];

export function galleryUrl(d: Dept, page: number): string {
  return `${API}/g/${d.slug}?id=${d.id}&s1_deals_and_promotions=CLEARANCE&productGridView=medium&page=${page}`;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** "st. john's bay" → "St. John's Bay", "a.n.a" → "A.N.A", "js jessica simpson" → "JS Jessica Simpson". Pure. */
export function makerName(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!s || s === "more brands") return null;
  return s
    .split(" ")
    .map((w, i) => {
      if (i > 0 && /^(by|of|and|the|for|de|la)$/.test(w)) return w;
      if (/^[a-z]{1,2}$/.test(w)) return w.toUpperCase();
      // First letter, and any letter after . - & + / (not after an apostrophe: "levi's").
      return w.replace(/(^|[.\-&+/])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
    })
    .join(" ");
}

/** The shopper a shoe / accessory is for, from the product name ("… Womens Flat Sandals"). Pure. */
export function genderFromName(name: string): Gender {
  const t = name.toLowerCase();
  if (/\b(girls?|boys?|kids?|toddlers?|baby|infants?|little kid|big kid|youth)\b/.test(t)) return "cocuk";
  if (/\bwom[ae]n'?s?\b|\bladies\b|\bmisses\b|\bjuniors?\b/.test(t)) return "kadin";
  if (/\bm[ae]n'?s?\b/.test(t)) return "erkek";
  return null;
}

const image = (id: unknown): string | null => {
  const s = String(id ?? "").trim();
  return s ? `${IMG}/${encodeURIComponent(s)}?wid=800&hei=800&fmt=jpg` : null;
};

/** One gallery product → a record, or null unless it is a real clearance markdown. Pure. */
export function mapJcpenney(p: any, dept: Pick<Dept, "gender" | "label">): ProductRecord | null {
  const id = String(p?.ppId ?? "").trim();
  const name = String(p?.name ?? "").replace(/\s+/g, " ").trim();
  const path = String(p?.pdpUrl ?? "").split("?")[0];
  if (!id || !name || !path.startsWith("/p/")) return null;
  if (p.priceType !== "CLEARANCE") return null;
  if (p.currencyCode && p.currencyCode !== "USD") return null;
  // Minimum-advertised-price items hide the real price; bundles price the set.
  if (p.mapPrice === true || p.bundleIndicator === true) return null;
  const now = num(p.currentMax) ?? num(p.currentMin);
  const was = num(p.originalMin);
  if (now == null || was == null || now >= was) return null;

  const swatches: any[] = Array.isArray(p.skuSwatch) ? p.skuSwatch : [];
  const colors = [...new Set(swatches.map((s) => String(s?.colorName ?? "").trim()).filter(Boolean))];
  const lead = swatches.find((s) => s?.colorizedImageId === p?.imagesInfo?.thumbnailImageId) ?? swatches[0];
  const shots = [
    image(p?.imagesInfo?.thumbnailImageId),
    image(p?.imagesInfo?.altThumbnailImageId),
    ...(Array.isArray(lead?.skuAltImages) ? lead.skuAltImages.map((a: any) => image(a?.imgId)) : []),
  ];
  const status: string[] = (Array.isArray(p.availabilityStatus) ? p.availabilityStatus : []).map((a: any) => String(a?.message ?? ""));
  const maker = makerName(p.brand);
  return {
    brand,
    country: "US",
    externalId: id,
    name,
    url: `${SITE}${path}`,
    imageUrl: shots[0] ?? null,
    images: cleanGallery(shots, shots[0]),
    price: toMinor(now),
    listPrice: toMinor(was),
    currency: "USD",
    inStock: status.some((m) => /available for shipping/i.test(m)) || status.some((m) => /same day pickup/i.test(m) && !/unavailable/i.test(m)),
    category: dept.label,
    maker,
    gender: dept.gender ?? genderFromName(name),
    variants: null,
    colorName: colors.length === 1 ? colors[0] : null,
  };
}

export async function listJcpenney(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const dept of DEPARTMENTS) {
    for (let page = 1; page <= dept.pages && byId.size < CAP; page++) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      let data: any;
      try {
        data = await getJson<any>(galleryUrl(dept, page), { country, retries: 1 });
      } catch (e) {
        // A refused FIRST request must not read as "no clearance"; later ones keep what was read.
        if (!byId.size) throw new Error(`jcpenney/US: ${dept.slug} page ${page} refused (${String(e)})`);
        console.warn(`jcpenney/US: ${dept.slug} page ${page} failed: ${String(e)}`);
        break;
      }
      const zone = data?.organicZoneInfo;
      const rows: any[] = Array.isArray(zone?.products) ? zone.products : [];
      for (const p of rows) {
        const r = mapJcpenney(p, dept);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (!rows.length || zone?.nextPage !== true || page >= Number(zone?.totalPages ?? 0)) break;
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
