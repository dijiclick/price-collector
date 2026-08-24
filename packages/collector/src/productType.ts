/**
 * Cross-brand product-type classification.
 *
 * The table itself now lives in `lib/productTypes.ts`, because search needs the
 * same vocabulary: a query for "ceket" has to reach Boyner's "Kaban" and Koton's
 * "Yelek", and that mapping is exactly what these patterns already encode. Two
 * copies would drift, and a drifted copy means a synonym that classifies but
 * cannot be searched (or the reverse).
 *
 * This module stays as the collector's entry point so call sites and the
 * `classifyType` contract are unchanged.
 */
export {
  type ProductType,
  PRODUCT_TYPES,
  classifyType,
  fold,
} from "../../../lib/productTypes";
