/**
 * Calzedonia group on Salesforce Commerce Cloud — Calzedonia, Falconeri and
 * Intimissimi, Turkey and Switzerland (2026-10-11). No proxy: every storefront
 * and API host below answered plain requests, and the GitHub-runner probe
 * reached the TR and CH home pages (Cloudflare, no challenge).
 *
 * TWO ENGINES, one group:
 *
 * - Calzedonia and Falconeri are PWA Kit (composable storefront). Their own
 *   page config publishes a PUBLIC SLAS client (clientId / organizationId /
 *   shortCode), so a guest token comes from the standard PKCE guest flow and
 *   the Shopper Search API answers the sale categories directly. Each hit is
 *   one colour (variation group) with `variants[]` = its sizes, each with
 *   `orderable`, and `c_price` = the storefront's own `{sales, list}` price
 *   model — `list` is the strikethrough, null at full price.
 *
 * - Intimissimi is classic SFRA. The sale category renders server-side with
 *   `?start=&sz=` (sz up to 200); each tile is one colour with its price
 *   block. Sizes come from `Product-Variation` (JSON, per-size `selectable`
 *   and stock `allocation`) for a bounded subset per run.
 *
 * SALE CATEGORIES. The group discounts in two seasonal sales (Jan, Jul);
 * the rest of the year its "promosyon" pages are basket offers (3 for 2,
 * 3rd at −50%) with no strike price. On 2026-10-11 every sale category in
 * TR and CH was empty; a full walk of Calzedonia (TR+CH) and Intimissimi
 * promo pages found no strike price at all, so those return 0 until the next
 * sale starts and then fill by themselves. Falconeri is the exception — see
 * its market table.
 *
 * FULL CATALOGUE (Falconeri Turkey only, 2026-10-19). That market returns every
 * hit of its walk, discounted or not (full price = `listPrice: null`), because
 * the run's sweep marks every unseen product out of stock. FAL_Women + FAL_Men
 * are the whole range (928 colours; the site root adds one soap), 11 pages,
 * ~25 s. Its page budget is raised so a full sale tree in January cannot crowd
 * the range out, and any failed page fails the run (a gap would be swept as
 * sold out). Every other brand and market keeps the deals-only walk.
 */
import crypto from "node:crypto";
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson, getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export interface ScapiClient {
  clientId: string;
  organizationId: string;
  shortCode: string;
}

export interface GroupMarket {
  /** SFCC site id, e.g. `calzedonia-tr`. */
  siteId: string;
  /** `tr-TR` (SCAPI) / `tr_TR` (SFRA). */
  locale: string;
  /** Storefront path segment: `tr`, `ch`. */
  path: string;
  /** Sale category ids (searching a parent includes its children). */
  saleCgids: string[];
  /** Return every hit of the walk (full price too), not only marked-down ones. SCAPI only. */
  fullCatalogue?: boolean;
}

export interface GroupBrand {
  brand: string;
  engine: "scapi" | "sfra";
  origin: string;
  scapi?: ScapiClient;
  markets: Partial<Record<CountryCode, GroupMarket>>;
}

