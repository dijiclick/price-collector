/**
 * The storefront grid endpoint of an SFCC (SFRA) site, asked the way the
 * brand's own app asks it.
 *
 * Ann Taylor, LOFT and Lane Bryant run PerimeterX inside the SFCC controller
 * layer: a browser User-Agent from a datacenter IP is answered with a 302 to
 * `/px?url=…` (a 200 "access denied" page once followed), and PacSun's
 * Cloudflare answers 403 the same way. An app User-Agent (`okhttp/4.12.0`) is
 * passed straight through — the same trick that works on New Look, Topshop and
 * COS (docs/collector-unblock-playbook.md §2). Measured 2026-10-18 from a
 * GitHub runner and from the Hetzner box: 200 with real tiles for all four.
 *
 * Redirects are NOT followed: a redirect here is always the wall (or a
 * category that moved), never data, and following it would hand the parser a
 * full HTML page that looks like "zero tiles".
 */
export const APP_UA = "okhttp/4.12.0";

/** GET one grid page. Throws on a wall (non-200 or a redirect), so a refused run keeps its stored rows. */
export async function okGrid(url: string): Promise<string> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": APP_UA,
          "X-Requested-With": "XMLHttpRequest",
          Accept: "text/html, */*; q=0.01",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(45_000),
      });
      if (res.status !== 200) throw new Error(`HTTP ${res.status} for ${url}${res.headers.get("location") ? ` → ${res.headers.get("location")!.slice(0, 40)}` : ""}`);
      const html = await res.text();
      // The PX block page is a whole document; a grid fragment never is.
      if (/^\s*<!DOCTYPE html/i.test(html.slice(0, 200))) throw new Error(`wall page (full document) for ${url}`);
      return html;
    } catch (e) {
      last = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw last;
}

/** Split a grid fragment into tiles at every match of `start` (a regex with no capture groups). */
export function splitTiles(html: string, start: RegExp): string[] {
  const idx: number[] = [];
  const re = new RegExp(start.source, start.flags.includes("g") ? start.flags : start.flags + "g");
  for (const m of html.matchAll(re)) idx.push(m.index!);
  return idx.map((a, i) => html.slice(a, idx[i + 1] ?? html.length));
}

/** "1,299.00" / " $54.95 " → 1299 / 54.95; NaN when there is no number. */
export function dollars(v: unknown): number {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
