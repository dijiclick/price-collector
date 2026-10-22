import { isAppLang, type AppLang } from "../../../../lib/lang";
import type { DeepPartial } from "../../../../lib/i18n/types";
import { en } from "./server.en";
import { tr } from "./server.tr";
import { fr } from "./server.fr";
import { es } from "./server.es";
import { zh } from "./server.zh";
import { ja } from "./server.ja";
import { ko } from "./server.ko";
import { de } from "./server.de";
import { it } from "./server.it";
import { pt } from "./server.pt";
import { nl } from "./server.nl";
import { sv } from "./server.sv";
import { da } from "./server.da";
import { nb } from "./server.nb";
import { fi } from "./server.fi";
import { ar } from "./server.ar";
import { zhHant } from "./server.zh-Hant";

/** The full shape of server-written copy, defined by server.en.ts. */
export type ServerCopy = typeof en;
export type ServerCopyPartial = DeepPartial<ServerCopy>;

/**
 * Server-written copy, one file per language (server.<lang>.ts), so each
 * language's pushes and emails are a file its translator owns.
 */
const COPY: Record<AppLang, ServerCopyPartial> = {
  tr, en, fr, es, zh, ja, ko, de, it, pt, nl, sv, da, nb, fi, ar, "zh-Hant": zhHant,
};

const isBranch = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** `over` laid onto `base` at every depth; functions and arrays replace whole. */
function merge<T>(base: T, over: unknown): T {
  if (!isBranch(over) || !isBranch(base)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = isBranch(v) && isBranch(out[k]) ? merge(out[k], v) : v;
  }
  return out as T;
}

const cache = new Map<AppLang, ServerCopy>();

/**
 * The language a stored value (push_devices.lang / subscribers.lang) is read
 * as. Missing is Turkish — every device that synced before languages existed
 * was getting Turkish, and still does. A value this build does not know is
 * English.
 */
export const copyLang = (lang: string | null | undefined): AppLang =>
  lang == null || lang === "tr" ? "tr" : isAppLang(lang) ? lang : "en";

/**
 * The copy for a stored language: that language's file over English. Turkish
 * is complete on its own and never mixes in English.
 */
export function serverCopy(lang: string | null | undefined): ServerCopy {
  const l = copyLang(lang);
  if (l === "tr") return tr;
  if (l === "en") return en;
  let hit = cache.get(l);
  if (!hit) cache.set(l, (hit = merge(en, COPY[l])));
  return hit;
}

/** For tests: every language's own (unmerged) file. */
export const SERVER_COPY_FILES = COPY;
