/** Dynamite (dynamiteclothing.com), Canada + US — see _groupedynamite.ts. */
import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { listGroupeDynamite } from "./_groupedynamite";

export const brand = "dynamite";

export function listProducts(country: CountryCode): Promise<ProductRecord[]> {
  return listGroupeDynamite("dynamite", country);
}
