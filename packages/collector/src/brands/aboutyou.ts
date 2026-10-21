/**
 * About You — Switzerland (en.aboutyou.ch), added 2026-10-11; eleven EU shops 2026-10-21. Multi-brand.
 *
 * The storefront renders no products into its HTML; the category grid comes
 * from a gRPC-web API, `https://tadarida-web.aboutyou.com/aysa_api.services.
 * category_page.v1.stream.CategoryStreamService/GetProductStreamV2`. It answers a
 * plain POST (no cookies, no session, no challenge) as long as the request is a
 * well-formed protobuf: config (country/language/device/client version), an
 * empty guest session, the category id, empty applied filters and an
 * offset/limit pagination (limit ≤ 50, larger is rejected).
 *
 * There is no protobuf library in the collector, so the few messages involved
 * are written and read by hand below. Field numbers come from the site's own
 * generated client (`grpc-clients/tadarida/aysa_api/...`, published in its
 * source maps):
 *
 *   GetProductStreamV2Request  1 config · 2 session · 3 category · 4 applied_filters · 5 pagination
 *   Config                     1 country(enum) · 2 language(enum) · 3 device(enum) · 4 client_version
 *   AnySession                 2 no_session (empty)
 *   CategoryIdentifier         1 id(int64)
 *   Pagination                 1 offset · 2 limit
 *   GetProductStreamV2Response 1 items[] · 3 pagination{1 total}
 *   CategoryStreamItemV2       2 product_section{1 ProductTileV2}
 *   ProductTileV2              1 id · 2 name · 3 brand · 4 link{1 url} · 5 price{9 tracker} ·
 *                              7 colors[]{3 product_id} · 9 gallery · 10 available_sizes[] ·
 *                              11 tracker{6 is_sold_out} · 17 sponsored
 *   PriceTracker               1 currency · 2 price · 4 full_price · 5 sale_reduction ·
 *                              6 campaign_reduction · 7 voucher · 8 coupon · 9 coins
 *
 * Prices are CHF rappen already. Voucher, coupon and coins reductions need a
 * code or an account, so they are added back: the price kept is what a guest
 * pays. The tile lists only AVAILABLE sizes, so every size we store is in stock
 * (a size that sells out simply disappears, which the restock diff handles).
 *
 * Women's Sale (32543) holds ~179k items and men's (32544) ~76k, far beyond the
 * cap, so this takes the top of each in the site's own order (≈2/3 women).
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import type { CountryCode } from "../../../../lib/countries";

const GRPC = "https://tadarida-web.aboutyou.com/aysa_api.services.category_page.v1.stream.CategoryStreamService/GetProductStreamV2";
const PAGE = 50;
const PAUSE_MS = Number(process.env.ABOUTYOU_PAUSE_MS ?? 700);
/** Used when the home page cannot be read; the API has accepted stale versions. */
const FALLBACK_CLIENT_VERSION = "build-52ea605d";

export interface AboutYouMarket {
  site: string;
  /** grpcConfig enums as the site sends them. */
  country: number;
  language: number;
  sale: { categoryId: number; gender: ProductRecord["gender"]; share: number }[];
}

export const ABOUTYOU_MARKETS: Partial<Record<CountryCode, AboutYouMarket>> = {
  CH: {
    site: "https://en.aboutyou.ch",
    country: 2,
    language: 16,
    sale: [
      { categoryId: 32543, gender: "kadin", share: 2 / 3 },
      { categoryId: 32544, gender: "erkek", share: 1 / 3 },
    ],
  },
  ...euMarkets(),
};

/**
 * EU shops (2026-10-21): the same gRPC API, the same global sale category ids;
 * only the `grpcConfig` country/language enums differ — read from each shop's
 * home page (`"grpcConfig":{"country":…,"language":…}`). Names come back in the
 * shop's own language.
 */
function euMarkets(): Partial<Record<CountryCode, AboutYouMarket>> {
  const sale: AboutYouMarket["sale"] = [
    { categoryId: 32543, gender: "kadin", share: 2 / 3 },
    { categoryId: 32544, gender: "erkek", share: 1 / 3 },
  ];
  const shops: [CountryCode, string, number, number][] = [
    ["DE", "https://www.aboutyou.de", 1, 1],
    ["AT", "https://www.aboutyou.at", 3, 1],
    ["NL", "https://www.aboutyou.nl", 4, 3],
    ["BE", "https://www.aboutyou.be", 5, 3],
    ["FR", "https://www.aboutyou.fr", 19, 2],
    ["ES", "https://www.aboutyou.es", 22, 19],
    ["IT", "https://www.aboutyou.it", 23, 20],
    ["PT", "https://www.aboutyou.pt", 24, 21],
    ["SE", "https://www.aboutyou.se", 20, 17],
    ["DK", "https://www.aboutyou.dk", 17, 15],
    ["FI", "https://www.aboutyou.fi", 21, 18],
  ];
  return Object.fromEntries(shops.map(([cc, site, country, language]) => [cc, { site, country, language, sale }]));
}

