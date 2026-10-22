/**
 * The languages the app speaks, in the order the language screen lists them.
 *
 * One list shared by the app, the API routes and the collector, so a language
 * added here is accepted everywhere at once — a push token registered as "fr"
 * must not be rejected by a route that still only knows "tr" | "en".
 *
 * Turkish is the source and the fallback everywhere: an unknown or missing
 * language resolves to it, matching what the app shipped before it was
 * multilingual.
 *
 * "zh" is Simplified Chinese, "zh-Hant" Traditional (Hong Kong, Taiwan). "nb"
 * is Norwegian Bokmål — the written Norwegian nine in ten Norwegians use, and
 * what iOS reports for a Norwegian phone. "pt" is European Portuguese.
 */
export const APP_LANGS = [
  "tr", "en", "fr", "es", "zh", "ja", "ko",
  "de", "it", "pt", "nl", "sv", "da", "nb", "fi", "ar", "zh-Hant",
] as const;

export type AppLang = (typeof APP_LANGS)[number];

export const isAppLang = (x: unknown): x is AppLang =>
  typeof x === "string" && (APP_LANGS as readonly string[]).includes(x);

/**
 * BCP-47 tag per language, for `Intl` date names and clock times. Chinese is
 * Simplified (mainland); Traditional uses Hong Kong's tag, our only market for
 * it. Spanish is Spain's tag, Portuguese Portugal's. Arabic uses the UAE's tag,
 * whose default digits are the Western ones every Gulf shop prints prices in
 * (ar-SA would switch to Arabic-Indic digits).
 */
export const LOCALE_TAG: Record<AppLang, string> = {
  tr: "tr-TR",
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES",
  zh: "zh-CN",
  ja: "ja-JP",
  ko: "ko-KR",
  de: "de-DE",
  it: "it-IT",
  pt: "pt-PT",
  nl: "nl-NL",
  sv: "sv-SE",
  da: "da-DK",
  nb: "nb-NO",
  fi: "fi-FI",
  ar: "ar-AE",
  "zh-Hant": "zh-HK",
};

/**
 * Each language's name for itself — the label on the language screen and on
 * Hesabım's language row. Never translated: it is the one label a person who
 * cannot read the current language still recognises.
 */
export const LANG_ENDONYM: Record<AppLang, string> = {
  tr: "Türkçe",
  en: "English",
  fr: "Français",
  es: "Español",
  zh: "简体中文",
  ja: "日本語",
  ko: "한국어",
  de: "Deutsch",
  it: "Italiano",
  pt: "Português",
  nl: "Nederlands",
  sv: "Svenska",
  da: "Dansk",
  nb: "Norsk bokmål",
  fi: "Suomi",
  ar: "العربية",
  "zh-Hant": "繁體中文",
};

/** The language's English name — what the assistant's model prompt asks for. */
export const LANG_NAME_EN: Record<AppLang, string> = {
  tr: "Turkish",
  en: "English",
  fr: "French",
  es: "Spanish",
  zh: "Simplified Chinese",
  ja: "Japanese",
  ko: "Korean",
  de: "German",
  it: "Italian",
  pt: "European Portuguese",
  nl: "Dutch",
  sv: "Swedish",
  da: "Danish",
  nb: "Norwegian Bokmål",
  fi: "Finnish",
  ar: "Arabic",
  "zh-Hant": "Traditional Chinese",
};

/** Written right to left. Only Arabic today. */
export const isRtl = (l: AppLang): boolean => l === "ar";

/**
 * Whether the API stores the reader's REAL language for server-written copy
 * (push text, alert emails), rather than collapsing it to "tr" | "en".
 *
 * Off until the collector that reads per-language copy (packages/collector/
 * src/i18n/server.*.ts) is synced and running: the collector before it reads
 * any language other than "en" as Turkish, so storing "fr" early would turn a
 * French reader's English pushes Turkish. Flip to true once that collector is
 * live; nothing else needs to change.
 */
export const STORE_FULL_LANG = false;

/**
 * The language to store for server-written copy. Turkish for a missing or
 * Turkish value (what every device got before languages existed). Anything
 * else is the language itself once STORE_FULL_LANG is on, English until then.
 * The collector falls back to English for whatever a language's copy file
 * does not cover.
 */
export const serverLang = (l: unknown): AppLang =>
  l === "tr" || l == null ? "tr" : STORE_FULL_LANG && isAppLang(l) ? l : "en";
