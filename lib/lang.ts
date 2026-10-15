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
 */
export const APP_LANGS = ["tr", "en", "fr", "es", "zh"] as const;

export type AppLang = (typeof APP_LANGS)[number];

export const isAppLang = (x: unknown): x is AppLang =>
  typeof x === "string" && (APP_LANGS as readonly string[]).includes(x);

/**
 * BCP-47 tag per language, for `Intl` date names. Chinese is Simplified
 * (mainland); Spanish is Spain's tag, which every engine ships.
 */
export const LOCALE_TAG: Record<AppLang, string> = {
  tr: "tr-TR",
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES",
  zh: "zh-CN",
};

/**
 * The language for server-written copy (push text, alert emails), which only
 * exists in Turkish and English. Anyone reading neither gets English: it is the
 * closer second language for a French, Spanish or Chinese speaker than Turkish.
 */
export const serverLang = (l: unknown): "tr" | "en" => (l === "tr" || l == null ? "tr" : "en");
