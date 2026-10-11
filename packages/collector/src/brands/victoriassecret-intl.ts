/**
 * Victoria's Secret in the UAE and Saudi Arabia (Alshaya franchise:
 * victoriassecret.ae, victoriassecret.com.sa). Turkey stays in
 * victoriassecret.ts; the Gulf shops run on the shared Alshaya/Algolia
 * platform — see _alshaya.ts.
 */
import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { listAlshaya } from "./_alshaya";

export const brand = "victoriassecret";

export function listProducts(country: CountryCode): Promise<ProductRecord[]> {
  return listAlshaya("victoriassecret", country);
}
