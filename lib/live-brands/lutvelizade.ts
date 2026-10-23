/**
 * Lutvelizade by url (`lutvelizade.com.tr/dugumlu-parmak-arasi-sari-kadin-sandalet-modelleri-p`).
 * The collector reads the category grids (packages/collector/src/brands/lutvelizade.ts);
 * a single product is read from its own page, whose head block carries the
 * same fields: `ÜRÜN KODU` (the grid's `data-ga4-id`, so the same id), the
 * price as `<span class="price">` or `price invalid` (struck) + `price
 * discounted` (charged), and the size list with `class="disable"` on sold-out
 * sizes. A product that is gone 301s to the home page.
 *
 * Direct egress only: Turkish shops never go through the proxy (owner rule).
 */
import type { LiveProduct } from "../live-lookup";
import { UA, toMinor } from "../live-http";

const SITE = "https://www.lutvelizade.com.tr";

export function lutvelizadePathFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (!/(^|\.)lutvelizade\.com(\.tr)?$/.test(host)) return null;
  if (!/^\/[a-z0-9-]+-p\/?$/i.test(u.pathname)) return null;
  return u.pathname.replace(/\/$/, "");
}

const decode = (s: string) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ");

const tl = (s: string | undefined): number | null => {
  if (!s) return null;
  const n = Number(s.replace(/[^\d,.]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? toMinor(n) : null;
};

/** Read the product page's head block. Pure. */
export function parseLutvelizadePage(html: string, url: string): LiveProduct | null {
  const start = html.indexOf("<h1");
  if (start < 0) return null;
  const head = html.slice(start, html.indexOf('class="row mt-4"', start) > 0 ? html.indexOf('class="row mt-4"', start) : start + 20000);
  const name = head.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1];
  const code = head.match(/class="product-code">[^<]*<span>([^<]+)<\/span>/)?.[1]?.trim();
  const was = tl(head.match(/class="price invalid">([^<]+)</)?.[1]);
  const now = tl(head.match(/class="price discounted">([^<]+)</)?.[1] ?? head.match(/class="price">([^<]+)</)?.[1]);
  if (!name || !code || now == null) return null;
  const sizes = [...(head.match(/class="variation size"[\s\S]*?<ul>([\s\S]*?)<\/ul>/)?.[1] ?? "").matchAll(/<a ([^>]*)>([^<]*)<\/a>/g)];
  const colour = head.match(/class="variation color">[\s\S]*?<span class="d-inline">([^<]+)</)?.[1];
  const image = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? null;
  return {
    brand: "lutvelizade",
    externalId: code,
    name: decode(name).replace(/\s+/g, " ").trim(),
    url,
    imageUrl: image,
    price: now,
    listPrice: was != null && was > now ? was : null,
    // No size list (rare) reads as in stock: a gone product never renders this page.
    inStock: sizes.length ? sizes.some((m) => !/class="[^"]*\bdisable\b/.test(m[1])) : true,
    category: null,
    type: null,
    gender: "kadin",
    colorName: colour ? decode(colour).trim() : null,
    country: "TR",
    currency: "TRY",
  };
}

export async function lutvelizadeUrl(url: string): Promise<LiveProduct | null> {
  const path = lutvelizadePathFromUrl(url);
  if (!path) return null;
  const target = `${SITE}${path}`;
  try {
    const r = await fetch(target, {
      headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "tr-TR,tr;q=0.9" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      redirect: "manual",
    });
    // A product that is gone answers 301 → "/".
    if (r.status !== 200) {
      if (r.status >= 400) console.warn(`live-lookup: www.lutvelizade.com.tr refused with HTTP ${r.status} (direct egress)`);
      return null;
    }
    return parseLutvelizadePage(await r.text(), target);
  } catch (err) {
    console.warn(`live-lookup: www.lutvelizade.com.tr unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
