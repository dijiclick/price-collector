/**
 * GLOBAL WORK (Adastria, Japan) through the `.st` (dot st) shopping APP's own
 * API — not the website (2026-10-21).
 *
 * www.dot-st.com is Akamai geo-walled (403 to a GitHub runner, to the Hetzner
 * box and to a browser UA from abroad). The Android app (jp.point.android.
 * dailystyling, decompiled with jadx) talks to an AWS API Gateway,
 * `31vhpp15qh.execute-api.ap-northeast-1.amazonaws.com/prod`, with
 * `AWS_IAM` auth: requests are SigV4-signed with the GUEST credentials of the
 * app's public Cognito identity pool (res/raw/amplifyconfiguration.json) —
 * exactly what the app does before anyone logs in. No account, no secret: the
 * pool id ships in every copy of the app.
 *
 * - LISTING: `POST /items` {brandCodes:["0000100002"], itemTypeCodes:["2"]}
 *   (item type 2 = セール), 100 a page, ~1,350 rows. Each row has the current
 *   price and a `discountRate`, but NOT the original price.
 * - ORIGINAL PRICE + STOCK: `GET /items/<code>/skus` — per colour/size
 *   `price`, `originalPrice` (the shop's own) and `stockMark`/`saleStatus`.
 *   One call per product, so a run covers the first DETAIL_LIMIT reduced
 *   products (newest first, the API's default order) and ships only those:
 *   a row is never shipped with a "was" price we computed from a percentage.
 */
import { createHash, createHmac } from "node:crypto";
import type { ProductRecord, SizeVariant } from "../types";
import { cleanGallery } from "../types";
import { jaCategory } from "./_ja-category";

export const brand = "globalwork";

/**
 * Other brands on the same `.st` mall (2026-10-21): Adastria's own labels and
 * partner brands that sell officially through `.st`. Same API, same rules —
 * only the `brandCodes` filter and the dot-st.com path change. `dir` is the
 * brand's path on www.dot-st.com (also its image folder). `gender` only for
 * single-gender labels; mixed labels stay unknown.
 */
export interface DotStBrand {
  code: string;
  dir: string;
  gender?: ProductRecord["gender"];
  /**
   * Lifestyle labels that also sell home goods (lamps, mugs, towels): only
   * rows whose name jaCategory() can type as clothing/shoes/bags/accessories
   * are fetched and shipped. The listing carries no category of its own.
   */
  typedOnly?: true;
}
export const DOTST_BRANDS: Record<string, DotStBrand> = {
  globalwork: { code: "0000100002", dir: "globalwork" },
  nikoand: { code: "0000100016", dir: "nikoand" },
  lowrysfarm: { code: "0000100001", dir: "lowrysfarm", gender: "kadin" },
  studioclip: { code: "0000100017", dir: "studioclip", typedOnly: true },
  nanouniverse: { code: "0000100196", dir: "nanouniverse" },
  lepsim: { code: "0000100004", dir: "lepsim", gender: "kadin" },
  bayflow: { code: "0000100021", dir: "bayflow" },
  jeanasis: { code: "0000100003", dir: "jeanasis", gender: "kadin" },
  rageblue: { code: "0000100007", dir: "rageblue", gender: "erkek" },
  heather: { code: "0000100005", dir: "heather", gender: "kadin" },
  apartbylowrys: { code: "0000100006", dir: "apartbylowrys", gender: "kadin" },
  lakole: { code: "0000100026", dir: "lakole", typedOnly: true },
  azulbymoussy: { code: "0000100213", dir: "azulbymoussy" },
};
const REGION = "ap-northeast-1";
const POOL = "ap-northeast-1:3fca15e9-40b0-4b17-b508-7b68fa488fce";
const HOST = "31vhpp15qh.execute-api.ap-northeast-1.amazonaws.com";
const PER_PAGE = 100;
const MAX_PAGES = 20;
const DETAIL_LIMIT = Number(process.env.GLOBALWORK_DETAIL_LIMIT ?? 70);
const SITE = "https://www.dot-st.com";

interface Creds { AccessKeyId: string; SecretKey: string; SessionToken: string }

async function cognito(target: string, body: object): Promise<any> {
  const res = await fetch(`https://cognito-identity.${REGION}.amazonaws.com/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": `AWSCognitoIdentityService.${target}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`globalwork: cognito ${target} HTTP ${res.status}`);
  return res.json();
}

/** Guest credentials from the app's public identity pool. */
async function guestCreds(): Promise<Creds> {
  const { IdentityId } = await cognito("GetId", { IdentityPoolId: POOL });
  const { Credentials } = await cognito("GetCredentialsForIdentity", { IdentityId });
  if (!Credentials?.AccessKeyId) throw new Error("globalwork: no guest credentials");
  return Credentials;
}

const sha256 = (d: string) => createHash("sha256").update(d).digest("hex");
const hmac = (k: string | Buffer, d: string) => createHmac("sha256", k).update(d).digest();

/** SigV4 headers for one execute-api request. Pure given `now`. Exported for its test. */
export function signRequest(
  c: Creds, method: string, path: string, query: string, body: string, now: Date,
): Record<string, string> {
  const t = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = t.slice(0, 8);
  const headers: Record<string, string> = {
    host: HOST,
    "x-amz-date": t,
    "x-amz-security-token": c.SessionToken,
    ...(body ? { "content-type": "application/json" } : {}),
  };
  const keys = Object.keys(headers).sort();
  const canonical = [method, `/prod${path}`, query, keys.map((k) => `${k}:${headers[k]}\n`).join(""), keys.join(";"), sha256(body)].join("\n");
  const scope = `${day}/${REGION}/execute-api/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", t, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${c.SecretKey}`, day), REGION), "execute-api"), "aws4_request");
  const sig = createHmac("sha256", key).update(toSign).digest("hex");
  return { ...headers, Authorization: `AWS4-HMAC-SHA256 Credential=${c.AccessKeyId}/${scope}, SignedHeaders=${keys.join(";")}, Signature=${sig}` };
}