// ---------- minimal protobuf wire format ----------

function varint(n: number): number[] {
  const out: number[] = [];
  let v = Math.max(0, Math.floor(n));
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
  return out;
}
const tagged = (field: number, wire: number) => varint(field * 8 + wire);
export const pbInt = (field: number, n: number): number[] => [...tagged(field, 0), ...varint(n)];
export const pbBytes = (field: number, body: number[] | string): number[] => {
  const b = typeof body === "string" ? [...Buffer.from(body, "utf8")] : body;
  return [...tagged(field, 2), ...varint(b.length), ...b];
};

export type PbField = { f: number; v: number | Uint8Array };

/** Decode one message level into (field, value) pairs; length-delimited stays raw. */
export function pbDecode(buf: Uint8Array): PbField[] {
  const out: PbField[] = [];
  let i = 0;
  const rd = (): number => {
    let r = 0;
    let mul = 1;
    for (;;) {
      if (i >= buf.length) throw new Error("truncated varint");
      const b = buf[i++];
      r += (b & 0x7f) * mul;
      if (!(b & 0x80)) return r;
      mul *= 0x80;
    }
  };
  while (i < buf.length) {
    const key = rd();
    const f = Math.floor(key / 8);
    const w = key % 8;
    if (w === 0) out.push({ f, v: rd() });
    else if (w === 2) {
      const len = rd();
      out.push({ f, v: buf.subarray(i, i + len) });
      i += len;
    } else if (w === 1) i += 8;
    else if (w === 5) i += 4;
    else throw new Error(`wire type ${w}`);
  }
  return out;
}
const txt = (v: unknown) => (v instanceof Uint8Array ? Buffer.from(v).toString("utf8") : "");
const sub = (fs: PbField[], f: number): PbField[] => {
  const x = fs.find((y) => y.f === f)?.v;
  return x instanceof Uint8Array ? pbDecode(x) : [];
};
const num = (fs: PbField[], f: number): number => {
  const x = fs.find((y) => y.f === f)?.v;
  return typeof x === "number" ? x : 0;
};

export function streamRequest(m: AboutYouMarket, clientVersion: string, categoryId: number, offset: number, limit = PAGE): Uint8Array {
  const config = [...pbInt(1, m.country), ...pbInt(2, m.language), ...pbInt(3, 1), ...pbBytes(4, clientVersion)];
  const body = [
    ...pbBytes(1, config),
    ...pbBytes(2, pbBytes(2, [])), // AnySession.no_session
    ...pbBytes(3, pbInt(1, categoryId)),
    ...pbBytes(4, []),
    ...pbBytes(5, [...pbInt(1, offset), ...pbInt(2, limit)]),
  ];
  // gRPC-web frame: flag 0, big-endian length, message.
  const frame = new Uint8Array(5 + body.length);
  new DataView(frame.buffer).setUint32(1, body.length);
  frame.set(body, 5);
  return frame;
}

/** gRPC-web body → the first data frame (trailer frames have the 0x80 flag). */
export function firstDataFrame(buf: Uint8Array): Uint8Array | null {
  let i = 0;
  while (i + 5 <= buf.length) {
    const flag = buf[i];
    const len = new DataView(buf.buffer, buf.byteOffset + i + 1, 4).getUint32(0);
    const payload = buf.subarray(i + 5, i + 5 + len);
    if (!(flag & 0x80)) return payload;
    i += 5 + len;
  }
  return null;
}

/** All http(s) strings anywhere under a message (gallery images are a few levels down). */
function urlsIn(v: Uint8Array, depth = 0, out: string[] = []): string[] {
  if (depth > 6) return out;
  let fs: PbField[];
  try {
    fs = pbDecode(v);
  } catch {
    return out;
  }
  for (const { v: x } of fs) {
    if (!(x instanceof Uint8Array)) continue;
    const s = txt(x);
    if (/^https:\/\/cdn\.aboutstatic\.com\/\S+$/.test(s)) out.push(s);
    else urlsIn(x, depth + 1, out);
  }
  return out;
}

