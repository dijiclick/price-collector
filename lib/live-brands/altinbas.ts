/**
 * Altınbaş by url (`altinbas.com/urun/<slug>[/kod/<code>]`). The collector
 * reads PrimeWidgets' search (packages/collector/src/brands/altinbas.ts), and
 * so does this: the same endpoint finds a product by its code, so the row,
 * price rule (basket price kept) and id (`itemGroupId`) are the collector's.
 *
 * A pasted url names the product either by `/kod/<code>` (a SKU code, which
 * can differ from the group id) or only by its slug, whose tail is the group
 * id lower-cased (`pirlanta-tektas-yuzuk-sk214by-8k` → `SK214BY-8K`). The id
 * itself may hold a hyphen, so the last one to three slug tokens are tried.
 */
import type { LiveProduct } from "../live-lookup";
import { postJson, toMinor } from "../live-http";

const SITE = "https://www.altinbas.com";
const ENDPOINT = "https://api.tr.primewidgets.com/products/searchv5/altinbas";

export interface AltinbasRef {
  slug: string;
  kod: string | null;
}

export function altinbasRefFromUrl(url: string): AltinbasRef | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!u.hostname.toLowerCase().endsWith("altinbas.com")) return null;
  const m = u.pathname.match(/^\/urun\/([^/?#]+)(?:\/kod\/([^/?#]+))?\/?$/i);
  if (!m) return null;
  return { slug: decodeURIComponent(m[1]).toLowerCase(), kod: m[2] ? decodeURIComponent(m[2]) : null };
}

/** Search terms to try, most specific first. */
export function altinbasCandidates(ref: AltinbasRef): string[] {
  const parts = ref.slug.split("-").filter(Boolean);
  const tails = [2, 1, 3].filter((n) => n <= parts.length).map((n) => parts.slice(-n).join("-").toUpperCase());
  return [...new Set([...(ref.kod ? [ref.kod] : []), ...tails])];
}

const slugOf = (url: unknown): string | null =>
  typeof url === "string" ? url.match(/\/urun\/([^/?#]+)/i)?.[1]?.toLowerCase() ?? null : null;

/** The search row that IS the pasted product, or null. Pure. */
export function pickAltinbasRow(rows: any[], ref: AltinbasRef, term: string): any | null {
  const t = term.toUpperCase();
  return (
    rows.find((p) => ref.kod && (String(p?.code).toUpperCase() === ref.kod.toUpperCase() || String(p?.itemGroupId).toUpperCase() === ref.kod.toUpperCase())) ??
    rows.find((p) => slugOf(p?.url) === ref.slug) ??
    rows.find((p) => String(p?.itemGroupId ?? "").toUpperCase() === t) ??
    null
  );
}

const attr = (p: any, name: string): string | null => {
  const a = (p?.attributes ?? []).find((x: any) => x?.name === name);
  const v = a?.values?.[0] ?? a?.value;
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

const title = (s: string) => s.toLocaleLowerCase("tr").replace(/(^|[\s-])\S/g, (c) => c.toLocaleUpperCase("tr"));

/** Map one PrimeWidgets row, same rules as the collector's mapAltinbas. Pure. */
export function mapAltinbasLive(p: any): LiveProduct | null {
  const price = Number(p?.price);
  const old = Number(p?.oldPrice);
  const id = p?.itemGroupId ?? p?.code;
  if (!id || !p?.name || typeof p?.url !== "string" || !Number.isFinite(price) || price <= 0) return null;
  const names = (p.categories ?? []).map((c: any) => String(c?.name ?? "").trim()).filter(Boolean);
  const leaf = names.length ? names[names.length - 1].split(">").pop()!.trim() : "";
  const g = [attr(p, "gender") ?? "", ...names].join(" | ").toLocaleLowerCase("tr");
  const gender = /çocuk|bebek/.test(g) ? "cocuk" : /kadın|bayan/.test(g) ? "kadin" : /erkek|\bbay\b/.test(g) ? "erkek" : null;
  const img = (p.images ?? []).find((u: unknown) => typeof u === "string") ?? null;
  return {
    brand: "altinbas",
    externalId: String(id),
    name: String(p.name).trim(),
    url: p.url.split("?")[0],
    imageUrl: img,
    price: toMinor(price),
    listPrice: Number.isFinite(old) && old > price && price >= old * 0.1 ? toMinor(old) : null,
    inStock: p.status !== "PASSIVE",
    category: leaf ? title(leaf) : null,
    type: null,
    gender,
    colorName: null,
    country: "TR",
    currency: "TRY",
  };
}

export async function altinbasUrl(url: string): Promise<LiveProduct | null> {
  const ref = altinbasRefFromUrl(url);
  if (!ref) return null;
  for (const term of altinbasCandidates(ref)) {
    const d = await postJson<any>(
      ENDPOINT,
      {
        status: "ACTIVE",
        search: term,
        price: {},
        paging: { index: 1, size: 20 },
        filter: {},
        attributes: [],
        groupBy: "item_group_id",
      },
      "tr",
    );
    const row = pickAltinbasRow(d?.results?.products?.data ?? [], ref, term);
    if (row) return mapAltinbasLive({ ...row, url: row.url ?? `${SITE}/urun/${ref.slug}` });
  }
  return null;
}
