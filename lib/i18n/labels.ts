import type { AppLang } from "../lang";
import type { LibLabelsPartial } from "./types";
import { tr } from "./labels.tr";
import { en } from "./labels.en";
import { fr } from "./labels.fr";
import { es } from "./labels.es";
import { zh } from "./labels.zh";
import { ja } from "./labels.ja";
import { ko } from "./labels.ko";
import { de } from "./labels.de";
import { it } from "./labels.it";
import { pt } from "./labels.pt";
import { nl } from "./labels.nl";
import { sv } from "./labels.sv";
import { da } from "./labels.da";
import { nb } from "./labels.nb";
import { fi } from "./labels.fi";
import { ar } from "./labels.ar";
import { zhHant } from "./labels.zh-Hant";

/**
 * lib/'s reader-facing labels, one file per language (labels.<lang>.ts).
 *
 * One file per language so a translator touches only their own: the shelf
 * names, colour names and assistant chips used to sit in shared tables with a
 * column per language, where adding a language meant editing every row.
 *
 * Platform-free — no imports beyond the language list — so the app, the API
 * and the collector all read it.
 */
export const LIB_LABELS: Record<AppLang, LibLabelsPartial> = {
  tr, en, fr, es, zh, ja, ko, de, it, pt, nl, sv, da, nb, fi, ar, "zh-Hant": zhHant,
};

/**
 * The first value `get` finds along the language's fallback chain: the
 * language itself, then English, then Turkish. Turkish reads only Turkish —
 * its shelf names are the taxonomy's own labels, which the caller falls back
 * to when this returns undefined.
 */
export function libLabel<T>(l: AppLang, get: (d: LibLabelsPartial) => T | undefined): T | undefined {
  const chain = l === "tr" ? [LIB_LABELS.tr] : l === "en" ? [LIB_LABELS.en, LIB_LABELS.tr] : [LIB_LABELS[l], LIB_LABELS.en, LIB_LABELS.tr];
  for (const d of chain) {
    const v = d ? get(d) : undefined;
    if (v !== undefined) return v;
  }
  return undefined;
}