async function api(c: Creds, method: string, path: string, query = "", body = ""): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const headers = signRequest(c, method, path, query, body, new Date());
    const res = await fetch(`https://${HOST}/prod${path}${query ? `?${query}` : ""}`, {
      method,
      headers: { ...headers, "User-Agent": "okhttp/4.12.0", Accept: "application/json" },
      body: body || undefined,
      signal: AbortSignal.timeout(20_000),
    }).catch((e) => e as Error);
    if (!(res instanceof Error) && res.ok) return res.json();
    if (attempt >= 2) throw new Error(`globalwork: ${method} ${path} ${res instanceof Error ? res.message : `HTTP ${res.status}`}`);
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
}

export interface ListingRow { code: string; name: string; images?: string[]; colorCode?: string; price: number; discountRate: number }

/**
 * One product from its listing row + its `/skus` answer. Pure. Null unless the
 * shop's own `originalPrice` is above the price of the colour the card shows.
 */
export function mapItem(row: ListingRow, skus: any, slug = brand): ProductRecord | null {
  const b = DOTST_BRANDS[slug];
  if (!b) return null;
  const list: any[] = Array.isArray(skus?.skus) ? skus.skus : [];
  if (!row?.code || !row?.name || list.length === 0) return null;
  // Secret (member) sale prices are not public markdowns.
  const pub = list.filter((s) => s?.secretSalePrice == null);
  const colour = row.colorCode ?? pub.find((s) => s?.isDefault)?.colorCode ?? pub[0]?.colorCode;
  const own = pub.filter((s) => s?.colorCode === colour);
  const rows = own.length ? own : pub;
  const reduced = rows.filter((s) => Number(s?.originalPrice) > Number(s?.price) && Number(s?.price) > 0);
  if (!reduced.length) return null;
  const price = Math.min(...reduced.map((s) => Number(s.price)));
  const was = Math.max(...reduced.filter((s) => Number(s.price) === price).map((s) => Number(s.originalPrice)));
  const sizes: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const s of rows) {
    const label = String(s?.sizeName ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const orderable = s?.isPossibleOrderItem === true && s?.stockMark !== "×";
    sizes.push({ label, availability: !orderable ? "out_of_stock" : s?.stockMark === "△" ? "low_on_stock" : "in_stock" });
  }
  const colorName = rows[0]?.colorName ? String(rows[0].colorName).trim() : null;
  const img = row.images?.[0] ?? null;
  return {
    brand: slug,
    country: "JP",
    externalId: colour ? `${row.code}-${colour}` : row.code,
    name: String(row.name).trim(),
    url: `${SITE}/${b.dir}/disp/item/${row.code}/`,
    imageUrl: img,
    images: cleanGallery(row.images ?? [], img),
    price: price * 100,
    listPrice: was * 100,
    currency: "JPY",
    inStock: sizes.some((s) => s.availability !== "out_of_stock"),
    category: jaCategory(row.name),
    // The feed's genre filter lists most rows under both women and men
    // (unisex lines), so gender is left unknown rather than guessed —
    // except for a single-gender label (DOTST_BRANDS).
    gender: b.gender ?? null,
    variants: sizes.length ? { colors: colorName ? [colorName] : [], sizes } : null,
    groupKey: `${slug}:${row.code}`,
    colorName,
  };
}

export async function listProducts(): Promise<ProductRecord[]> {
  return listDotSt(brand);
}

/** One `.st` brand's reduced items (Japan only). */
export async function listDotSt(slug: string): Promise<ProductRecord[]> {
  const b = DOTST_BRANDS[slug];
  if (!b) throw new Error(`dot-st: unknown brand ${slug}`);
  const tag = slug === brand ? brand : `dot-st/${slug}`;
  const wanted = (r: ListingRow) => r.discountRate > 0 && (!b.typedOnly || jaCategory(r.name) != null);
  const c = await guestCreds();
  const rows: ListingRow[] = [];
  let total = Infinity;
  for (let page = 1; rows.length < total && page <= MAX_PAGES; page++) {
    const body = JSON.stringify({ brandCodes: [b.code], categoryCodes: [], itemTypeCodes: ["2"], page, perPage: PER_PAGE });
    const data = await api(c, "POST", "/items", "", body);
    total = Number(data?.count ?? 0);
    const got: ListingRow[] = data?.results ?? [];
    if (!got.length) break;
    rows.push(...got);
    // Only the first DETAIL_LIMIT reduced rows get a detail call; stop paging once we have them.
    if (rows.filter(wanted).length >= DETAIL_LIMIT) break;
  }
  if (!rows.length) throw new Error(`${tag}: empty sale listing`);
  const todo = rows.filter(wanted).slice(0, DETAIL_LIMIT);
  const out: ProductRecord[] = [];
  let failed = 0;
  for (let i = 0; i < todo.length; i += 4) {
    const batch = todo.slice(i, i + 4);
    await Promise.all(batch.map(async (r) => {
      const skus = await api(c, "GET", `/items/${r.code}/skus`, "isGetOlderItem=false").catch(() => null);
      if (!skus) { failed++; return; }
      const rec = mapItem(r, skus, slug);
      if (rec) out.push(rec);
    }));
    await new Promise((res) => setTimeout(res, 250));
  }
  if (failed > todo.length * 0.1) throw new Error(`${tag}: ${failed} of ${todo.length} detail calls failed`);
  return [...out.filter((r) => r.inStock), ...out.filter((r) => !r.inStock)];
}
