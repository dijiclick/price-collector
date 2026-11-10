/**
 * Bazarchic (France) — off-price flash-sale store: Mulberry, Chloé, Coach,
 * Furla, Michael Kors, Missoni, Stuart Weitzman, Bally, Lacoste… (2026-11-10).
 *
 * Route: the site's own public GraphQL gateway,
 * `POST https://services-fr.bazarchic.com/gateway/graphql`, operation
 * `productsByFamilyId` (the query the category pages `/c/<slug>-<id>/` run; text
 * copied from the site's JS chunk). No login, no token: the category pages and
 * this query are public even though the home page shows a sign-up wall. The
 * headers below are the ones the site's client sends. Pagination is
 * `{ first, after: base64(offset) }`; `first: 300` is honoured (~265 KB a page).
 * Answers a GitHub runner 200 (probe run 42803190152) and the Mac.
 *
 * Measured 2026-11-10: women's clothes 4,234 · shoes 2,449 · bags 290 ·
 * accessories 131 · jewellery 1,309 · lingerie 1,298; men's clothes 1,752 ·
 * shoes 1,120 · bags 8. EUR only — one French storefront (the de/nl/es/it
 * pages are translations of it, not local shops).
 *
 * Prices: `sellPrice` is what you pay, `publicPrice` the brand's public price
 * the site strikes through. By design EVERY product of an off-price club is
 * below its public price — this is not a markdown on Bazarchic's own former
 * price. Rows without a public price above the sell price are dropped
 * (lingerie multi-packs mostly). When the price is per size
 * (`appliedPrice: "SIZE"`) the dearest sellable size is used, so the card never
 * understates.
 *
 * Stock is real per size (`sizeDatas[].stock`). Sales last a few days, so rows
 * turn over quickly; a product leaves the feed when its sale ends.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const GATEWAY = "https://services-fr.bazarchic.com/gateway/graphql";
const SITE = "https://fr.bazarchic.com";
const PAGE = 300;
const CAP = 2500;
const PAUSE_MS = Number(process.env.BAZARCHIC_PAUSE_MS ?? 500);

export const BAZARCHIC_QUERY =
  "query getProductByCategoryId($familyId: ID!, $sortCustom: SortEnum, $facetFilters: [FacetInput], $pagination: PaginationInput) { " +
  "productsByFamilyId(familyId: $familyId, sort: $sortCustom, facetFilters: $facetFilters, pagination: $pagination) { " +
  "pageInfo { endCursor hasNextPage } totalCount edges { cursor node { id groupId hasStock " +
  "sizeDatas { productId stock size sellPrice publicPrice } imagesDatas { urlListPage } title sellPrice publicPrice " +
  "appliedPrice brandDatas { id name } unsuitableForUnderaged saleId } } } }";

/** The site's product families (`/c/<slug>-<id>/`), women first; `take` = rows kept per family. */
export const BAZARCHIC_FAMILIES: { id: string; label: string; gender: "kadin" | "erkek"; take: number }[] = [
  { id: "15", label: "Vêtements femme", gender: "kadin", take: 900 },
  { id: "13", label: "Chaussures femme", gender: "kadin", take: 500 },
  { id: "14", label: "Maroquinerie femme", gender: "kadin", take: 290 },
  { id: "12", label: "Accessoires femme", gender: "kadin", take: 130 },
  { id: "44", label: "Bijoux femme", gender: "kadin", take: 150 },
  { id: "52", label: "Lingerie femme", gender: "kadin", take: 130 },
  { id: "8", label: "Vêtements homme", gender: "erkek", take: 250 },
  { id: "17", label: "Chaussures homme", gender: "erkek", take: 150 },
];

export interface BazarchicNode {
  id: string;
  groupId?: number | string | null;
  hasStock?: boolean | null;
  sizeDatas?: { productId?: number; stock?: number | null; size?: string | null; sellPrice?: number | null; publicPrice?: number | null }[] | null;
  imagesDatas?: { urlListPage?: string | null }[] | null;
  title?: string | null;
  sellPrice?: number | null;
  publicPrice?: number | null;
  appliedPrice?: string | null;
  brandDatas?: { id?: string; name?: string | null } | null;
  unsuitableForUnderaged?: boolean | null;
  saleId?: number | null;
}

/** "T.36" / "T.Taille unique: 37/40" / "M" → "36" / "Taille unique: 37/40" / "M". */
export const sizeLabel = (s: string): string => s.replace(/^T\./, "").trim();

