import type { BrandAdapter } from "./types";
import { DEFAULT_COUNTRY, isCountry, type CountryCode } from "../../../lib/countries";
import { brandServes } from "../../../lib/brands";
import * as zara from "./brands/zara";
import * as guess from "./brands/guess";
import * as penti from "./brands/penti";
import * as sephora from "./brands/sephora";
import * as hm from "./brands/hm";
import * as gratis from "./brands/gratis";
import * as mango from "./brands/mango";
import * as watsons from "./brands/watsons";
import * as pandora from "./brands/pandora";
import * as massimodutti from "./brands/massimodutti";
import * as pullandbear from "./brands/pullandbear";
import * as stradivarius from "./brands/stradivarius";
import * as oysho from "./brands/oysho";
import * as koton from "./brands/koton";
import * as rossmann from "./brands/rossmann";
import * as bershka from "./brands/bershka";
import * as boyner from "./brands/boyner";
import * as beymen from "./brands/beymen";

/**
 * Registered brand adapters. A per-brand timeout in the collector caps any slow adapter.
 * Bershka is best-effort (its SPA yields no ids without a browser cookie) — it returns
 * 0 gracefully until the cookie step lands, so it never stalls the run.
 */
/**
 * Every adapter, as it collects Turkey today.
 *
 * `country: "TR"` is explicit on all of them rather than left to the default:
 * this list is where a reader looks to see what runs, and "the collector sweeps
 * Turkey" should be readable here rather than inferred from a `??` in
 * `collectBrand`. Other markets are not entries here — `marketAdapters()` builds
 * adapters × countries, so a brand never has to be listed once per country.
 */
export const adapters: BrandAdapter[] = [
  { brand: zara.brand, country: "TR", listProducts: zara.listProducts },
  { brand: guess.brand, country: "TR", listProducts: guess.listProducts },
  { brand: penti.brand, country: "TR", listProducts: penti.listProducts },
  { brand: sephora.brand, country: "TR", listProducts: sephora.listProducts },
  { brand: hm.brand, country: "TR", listProducts: hm.listProducts },
  { brand: gratis.brand, country: "TR", listProducts: gratis.listProducts },
  { brand: mango.brand, country: "TR", listProducts: mango.listProducts },
  { brand: watsons.brand, country: "TR", listProducts: watsons.listProducts },
  { brand: pandora.brand, country: "TR", listProducts: pandora.listProducts },
  { brand: massimodutti.brand, country: "TR", listProducts: massimodutti.listProducts },
  { brand: pullandbear.brand, country: "TR", listProducts: pullandbear.listProducts },
  { brand: stradivarius.brand, country: "TR", listProducts: stradivarius.listProducts },
  { brand: oysho.brand, country: "TR", listProducts: oysho.listProducts },
  { brand: koton.brand, country: "TR", listProducts: koton.listProducts },
  { brand: rossmann.brand, country: "TR", listProducts: rossmann.listProducts },
  { brand: bershka.brand, country: "TR", listProducts: bershka.listProducts },
  { brand: boyner.brand, country: "TR", listProducts: boyner.listProducts },
  { brand: beymen.brand, country: "TR", listProducts: beymen.listProducts },
];

/**
 * Which markets this run collects, from `COUNTRIES=TR,AE,GB`.
 *
 * Unset means Turkey — the sweep that has always run. An unknown code THROWS
 * rather than being ignored, for the reason `ONLY_BRANDS` does: a typo that
 * silently selects nothing looks exactly like an outage in the logs, and the
 * blocked-brand guard cannot tell them apart either.
 */
export function selectCountries(raw: string | undefined): CountryCode[] {
  const asked = (raw ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (asked.length === 0) return [DEFAULT_COUNTRY];
  const unknown = asked.filter((c) => !isCountry(c));
  if (unknown.length > 0) {
    throw new Error(
      `COUNTRIES names no country we serve: ${unknown.join(", ")}. ` +
        `Add it to lib/countries.ts (and its adapters) first.`,
    );
  }
  return [...new Set(asked)] as CountryCode[];
}

/**
 * The registry, once per market that brand actually has.
 *
 * `listProducts` is REUSED, not cloned: an adapter reads its market from its own
 * module config (tasks 4–9), and this is only the identity plumbing that lets
 * two markets' rows coexist and be delisted independently.
 *
 * Grouped country-outer — every TR brand, then every AE brand — so consecutive
 * tasks are different brands. Each brand's host gate is width 1, so listing
 * zara/TR, zara/AE, zara/SA back to back would park three of the nine fetch
 * workers on one gate while other brands waited their turn.
 */
export function marketAdapters(countries: CountryCode[]): BrandAdapter[] {
  const out: BrandAdapter[] = [];
  for (const country of countries) {
    for (const a of adapters) {
      if (!brandServes(a.brand, country)) continue;
      out.push(country === DEFAULT_COUNTRY ? a : { ...a, country });
    }
  }
  return out;
}