export const GROUP: Record<string, GroupBrand> = {
  calzedonia: {
    brand: "calzedonia",
    engine: "scapi",
    origin: "https://www.calzedonia.com",
    scapi: { clientId: "ac56781a-38fd-4bda-957a-eb3a65a26065", organizationId: "f_ecom_bjhw_prd", shortCode: "pl89mw3n" },
    markets: {
      TR: { siteId: "calzedonia-tr", locale: "tr-TR", path: "tr", saleCgids: ["CAL_Women_Sales_TR", "CAL_Men_Sales_TR", "CAL_Kids_Sales_TR"] },
      CH: { siteId: "calzedonia-ch", locale: "de-CH", path: "ch", saleCgids: ["CAL_Women_Sales_CH", "CAL_Men_Sales_CH", "CAL_Kids_Sales_CH"] },
      // EU (2026-10-21), site ids/locales from the storefront's own site list.
      // Only ES (343) and PT (302) had a women's sale running that day; the
      // other markets answer with an empty sale tree and fill when it starts.
      ...calzedoniaEu(),
    },
  },
  falconeri: {
    brand: "falconeri",
    engine: "scapi",
    origin: "https://www.falconeri.com",
    scapi: { clientId: "3816fde0-4a1c-433d-83eb-a2fc8f794440", organizationId: "f_ecom_bkql_prd", shortCode: "cr1vsgq4" },
    markets: {
      // Falconeri also runs strike-price promotions inside the normal range
      // (Ultrasoft cashmere 189,90 → 179,90 TL / 268 → 249 CHF on 2026-10-11,
      // ~26 colours per market), so after the sale tree the whole Women + Men
      // catalogue is walked too (~1.2k colours, ~13 pages).
      // Turkey returns the whole range (full price too) — see FULL CATALOGUE above.
      TR: { siteId: "falconeri-tr", locale: "tr-TR", path: "tr", saleCgids: ["FAL_Sale_TR", "FAL_Women_Sale_TR", "FAL_Women", "FAL_Men"], fullCatalogue: true },
      CH: { siteId: "falconeri-ch", locale: "de-CH", path: "ch", saleCgids: ["FAL_Sale_CH", "FAL_Women_Sale_CH", "FAL_Women", "FAL_Men"] },
    },
  },
  intimissimi: {
    brand: "intimissimi",
    engine: "sfra",
    origin: "https://www.intimissimi.com",
    markets: {
      TR: { siteId: "intimissimi-tr", locale: "tr_TR", path: "tr", saleCgids: ["INT_Woman_Sales_TR", "INT_Man_Sales_TR"] },
      CH: { siteId: "intimissimi-ch", locale: "de_CH", path: "ch", saleCgids: ["INT_Woman_Sales_CH", "INT_Man_Sales_CH"] },
      // EU (2026-10-21): every one of these sale categories exists (it renders its
      // own "Sale" page) but was empty that day. AT/NL/BE are left out: their
      // `INT_*_Sales_XX` ids fall back to the whole catalogue page.
      ...intimissimiEu(),
    },
  },
};

/** Calzedonia's EU sites: `calzedonia-<cc>`, except Italy and Ireland, which share `calzedonia-eu`. */
function calzedoniaEu(): Partial<Record<CountryCode, GroupMarket>> {
  const rows: [CountryCode, string, string][] = [
    ["DE", "calzedonia-de", "de-DE"], ["AT", "calzedonia-at", "de-AT"], ["FR", "calzedonia-fr", "fr-FR"],
    ["NL", "calzedonia-nl", "nl-NL"], ["BE", "calzedonia-be", "fr-BE"], ["ES", "calzedonia-es", "es-ES"],
    ["PT", "calzedonia-pt", "pt-PT"], ["SE", "calzedonia-se", "sv-SE"], ["DK", "calzedonia-dk", "en-DK"],
    ["IT", "calzedonia-eu", "it-IT"], ["IE", "calzedonia-eu", "en-IE"],
  ];
  return Object.fromEntries(
    rows.map(([c, siteId, locale]) => [c, { siteId, locale, path: c.toLowerCase(), saleCgids: [`CAL_Women_Sales_${c}`, `CAL_Men_Sales_${c}`, `CAL_Kids_Sales_${c}`] }]),
  );
}

/** Intimissimi's EU SFRA sites (`intimissimi-<cc>`; Ireland is on `intimissimi-eu`). */
function intimissimiEu(): Partial<Record<CountryCode, GroupMarket>> {
  const rows: [CountryCode, string, string][] = [
    ["IT", "intimissimi-it", "it_IT"], ["DE", "intimissimi-de", "de_DE"], ["FR", "intimissimi-fr", "fr_FR"],
    ["ES", "intimissimi-es", "es_ES"], ["PT", "intimissimi-pt", "pt_PT"], ["IE", "intimissimi-eu", "en_IE"],
    ["SE", "intimissimi-se", "sv_SE"], ["DK", "intimissimi-dk", "en_DK"],
  ];
  return Object.fromEntries(
    rows.map(([c, siteId, locale]) => [c, { siteId, locale, path: c.toLowerCase(), saleCgids: [`INT_Woman_Sales_${c}`, `INT_Man_Sales_${c}`] }]),
  );
}

