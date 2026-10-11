/** Garage (garageclothing.com), Canada + US — see _groupedynamite.ts. */
import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { listGroupeDynamite } from "./_groupedynamite";

export const brand = "garage";

export function listProducts(country: CountryCode): Promise<ProductRecord[]> {
  return listGroupeDynamite("garage", country);
}
