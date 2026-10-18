/**
 * Sport Chek (sportchek.ca) — Canada only. The Canadian Tire platform's search
 * gateway, banner SC; see _ctc.ts for the route and the row rules.
 */
import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { CTC, listCtc } from "./_ctc";

export const brand = "sportchek";
export const listSportChek = (country: CountryCode): Promise<ProductRecord[]> => listCtc(CTC.sportchek, country);
export const listProducts = listSportChek;
