import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
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
  // tr_tr and en_gb use "yellowPrice", en_us/de_at "redPrice" — so take the
  // cheapest entry instead of matching a name: the sale row is whichever
  // undercuts the white price.
  const current = prices.reduce(
    (lo: number, x) => (x.price < lo ? x.price : lo),
    original as number,
  );
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
  let checked = false;
  for (const cat of CATS) {
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
        const rec = mapProduct(p, cat.split("_")[0], country);
        if (rec) byId.set(rec.externalId, rec);
      }
      if (page >= (data?.pagination?.totalPages ?? 1)) break;
    }
  }
  return [...byId.values()];
}