const MAX_PRODUCTS = Number(process.env.CALZEDONIA_MAX_PRODUCTS ?? 1500);
/** SCAPI pages of 100 (~25 KB a hit; 200 times out at the gateway). ~10 s each. */
const SCAPI_PAGE = 100;
const SCAPI_MAX_PAGES = Number(process.env.CALZEDONIA_SCAPI_MAX_PAGES ?? 18);
/** Full-catalogue markets: page budget and row cap far above Falconeri TR's 928 colours (2026-10-19). */
const FULL_SCAPI_MAX_PAGES = Number(process.env.CALZEDONIA_FULL_SCAPI_MAX_PAGES ?? 60);
const FULL_MAX_PRODUCTS = Number(process.env.CALZEDONIA_FULL_MAX_PRODUCTS ?? 6000);
const SFRA_PAGE = 200;
const SFRA_MAX_PAGES = Number(process.env.CALZEDONIA_SFRA_MAX_PAGES ?? 10);
const SFRA_DETAIL_LIMIT = Number(process.env.CALZEDONIA_DETAIL_LIMIT ?? 35);
const PAUSE_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN);

/** "Woman" / "Man" / "Kid…" (c_productGender) or a category path → our section. */
export function genderOf(text: string | null | undefined): ProductRecord["gender"] {
  const t = String(text ?? "").toLowerCase();
  if (/kid|child|girl|boy|baby|cocuk|bebek/.test(t)) return "cocuk";
  if (/wom[ae]n|kadin|kadın|damen|donna/.test(t)) return "kadin";
  if (/\bm[ae]n\b|_man|man_|erkek|herren|uomo|^man$/.test(t)) return "erkek";
  return null;
}

const sizeAvailability = (orderable: boolean, allocation?: number): SizeVariant["availability"] =>
  !orderable ? "out_of_stock" : allocation != null && allocation > 0 && allocation <= 2 ? "low_on_stock" : "in_stock";

// ───────────────────────── SCAPI (Calzedonia, Falconeri) ─────────────────────────

/** Map one Shopper Search hit (a variation group = one colour). Pure. */
export function mapScapiHit(b: GroupBrand, country: CountryCode, m: GroupMarket, h: any): ProductRecord | null {
  const sales = num(h?.c_price?.sales?.value ?? h?.price);
  if (!h?.productId || !h?.productName || !Number.isFinite(sales) || sales <= 0) return null;
  // The storefront's own strike price; else the dearest pricebook, per variant (never a size range).
  let list = num(h?.c_price?.list?.value);
  if (!Number.isFinite(list)) {
    const rep = (h.variants ?? []).find((v: any) => v?.productId === h?.representedProduct?.id) ?? h.variants?.[0];
    const tiers = (rep?.tieredPrices ?? []).map((t: any) => num(t?.price)).filter(Number.isFinite);
    list = tiers.length ? Math.max(...tiers) : NaN;
  }
  const colourAttr = (h.c_variationsFullData ?? []).find((a: any) => a?.attributeId === "color");
  const colourKey: string | undefined = colourAttr?.id;
  const selected = (colourAttr?.values ?? []).find((v: any) => v?.selected) ?? null;
  const sizes: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const v of h.variants ?? []) {
    const vals: Record<string, string> = v?.variationValues ?? {};
    const key = Object.keys(vals).find((k) => k !== colourKey && /TAGLIE|SIZE/i.test(k)) ?? Object.keys(vals).find((k) => k !== colourKey);
    const label = key ? String(vals[key]).trim() : "";
    if (!label || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: sizeAvailability(v?.orderable === true) });
  }
  const medium = (h.c_images?.medium ?? selected?.images?.medium ?? []) as any[];
  const imgs = medium.map((i) => i?.absURL ?? i?.url).filter((u: unknown): u is string => typeof u === "string");
  const first = imgs[0] ?? h.image?.link ?? h.c_image ?? null;
  const path = typeof h.c_seoUrlPathname === "string" && h.c_seoUrlPathname ? h.c_seoUrlPathname : `/product/${h.productId}.html`;
  const colour = typeof selected?.displayValue === "string" ? selected.displayValue : null;
  const master = String(h.productId).split("_color_")[0];
  return {
    brand: b.brand,
    country,
    externalId: String(h.productId),
    name: String(h.productName).trim(),
    url: `${b.origin}/${m.path}${path.startsWith("/") ? "" : "/"}${path}`,
    imageUrl: first,
    images: cleanGallery(imgs, first),
    price: toMinor(sales),
    listPrice: Number.isFinite(list) && list - sales > 0.005 ? toMinor(list) : null,
    currency: typeof h.currency === "string" ? h.currency : COUNTRIES[country].currency,
    inStock: h.orderable === true && h.c_isSoldout !== true,
    category: typeof h.c_primaryCategory === "string" ? h.c_primaryCategory.replace(/^[A-Z]{3}_/, "").replace(/[_-]+/g, " ") : null,
    gender: genderOf(h.c_productGender ?? h.c_categoryPath),
    variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: master ? `${b.brand}:${master}` : null,
    colorName: colour,
  };
}

