import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor, blanketPromotionPct, revertBlanketPromotion } from "../normalize";
import { currencyFor, type CountryCode } from "../../../../lib/countries";

/**
 * The api.hm.com locale per market. English wherever the API accepts one,
 * because `lib/productTypes.ts` classifies Turkish and English only.
 *
 * Probed 2026-09-23: `en_{cc}` answers 422 "validlocale" for every EU market
 * except IE (en_de, en_fr, en_nl, en_es, en_it, en_at, en_ch, en_be, en_pt,
 * en_fi, en_se, en_dk, en_no), and nb_no is 422 too — so those markets are
 * collected in the local language and their names classify worse. BE and CH
 * are multilingual: nl_be (majority language; fr_be also answers) and de_ch
 * (fr_ch / it_ch also answer, same catalogue).
 *
 * AE and SA are absent on purpose: `en_ae`/`en_sa` are 422 — Gulf H&M is
 * Alshaya's own platform (ae.hm.com), not this API. lib/brands.ts never
 * schedules H&M there.
 */
export const LOCALES: Partial<Record<CountryCode, string>> = {
  TR: "tr_tr",
  GB: "en_gb",
  US: "en_us",
  CA: "en_ca",
  AU: "en_au",
  IE: "en_ie",
  DE: "de_de",
  FR: "fr_fr",
  NL: "nl_nl",
  BE: "nl_be",
  AT: "de_at",
  ES: "es_es",
  IT: "it_it",
  PT: "pt_pt",
  FI: "fi_fi",
  CH: "de_ch",
  SE: "sv_se",
  DK: "da_dk",
  NO: "no_no",
};

export function localeFor(country: CountryCode): string {
  const locale = LOCALES[country];
  if (!locale) throw new Error(`hm: no api.hm.com locale for ${country} (Gulf H&M is a different platform)`);
  return locale;
}

const CATS = ["ladies_all", "men_all", "kids_all", "home_all"];
// The crawl root is the section: it maps 1:1 to a gender (home carries none).
const ROOT_GENDER: Record<string, ProductRecord["gender"]> = {
  ladies: "kadin",
  men: "erkek",
  kids: "cocuk",
};

/**
 * Parse an H&M `formattedPrice` into integer minor units and the currency mark
 * it is printed with. Every market formats differently:
 *
 *   £17.99   $1,299.00   €12.99        dot decimal, symbol first
 *   12,99 €  € 10,99     € 12,99  comma decimal, either side
 *   CHF 11.95            1.099,00 TL   149,00 kr.    149,00 kr.
 *
 * The decimal separator is the LAST `,` or `.` when 1–2 digits follow it; any
 * other `,` `.` `'` or space is grouping. H&M prices always carry cents, so a
 * last separator followed by three digits ("1.099 TL") is grouping.
 */
