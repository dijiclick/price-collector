/**
 * Small helpers for SFCC (SFRA) storefronts whose product grid is server-rendered
 * HTML with the tile's data in a JSON attribute — Whistles/Hobbs/Phase Eight
 * (`data-tracking`), Monsoon/Accessorize (`data-component-analytics`), Space NK
 * (`data-snk-e-cxt`). Pure string work; no DOM parser needed.
 */

const NAMED: Record<string, string> = {
  amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", pound: "£", euro: "€",
  eacute: "é", egrave: "è", ecirc: "ê", aacute: "á", agrave: "à", oacute: "ó", uacute: "ú",
  iacute: "í", ntilde: "ñ", ccedil: "ç", ouml: "ö", uuml: "ü", auml: "ä", reg: "®", trade: "™",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Every value of a double- or single-quoted attribute, decoded, in document order. */
export function attrValues(html: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\s${name.replace(/[-]/g, "\\-")}=(?:"([^"]*)"|'([^']*)')`, "g");
  for (const m of html.matchAll(re)) out.push(decodeEntities(m[1] ?? m[2] ?? ""));
  return out;
}

/** Parse a JSON attribute value, or null. */
export function jsonOf<T = any>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** The opening tag (`<div ...>`) that carries the attribute at `index`. */
export function tagAround(html: string, index: number): string {
  const a = html.lastIndexOf("<", index);
  const b = html.indexOf(">", index);
  return a >= 0 && b > a ? html.slice(a, b + 1) : "";
}

/** One attribute of a single tag string, decoded. */
export function attrOf(tag: string, name: string): string | null {
  return attrValues(tag, name)[0] ?? null;
}

/** "£1,299.00" / "89" / 89 → 1299 / 89. */
export function poundsOf(v: unknown): number {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * SFCC builds a catalogue image URL with a `default/dw<hash>/` segment when the
 * file exists, and falls back to `<locale>/v<timestamp>/` when it does not —
 * a URL that is always a 404 (`{"error":"not found"}` from the image service).
 * Measured 2026-10-21: all 8 Phase Eight rows on that path 404, 0 of 1,489 on
 * `default/dw…` did; Space NK's one such row 404s too.
 */
export const sfccMissingImage = (u: string): boolean =>
  /\/demandware\.static\/-\/Sites-[^/]+\/[a-z]{2}(?:_[A-Z]{2})?\/v\d+\//.test(u);