/** One product → a record, or null when it has no public price above the sell price. Pure. */
export function mapBazarchic(n: BazarchicNode, family: { label: string; gender: ProductRecord["gender"] }): ProductRecord | null {
  const id = String(n.groupId ?? n.id ?? "");
  const title = (n.title ?? "").replace(/\s+/g, " ").trim();
  if (!id || !title || n.unsuitableForUnderaged) return null;
  const sizes: SizeVariant[] = [];
  for (const s of n.sizeDatas ?? []) {
    const label = sizeLabel(s.size ?? "");
    if (!label || sizes.some((x) => x.label === label)) continue;
    sizes.push({ label, availability: (s.stock ?? 0) > 0 ? "in_stock" : "out_of_stock" });
  }
  let sell = n.sellPrice ?? NaN;
  let pub = n.publicPrice ?? NaN;
  if (n.appliedPrice === "SIZE") {
    // Priced per size: take the dearest sellable size (never understate the card).
    const live = (n.sizeDatas ?? []).filter((s) => (s.stock ?? 0) > 0 && (s.sellPrice ?? 0) > 0);
    const top = live.sort((a, b) => (b.sellPrice ?? 0) - (a.sellPrice ?? 0))[0];
    if (top) {
      sell = top.sellPrice ?? sell;
      pub = top.publicPrice ?? pub;
    }
  }
  if (!(sell > 0) || !(pub > sell)) return null;
  const maker = n.brandDatas?.name?.trim() || null;
  const imgs = (n.imagesDatas ?? []).map((i) => i.urlListPage ?? null).filter((u): u is string => !!u && u.startsWith("https://"));
  const inStock = sizes.length ? sizes.some((s) => s.availability === "in_stock") : n.hasStock !== false;
  return {
    brand: "bazarchic",
    country: "FR",
    externalId: id,
    name: maker && !title.toLowerCase().includes(maker.toLowerCase()) ? `${maker} ${title}` : title,
    url: `${SITE}/ventes/produit/id/${id}/`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(sell),
    listPrice: toMinor(pub),
    currency: "EUR",
    inStock,
    category: family.label,
    gender: family.gender,
    maker,
    variants: sizes.length ? { colors: [], sizes } : null,
    groupKey: null,
  };
}

export const bazarchicBody = (familyId: string, offset: number): string =>
  JSON.stringify({
    query: BAZARCHIC_QUERY,
    variables: { familyId, facetFilters: [], pagination: { first: PAGE, after: offset ? Buffer.from(String(offset)).toString("base64") : "" } },
  });

interface Resp { data?: { productsByFamilyId?: { pageInfo?: { hasNextPage?: boolean }; totalCount?: number; edges?: { node: BazarchicNode }[] } | null }; errors?: unknown }

async function fetchPage(familyId: string, offset: number): Promise<Resp> {
  return getJson<Resp>(GATEWAY, {
    country: "FR",
    method: "POST",
    body: bazarchicBody(familyId, offset),
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": "fr-FR,fr;q=0.9",
      "x-os": "SITE",
      "x-device": "DESKTOP",
      "x-country": "FR",
      "x-language": "fr",
      Origin: SITE,
      Referer: `${SITE}/`,
    },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function listBazarchic(country: CountryCode, fetcher: (familyId: string, offset: number) => Promise<Resp> = fetchPage): Promise<ProductRecord[]> {
  if (country !== "FR") return [];
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const fam of BAZARCHIC_FAMILIES) {
    const rows: ProductRecord[] = [];
    for (let offset = 0; rows.filter((r) => r.inStock).length < fam.take && offset < fam.take * 2 + PAGE; offset += PAGE) {
      if (calls++) await sleep(PAUSE_MS);
      let d: NonNullable<Resp["data"]>["productsByFamilyId"];
      try {
        const j = await fetcher(fam.id, offset);
        d = j.data?.productsByFamilyId;
        if (!d) throw new Error(`bazarchic: no data for family ${fam.id} (${JSON.stringify(j.errors ?? null).slice(0, 200)})`);
      } catch (err) {
        if (byId.size === 0 && rows.length === 0) throw err;
        break;
      }
      for (const e of d.edges ?? []) {
        const r = mapBazarchic(e.node, fam);
        if (r && !byId.has(r.externalId) && !rows.some((x) => x.externalId === r.externalId)) rows.push(r);
      }
      if (!d.pageInfo?.hasNextPage || !(d.edges?.length)) break;
    }
    const kept = [...rows.filter((r) => r.inStock), ...rows.filter((r) => !r.inStock)].slice(0, fam.take);
    for (const r of kept) byId.set(r.externalId, r);
  }
  const all = [...byId.values()];
  const out = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
  console.log(`bazarchic/FR: ${calls} requests, kept ${out.length}`);
  return out;
}