export function parseFormattedPrice(s: unknown): { minor: number; mark: string } | null {
  if (typeof s !== "string") return null;
  const mark = s.replace(/[\d.,'’\s  ]/g, "");
  // Trim separators at the ends: the Nordic "kr." abbreviation leaves a dot.
  const num = s.replace(/[^\d.,]/g, "").replace(/^[.,]+|[.,]+$/g, "");
  if (!/\d/.test(num)) return null;
  const m = /[.,](\d{1,2})$/.exec(num);
  const intPart = (m ? num.slice(0, m.index) : num).replace(/[.,]/g, "");
  const frac = m ? m[1].padEnd(2, "0") : "00";
  if (!/^\d+$/.test(intPart)) return null;
  return { minor: Number(intPart) * 100 + Number(frac), mark };
}

/** Which currency marks H&M prints for each ISO code we collect in. */
const MARKS: Record<string, string[]> = {
  TRY: ["TL", "₺"],
  GBP: ["£"],
  USD: ["$", "US$"],
  CAD: ["$", "CA$", "C$"],
  AUD: ["$", "A$", "AU$"],
  EUR: ["€"],
  CHF: ["CHF"],
  SEK: ["kr", "SEK"],
  DKK: ["kr", "DKK"],
  NOK: ["kr", "NOK"],
};

/** True when a printed mark is compatible with the currency we will store. */
export function markMatches(mark: string, currency: string): boolean {
  return (MARKS[currency] ?? [currency]).includes(mark);
}

/** The priceType rows H&M uses for a reduced price. Anything else is ignored. */
const REDUCED = new Set(["redPrice", "yellowPrice"]);

export function mapProduct(
  p: any,
  category: string | null,
  country: CountryCode = "TR",
): ProductRecord | null {
  const id = String(p.id ?? "");
  if (!id) return null;
  // `price` is a number in every market probed (the float behind the
  // formattedPrice string). Fall back to parsing the string only if a market
  // ever ships a row without it.
  const prices: { priceType?: string; price: number }[] = (p.prices ?? [])
    .map((x: any) => {
      if (typeof x?.price === "number") return x;
      const parsed = parseFormattedPrice(x?.formattedPrice);
      return parsed ? { ...x, price: parsed.minor / 100 } : null;
    })
    .filter(Boolean);
  const original = prices.find((x) => x.priceType === "whitePrice")?.price ?? prices[0]?.price;
  // H&M colour-codes the reduced price and the colour differs by market —
  // tr_tr and en_gb have used "yellowPrice", en_us/de_at "redPrice" — so take
  // the cheapest of THOSE. Only the two known reduced-price rows: an unknown
  // priceType (a member or club price under a new name) must not become the
  // sale price just because it is the smallest number in the array.
  //
  // Even redPrice is not proof of a markdown: H&M prints its members-only,
  // multi-buy campaigns in the same row. That is caught per department in
  // `revertBlanketPromotions` below, not here, because one product alone
  // cannot tell the two apart.
  const current = prices
    .filter((x) => REDUCED.has(x.priceType ?? ""))
    .reduce((lo: number, x) => (x.price < lo ? x.price : lo), original as number);
  if (typeof current !== "number" || current <= 0) return null;
  return {
    brand: "hm",
    country,
    externalId: id,
    name: p.productName ?? "",
    // The API's url is already the market's own PDP (`/en_gb/productpage.…`).
    url: `https://www2.hm.com${p.url ?? `/${localeFor(country)}/productpage.${id}.html`}`,
    imageUrl: p.productImage ?? p.images?.[0]?.url ?? null,
    price: toMinor(current),
    listPrice: typeof original === "number" && original > current ? toMinor(original) : null,
    currency: currencyFor(country),
    inStock: p.availability?.stockState === "Available",
    category,
    gender: (category && ROOT_GENDER[category]) || null,
  };
}

/**
 * The listing carries no ISO code, only a printed mark, so the currency comes
 * from lib/countries. This is the check that the locale really is that market:
 * a present, parseable mark that does not fit the country's currency means the
 * API served another store, and storing its numbers would be wrong prices in the
 * wrong currency — so fail the run rather than write them.
 */
export function assertCurrency(list: any[], country: CountryCode): void {
  const currency = currencyFor(country);
  for (const p of list) {
    for (const x of p?.prices ?? []) {
      const parsed = parseFormattedPrice(x?.formattedPrice);
      if (parsed && !markMatches(parsed.mark, currency)) {
        throw new Error(
          `hm: ${localeFor(country)} printed "${x.formattedPrice}", which is not ${currency}`,
        );
      }
    }
  }
}

export const brand = "hm";

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  const api = `https://api.hm.com/search-services/v1/${localeFor(country)}/listing/resultpage`;
  // pageSize is locked at 72 — anything larger is a 422 — and a pool is NOT
  // worth it here: at concurrency 8 the API starts returning 403s.
  //
  // The cap was 150, sized when the roots ran 138/34/50/18 pages. Ladies alone
  // now reports 416, so the crawl was stopping at 36% of the women's catalogue
  // and silently. The loop already exits on `page >= totalPages`, so this cap is
  // only a runaway guard: set it above the real page count and let the API say
  // when it is done.
  const maxPages = Number(process.env.HM_MAX_PAGES ?? 500);
  const byId = new Map<string, ProductRecord>();
  const byRoot = new Map<string, Set<string>>();
  let checked = false;
  for (const cat of CATS) {
    const root = cat.split("_")[0];
    const ids = byRoot.get(root) ?? new Set<string>();
    byRoot.set(root, ids);
    for (let page = 1; page <= maxPages; page++) {
      const url =
        `${api}?page=${page}&pageSize=72&touchPoint=Desktop&categoryId=${cat}&pageId=/${cat.split("_")[0]}`;
      const data = await getJson<any>(url, { country }).catch(() => null);
      const list: any[] = data?.plpList?.productList ?? [];
      if (list.length === 0) break;
      if (!checked) {
        assertCurrency(list, country);
        checked = true;
      }
      for (const p of list) {
        const rec = mapProduct(p, root, country);
        if (!rec) continue;
        byId.set(rec.externalId, rec);
        ids.add(rec.externalId);
      }
      if (page >= (data?.pagination?.totalPages ?? 1)) break;
    }
  }
  const departments = [...byRoot.values()].map((ids) =>
    [...ids].map((id) => byId.get(id)!).filter(Boolean),
  );
  const reverted = revertBlanketPromotions(departments);
  if (reverted > 0) {
    console.warn(`hm ${country}: ${reverted} products at a blanket member/multi-buy % — kept at full price`);
  }
  return [...byId.values()];
}

/**
 * H&M runs members-only, conditional campaigns — "−20% for members when you buy
 * two" (FI/SE/NL/AT, 2026-09-23→25), "−25% on womenswear for members over 50 €"
 * (DE) — and the listing API prints them in the SAME `redPrice` row as a real
 * markdown. There is no flag that separates them; the campaign shows up only in
 * a site-wide banner. A guest cart charged 59,99 € for the FI skirt the listing
 * put at 48,00 €. Reading those rows as sales told the app 28k of 29k Finnish
 * products were 20% off.
 *
 * So the footprint decides: a department where one exact percent covers a large
 * share of EVERY product is running a blanket promotion (see
 * `blanketPromotionPct`), and those products are stored at full price. The
 * campaigns exclude sale items, so a real markdown at another percent survives.
 *
 * Each department is judged on its own, because DE ran its campaign on
 * womenswear only; a product listed in two departments is reverted if either
 * one is a blanket at that product's percent. Percents are all decided before
 * anything is reverted, so the order of departments cannot matter.
 */
export function revertBlanketPromotions(
  departments: { price: number; listPrice: number | null }[][],
): number {
  const found = departments
    .map((recs) => ({ recs, pct: blanketPromotionPct(recs) }))
    .filter((d): d is { recs: typeof d.recs; pct: number } => d.pct != null);
  let n = 0;
  for (const { recs, pct } of found) n += revertBlanketPromotion(recs, pct);
  return n;
}