/** SLAS guest token through the public client's PKCE flow (what the storefront itself does). */
export async function guestToken(b: GroupBrand, m: GroupMarket): Promise<string> {
  const c = b.scapi!;
  const base = `https://${c.shortCode}.api.commercecloud.salesforce.com/shopper/auth/v1/organizations/${c.organizationId}/oauth2`;
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const redirect = `${b.origin}/callback`;
  const auth = await fetch(
    `${base}/authorize?${new URLSearchParams({ redirect_uri: redirect, response_type: "code", client_id: c.clientId, hint: "guest", code_challenge: challenge })}`,
    { redirect: "manual" },
  );
  const loc = auth.headers.get("location");
  if (!loc) throw new Error(`${b.brand}: SLAS authorize answered ${auth.status} without a redirect`);
  const u = new URL(loc);
  const tok = await getJson<any>(`${base}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code_pkce",
      code: u.searchParams.get("code") ?? "",
      usid: u.searchParams.get("usid") ?? "",
      code_verifier: verifier,
      client_id: c.clientId,
      redirect_uri: redirect,
      channel_id: m.siteId,
    }).toString(),
    retries: 1,
  });
  if (!tok?.access_token) throw new Error(`${b.brand}: no SLAS token`);
  return tok.access_token;
}

async function listScapi(b: GroupBrand, country: CountryCode, m: GroupMarket): Promise<ProductRecord[]> {
  const c = b.scapi!;
  const token = await guestToken(b, m);
  const out = new Map<string, ProductRecord>();
  const full = m.fullCatalogue === true;
  const maxPages = full ? FULL_SCAPI_MAX_PAGES : SCAPI_MAX_PAGES;
  let pages = 0;
  for (const cgid of m.saleCgids) {
    for (let offset = 0; pages < maxPages || full; offset += SCAPI_PAGE) {
      // A full-catalogue walk cut by the page budget would be swept as sold out: refuse instead.
      if (pages >= maxPages) throw new Error(`${b.brand}/${country}: over ${maxPages} search pages — raise CALZEDONIA_FULL_SCAPI_MAX_PAGES`);
      if (pages > 0) await sleep(PAUSE_MS);
      pages++;
      const q = new URLSearchParams({
        siteId: m.siteId,
        refine: `cgid=${cgid}`,
        limit: String(SCAPI_PAGE),
        offset: String(offset),
        locale: m.locale,
        currency: COUNTRIES[country].currency,
        expand: "prices,variations,availability,images,represented_products",
        perPricebook: "true",
        allVariationProperties: "true",
      });
      const j = await getJson<any>(
        `https://${c.shortCode}.api.commercecloud.salesforce.com/search/shopper-search/v1/organizations/${c.organizationId}/product-search?${q}`,
        { headers: { Authorization: `Bearer ${token}` }, retries: full ? 2 : 1, country },
      ).catch((e) => {
        if (full) throw new Error(`${b.brand}/${country}: ${cgid} offset ${offset} failed (${e?.message ?? e})`);
        return null;
      });
      const hits: any[] = j?.hits ?? [];
      for (const h of hits) {
        const r = mapScapiHit(b, country, m, h);
        if (r && (full || r.listPrice != null) && !out.has(r.externalId)) out.set(r.externalId, r);
      }
      if (!hits.length || offset + SCAPI_PAGE >= Number(j?.total ?? 0)) break;
    }
  }
  return [...out.values()];
}