/** One ProductTileV2 → record. Only reduced, guest-priced tiles. Pure. */
export function mapTile(country: CountryCode, site: string, tile: Uint8Array, gender: ProductRecord["gender"] = null): ProductRecord | null {
  const fs = pbDecode(tile);
  const id = num(fs, 1);
  const name = txt(fs.find((x) => x.f === 2)?.v).trim();
  const brand = txt(fs.find((x) => x.f === 3)?.v).trim();
  if (!id || !name) return null;
  if (sub(fs, 11).some((x) => x.f === 6 && x.v === 1)) return null; // sold out
  const tr = sub(sub(fs, 5), 9);
  const currency = txt(tr.find((x) => x.f === 1)?.v) || "CHF";
  const full = num(tr, 4);
  // Code/account-only reductions are added back: keep what a guest pays.
  const price = num(tr, 2) + num(tr, 7) + num(tr, 8) + num(tr, 9);
  if (!(price > 0) || !(full > price)) return null;
  const path = txt(sub(fs, 4).find((x) => x.f === 1)?.v);
  const gallery = fs.find((x) => x.f === 9)?.v;
  const imgs = gallery instanceof Uint8Array ? urlsIn(gallery) : [];
  const sizes: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const x of fs) {
    if (x.f !== 10) continue;
    const label = txt(x.v).trim();
    if (!label || /^one ?size$/i.test(label) || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: "in_stock" });
  }
  const siblings = fs
    .filter((x) => x.f === 7 && x.v instanceof Uint8Array)
    .map((x) => num(pbDecode(x.v as Uint8Array), 3))
    .filter((n) => n > 0);
  return {
    brand: "aboutyou",
    country,
    externalId: String(id),
    name,
    url: path.startsWith("/") ? `${site}${path}` : site,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price,
    listPrice: full,
    currency,
    inStock: true,
    category: brand || null,
    gender,
    variants: sizes.length ? { colors: [], sizes } : null,
    groupKey: siblings.length > 1 ? `aboutyou:${Math.min(id, ...siblings)}` : null,
    colorName: null,
  };
}

/** A decoded GetProductStreamV2Response → its product tiles and the stream total. */
export function parseStream(msg: Uint8Array): { tiles: Uint8Array[]; total: number } {
  const fs = pbDecode(msg);
  const tiles: Uint8Array[] = [];
  for (const it of fs) {
    if (it.f !== 1 || !(it.v instanceof Uint8Array)) continue;
    const section = sub(pbDecode(it.v), 2);
    const tile = section.find((x) => x.f === 1)?.v;
    if (tile instanceof Uint8Array) tiles.push(tile);
  }
  return { tiles, total: num(sub(fs, 3), 1) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function clientVersion(m: AboutYouMarket, country: CountryCode): Promise<string> {
  const html = await getText(m.site + "/", { country }).catch(() => "");
  return html.match(/"clientVersion":"([^"]+)"/)?.[1] ?? FALLBACK_CLIENT_VERSION;
}

async function streamPage(m: AboutYouMarket, version: string, categoryId: number, offset: number): Promise<Uint8Array | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(GRPC, {
        method: "POST",
        headers: {
          "content-type": "application/grpc-web+proto",
          "x-grpc-web": "1",
          Origin: m.site,
          Referer: `${m.site}/`,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
        body: streamRequest(m, version, categoryId, offset),
      });
      if (res.ok) {
        const frame = firstDataFrame(new Uint8Array(await res.arrayBuffer()));
        if (frame) return frame;
      }
    } catch {
      /* retry once */
    }
    await sleep(2000);
  }
  return null;
}

export async function listAboutYou(country: CountryCode, maxProducts = 1500): Promise<ProductRecord[]> {
  const m = ABOUTYOU_MARKETS[country];
  if (!m) return [];
  const version = await clientVersion(m, country);
  const byId = new Map<string, ProductRecord>();
  let first = true;
  for (const s of m.sale) {
    const quota = Math.ceil(maxProducts * s.share);
    let taken = 0;
    for (let offset = 0; taken < quota && offset < quota * 1.5; offset += PAGE) {
      if (!first) await sleep(PAUSE_MS);
      const msg = await streamPage(m, version, s.categoryId, offset);
      if (!msg) {
        if (first) throw new Error(`aboutyou/${country}: product stream refused`);
        break;
      }
      first = false;
      const { tiles } = parseStream(msg);
      if (!tiles.length) break;
      for (const t of tiles) {
        let r: ProductRecord | null = null;
        try {
          r = mapTile(country, m.site, t, s.gender);
        } catch {
          r = null;
        }
        if (r && !byId.has(r.externalId)) {
          byId.set(r.externalId, r);
          taken++;
        }
      }
    }
  }
  return [...byId.values()].slice(0, maxProducts);
}

export const listProducts = (country: CountryCode): Promise<ProductRecord[]> => listAboutYou(country);
