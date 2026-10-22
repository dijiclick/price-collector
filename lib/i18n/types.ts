import type { en } from "./labels.en";

/**
 * Every key optional, at every depth — the type of a language file that may be
 * incomplete. Functions and arrays are leaves: a translated helper is replaced
 * whole, never merged, and so is a list of month names.
 *
 * A key the source does not have is still an error (excess-property checking
 * applies at every depth of an object literal), which is the point: missing
 * means "falls back", misspelt means "never shows".
 */
export type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly unknown[]
    ? T
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

/** The full shape of lib/'s reader-facing labels, defined by labels.en.ts. */
export type LibLabels = typeof en;
export type LibLabelsPartial = DeepPartial<LibLabels>;