// ───────────────────────── SFRA (Intimissimi) ─────────────────────────

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/**
 * Parse the product tiles of an SFRA listing page. Pure.
 * Price: the `sales` value is charged; any larger price `content` in the same
 * price block (the struck list price) is the original.
 */
export function parseSfraTiles(html: string, b: GroupBrand, country: CountryCode): ProductRecord[] {
  const grid = html.indexOf("cc-plp-productGrid");
  if (grid < 0) return [];
  const body = html.slice(grid);
  const starts = [...body.matchAll(/class="cc-prodTile js-prodTile[^"]*"\s+data-pid="([^"]+)"/g)];
  const out: ProductRecord[] = [];
  for (let i = 0; i < starts.length; i++) {
    const pid = starts[i][1];
    const tile = body.slice(starts[i].index!, i + 1 < starts.length ? starts[i + 1].index : undefined);
    const href = tile.match(/<a class="js-prodTile-name" href="([^"]+)"/)?.[1] ?? tile.match(/href="(\/[a-z]{2}\/product\/[^"]+)"/)?.[1];
    const name = tile.match(/cc-prodTile-name[^"]*"[^>]*itemprop="name"[^>]*>\s*([^<]+?)\s*</)?.[1];
    const pc = tile.indexOf("price-container");
    if (!href || !name || pc < 0) continue;
    const block = tile.slice(pc, tile.indexOf("</a>", pc) > 0 ? tile.indexOf("</a>", pc) : undefined);
    const salesMatch = block.match(/class="[^"]*\bsales\b[^"]*"[\s\S]*?content="(\d+(?:\.\d+)?)"/);
    const values = [...block.matchAll(/content="(\d+(?:\.\d+)?)"/g)].map((x) => Number(x[1])).filter((n) => n > 0);
    const sales = salesMatch ? Number(salesMatch[1]) : values.length ? Math.min(...values) : NaN;
    if (!Number.isFinite(sales) || sales <= 0) continue;
    const list = values.length ? Math.max(...values) : NaN;
    const imgs = [...tile.matchAll(/<img class="[^"]*cc-prodTile-imageContainer-image[^"]*"[^>]*\ssrc="([^"]+)"/g)].map((x) => decode(x[1]));
    const soldOut = /schema\.org\/OutOfStock/.test(tile);
    const path = decode(href);
    out.push({
      brand: b.brand,
      country,
      externalId: pid,
      name: decode(name).trim(),
      url: path.startsWith("http") ? path : `${b.origin}${path}`,
      imageUrl: imgs[0] ?? null,
      images: cleanGallery(imgs, imgs[0] ?? null),
      price: toMinor(sales),
      listPrice: list - sales > 0.005 ? toMinor(list) : null,
      currency: tile.match(/itemprop="priceCurrency" content="([A-Z]{3})"/)?.[1] ?? COUNTRIES[country].currency,
      inStock: !soldOut,
      category: null,
      gender: null,
      variants: null,
      groupKey: `${b.brand}:${pid.split("_color_")[0]}`,
      colorName: null,
    });
  }
  return out;
}

/** Sizes, colour and section from SFRA `Product-Variation` JSON. Pure. */
export function sfraDetail(j: any): { sizes: SizeVariant[]; colour: string | null; gender: ProductRecord["gender"]; category: string | null } {
  const p = j?.product ?? {};
  const attrs: any[] = p.variationAttributes ?? [];
  const sizeAttr = attrs.find((a) => a?.attributeId === "size");
  const colourAttr = attrs.find((a) => a?.attributeId === "color");
  const sizes: SizeVariant[] = (sizeAttr?.values ?? [])
    .filter((v: any) => v?.displayValue)
    .map((v: any) => ({ label: String(v.displayValue).trim(), availability: sizeAvailability(v.selectable === true, num(v.allocation)) }));
  const colour = (colourAttr?.values ?? []).find((v: any) => v?.selected)?.displayValue ?? null;
  const path: string = typeof p.categoryPath === "string" ? p.categoryPath : "";
  return {
    sizes,
    colour,
    gender: genderOf(path.split("/")[0] ?? ""),
    category: path ? path.split("/").pop()!.replace(/^[a-z]+_(woman|man|kids?)_/, "").replace(/_/g, " ") : null,
  };
}

async function listSfra(b: GroupBrand, country: CountryCode, m: GroupMarket): Promise<ProductRecord[]> {
  const out = new Map<string, ProductRecord>();
  const sectionOf = new Map<string, ProductRecord["gender"]>();
  let pages = 0;
  for (const cgid of m.saleCgids) {
    const section = genderOf(cgid.replace(/^INT_/, ""));
    for (let start = 0; pages < SFRA_MAX_PAGES; start += SFRA_PAGE) {
      if (pages > 0) await sleep(PAUSE_MS);
      pages++;
      const html = await getText(`${b.origin}/${m.path}/search/?cgid=${encodeURIComponent(cgid)}&start=${start}&sz=${SFRA_PAGE}`, { country }).catch(() => "");
      const tiles = parseSfraTiles(html, b, country);
      for (const r of tiles) {
        if (!out.has(r.externalId)) {
          out.set(r.externalId, r);
          sectionOf.set(r.externalId, section);
        }
      }
      if (tiles.length < SFRA_PAGE) break;
    }
  }
  const deals = [...out.values()].filter((r) => r.listPrice != null);
  for (const r of deals) r.gender = sectionOf.get(r.externalId) ?? null;
  // Sizes for a rotating subset.
  const want = deals.filter((r) => r.inStock);
  for (let j = want.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [want[j], want[k]] = [want[k], want[j]];
  }
  for (const r of want.slice(0, SFRA_DETAIL_LIMIT)) {
    await sleep(PAUSE_MS);
    const j = await getJson<any>(
      `${b.origin}/on/demandware.store/Sites-${m.siteId}-Site/${m.locale}/Product-Variation?pid=${encodeURIComponent(r.externalId)}`,
      { retries: 0, country },
    ).catch(() => null);
    if (!j?.product) continue;
    const d = sfraDetail(j);
    if (d.sizes.length) {
      r.variants = { colors: d.colour ? [d.colour] : [], sizes: d.sizes };
      r.inStock = d.sizes.some((s) => s.availability !== "out_of_stock");
    }
    r.colorName = d.colour;
    r.gender = r.gender ?? d.gender;
    r.category = d.category;
    // The detail price is authoritative when the tile parse disagrees.
    const s = num(j.product.price?.sales?.value);
    const l = num(j.product.price?.list?.value);
    if (Number.isFinite(s) && s > 0) {
      r.price = toMinor(s);
      r.listPrice = Number.isFinite(l) && l - s > 0.005 ? toMinor(l) : null;
    }
  }
  return deals.filter((r) => r.listPrice != null);
}

// ───────────────────────── entry point ─────────────────────────

export async function listCalzedoniaGroup(slug: string, country: CountryCode): Promise<ProductRecord[]> {
  const b = GROUP[slug];
  if (!b) throw new Error(`unknown Calzedonia-group brand ${slug}`);
  const m = b.markets[country];
  if (!m) return [];
  const rows = b.engine === "scapi" ? await listScapi(b, country, m) : await listSfra(b, country, m);
  if (m.fullCatalogue && rows.length > FULL_MAX_PRODUCTS) throw new Error(`${slug}/${country}: ${rows.length} products, over the cap of ${FULL_MAX_PRODUCTS}`);
  return [...rows.filter((r) => r.inStock), ...rows.filter((r) => !r.inStock)].slice(0, m.fullCatalogue ? FULL_MAX_PRODUCTS : MAX_PRODUCTS);
}
