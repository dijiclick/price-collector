import type { ServerCopyPartial } from "./server";

/**
 * Korean server copy: pushes and alert emails. Translate from server.en.ts (same
 * keys; amounts and percentages arrive formatted), with server.tr.ts for the
 * voice. Every key is optional — anything left out is sent in English — and a
 * key server.en.ts does not have fails to compile.
 */
export const ko: ServerCopyPartial = {};
