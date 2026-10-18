/**
 * Mark's (marks.com) — Canada only. The Canadian Tire platform's search
 * gateway, banner MKS; see _ctc.ts for the route and the row rules.
 */
import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { CTC, listCtc } from "./_ctc";

export const brand = "marks";
export const listMarks = (country: CountryCode): Promise<ProductRecord[]> => listCtc(CTC.marks, country);
export const listProducts = listMarks;
