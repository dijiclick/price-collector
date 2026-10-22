/**
 * What a shop's product page says about the product (2026-10-22), for the
 * daily brand QA (run.ts). Pure: html in, facts out, so tests feed it trimmed
 * real pages.
 *
 * Prices are amount×100 for every currency, like products.current_price.
 * Every price keeps the currency the page stated next to it (null when it
 * stated none): from this box in Germany a shop often answers in another
 * currency (Princess Polly CA → USD, Showpo AU → /row/ in USD), and comparing
 * those with ours would report a mismatch that is only geography.
 */

export interface PagePrice {
  amount: number;
  currency: string | null;
}

/**
 * An AggregateOffer's low/high: the shape of a size/variant range — but only
 * when it spans more than one offer. Nahdi writes a single product's sale and
 * regular price as lowPrice/highPrice with offerCount 1 (2026-10-22).
 */
export interface PriceRange {
  low: number;
  high: number;
  currency: string | null;
  /** offerCount ≥ 2, or at least two distinct prices among its nested offers. */
  multi: boolean;
}

export interface PageFacts {
  title: string | null;
  prices: PagePrice[];
  ranges: PriceRange[];
  /** Shopify.currency.active, or the og:price:currency, for the .js prices. */
  currency: string | null;
  shopify: boolean;
}

/**
 * "1.299,00" / "1,299.00" / "629.99" / 25 / "₺1.299" → amount×100; null when
 * it is not a positive number. A lone separator followed by exactly three
 * digits is a thousands separator ("1.299" is 1299, as Turkish and German
 * pages write it); followed by one or two digits it is the decimal point.
 */
export function priceToMinor(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[^\d.,]/g, "");
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // Both: the later one is the decimal point.
    const dec = lastDot > lastComma ? "." : ",";
    const thou = dec === "." ? "," : ".";
    s = s.split(thou).join("").replace(dec, ".");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = s.split(sep);
    const tail = parts[parts.length - 1];
    s = parts.length > 2 || tail.length === 3 ? parts.join("") : parts.join(".");
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

const cur = (v: unknown): string | null =>
  typeof v === "string" && /^[a-z]{3}$/i.test(v.trim()) ? v.trim().toUpperCase() : null;

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&ndash;/g, "–").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

/** Facts from a product page's html: JSON-LD offers, og/product price meta, the title. */
export function pageFacts(html: string): PageFacts {
  const prices: PagePrice[] = [];
  const ranges: PriceRange[] = [];
  const add = (v: unknown, c: string | null) => {
    const amount = priceToMinor(v);
    if (amount !== null && !prices.some((p) => p.amount === amount && p.currency === c)) prices.push({ amount, currency: c });
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let doc: unknown;
    try {
      doc = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const walk = (o: unknown, inherited: string | null): void => {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) return o.forEach((x) => walk(x, inherited));
      const r = o as Record<string, unknown>;
      const type = String(r["@type"] ?? "");
      const c = cur(r.priceCurrency) ?? inherited;
      if (/Offer$/.test(type) || r.priceCurrency != null) {
        if (r.price != null) add(r.price, c);
        if (r.lowPrice != null) add(r.lowPrice, c);
        if (r.highPrice != null) add(r.highPrice, c);
        const low = priceToMinor(r.lowPrice);
        const high = priceToMinor(r.highPrice);
        if (type === "AggregateOffer" && low !== null && high !== null) {
          const nested = Array.isArray(r.offers) ? r.offers : [];
          const distinct = new Set(nested.map((x) => priceToMinor((x as Record<string, unknown>)?.price)).filter((x) => x !== null));
          const multi = Number(r.offerCount) >= 2 ? distinct.size !== 1 : distinct.size >= 2;
          ranges.push({ low, high, currency: c, multi });
        }
      }
      for (const v of Object.values(r)) walk(v, c);
    };
    walk(doc, null);
  }
  const meta = (names: string) =>
    [...html.matchAll(new RegExp(`<meta[^>]+(?:property|name)=["'](?:${names})["'][^>]*>`, "gi"))]
      .map((m) => m[0].match(/content=["']([^"']*)["']/i)?.[1] ?? null)
      .filter((x): x is string => x !== null);
  const ogCurrency = cur(meta("og:price:currency|product:price:currency")[0]);
  // Skechers writes a colour range here, "79.99 - 105.00": each end is a price,
  // and read as one string the digits run together (7999105.00).
  for (const v of meta("product:price:amount|og:price:amount|product:sale_price:amount"))
    for (const part of v.split(/\s+[-–]\s+/)) add(part, ogCurrency);
  const shopCur = html.match(/Shopify\.currency\s*=\s*\{[^}]*"active"\s*:\s*"([A-Za-z]{3})"/)?.[1];
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return {
    title: t ? decode(t).slice(0, 200) : null,
    prices,
    ranges,
    currency: cur(shopCur) ?? ogCurrency,
    shopify: /cdn\.shopify\.com|Shopify\.theme|Shopify\.shop\s*=/.test(html),
  };
}

/**
 * A shop's bot wall or challenge page (answered 200 as often as 403). A 200
 * counts only by its title or a SMALL page carrying a challenge script: real
 * product pages load reCAPTCHA in their head, and that must not read as a wall.
 */
export function isWallPage(status: number, html: string, title: string | null = null): boolean {
  if (status === 403 || status === 429 || status === 418 || status === 401) return true;
  if (title && /just a moment|attention required|access denied|pardon our interruption|security check|are you a robot|robot check|captcha/i.test(title)) return true;
  return html.length < 60_000 && /cf-chl|px-captcha|captcha-delivery|datadome|_Incapsula_Resource|Request unsuccessful/i.test(html);
}

/**
 * A "soft 404": the shop answers 200 with its not-found page. Judged on the
 * <title> only — a whole-body search finds "404" and "not found" in scripts
 * and translations of perfectly good pages.
 */
export function isSoft404(title: string | null): boolean {
  if (!title) return false;
  return /\b404\b|not found|page (?:not|cannot be) found|no longer available|sayfa bulunamad|bulunamadı|nicht gefunden|introuvable|no encontrad|non trovat|niet gevonden|hittades inte|ikke fundet|ei löydy/i.test(title);
}

/** A Shopify product url's .js twin (/products/<handle>.js), or null when it is not one. */
export function shopifyJsUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^(.*\/products\/[^/]+?)\/?$/);
    if (!m) return null;
    return `${u.origin}${m[1].replace(/\.js$/, "")}.js`;
  } catch {
    return null;
  }
}

export interface ShopifyFacts {
  prices: number[];
  /** True when any variant carries a compare_at_price above its price — the shop's own "was" price. */
  hasWasPrice: boolean;
}

/** Prices from a Shopify /products/<handle>.js answer (already minor units). */
export function shopifyFacts(json: unknown): ShopifyFacts | null {
  if (!json || typeof json !== "object") return null;
  const p = json as { price?: unknown; compare_at_price?: unknown; variants?: { price?: unknown; compare_at_price?: unknown; available?: unknown }[] };
  const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);
  const variants = Array.isArray(p.variants) ? p.variants : [];
  const prices = [num(p.price), ...variants.map((v) => num(v.price))].filter((x): x is number => x !== null);
  if (!prices.length) return null;
  const hasWasPrice =
    (num(p.compare_at_price) ?? 0) > (num(p.price) ?? Infinity) ||
    variants.some((v) => (num(v.compare_at_price) ?? 0) > (num(v.price) ?? Infinity));
  return { prices: [...new Set(prices)], hasWasPrice };
}
