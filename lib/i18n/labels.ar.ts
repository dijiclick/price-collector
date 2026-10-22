import type { LibLabelsPartial } from "./types";

/**
 * Arabic (Gulf: AE/SA/KW/QA; Modern Standard Arabic) labels: shelf names, colour names, assistant chips.
 *
 * Translate from labels.en.ts (same keys; its header explains them), with the
 * Turkish source names in productTypes.ts for nuance. Every key is optional:
 * anything left out shows in English. A key that does not exist in
 * labels.en.ts fails to compile.
 */
export const ar: LibLabelsPartial = {};
