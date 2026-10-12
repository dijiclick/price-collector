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
import { listPandoraIntl } from "./brands/pandora-intl";
import * as massimodutti from "./brands/massimodutti";
import * as pullandbear from "./brands/pullandbear";
import * as stradivarius from "./brands/stradivarius";
import * as oysho from "./brands/oysho";
import * as koton from "./brands/koton";
import * as rossmann from "./brands/rossmann";
import * as bershka from "./brands/bershka";
import * as boyner from "./brands/boyner";
import * as beymen from "./brands/beymen";
import * as lefties from "./brands/lefties";
import * as vakko from "./brands/vakko";
import * as vakkorama from "./brands/vakkorama";
import * as nike from "./brands/nike";
import * as newbalance from "./brands/newbalance";
import * as puma from "./brands/puma";
import { listPumaIntl } from "./brands/puma-intl";
import * as superstep from "./brands/superstep";
import * as modanisa from "./brands/modanisa";
import * as network from "./brands/network";
import * as ipekyol from "./brands/ipekyol";
import * as twistV2 from "./brands/twist-v2";
import * as lacoste from "./brands/lacoste";
import { listLacosteIntl } from "./brands/lacoste-intl";
import * as pierrecardin from "./brands/pierrecardin";
import * as derimod from "./brands/derimod";
import { shopifyAdapters } from "./brands/shopify-stores";
import { byMarket, intlAdapters } from "./registry-intl";
import { listSephoraIntl } from "./brands/sephora-intl";
import { listSephoraAsia } from "./brands/sephora-au";
import { listSephoraCh } from "./brands/sephora-ch";
import { listHmGulf } from "./brands/hm-gulf";
import { listVictoriasSecretNA } from "./brands/victoriassecret-na";
import { listMarksIntl } from "./brands/marksandspencer-intl";
import * as victoriassecretIntl from "./brands/victoriassecret-intl";
import * as modanisaIntl from "./brands/modanisa-intl";
import * as marksandspencer from "./brands/marksandspencer";
import * as victoriassecret from "./brands/victoriassecret";
import * as lcw from "./brands/lcw";
import * as defacto from "./brands/defacto";
import * as maviV2 from "./brands/mavi-v2";
import * as colins from "./brands/colins";
import * as mudo from "./brands/mudo";

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
  // Sephora is a different platform in every region: TR OCAPI, US/CA site API,
  // AU through Sephora Asia's API, CH its own SFCC (2026-10-11).
  { brand: sephora.brand, country: "TR", listProducts: byMarket(sephora.listProducts, (c) => (c === "AU" ? listSephoraAsia(c) : c === "CH" ? listSephoraCh(c) : listSephoraIntl(c))) },
  // Gulf H&M is Alshaya's shop, read through Alshaya's Algolia (hm-gulf.ts).
  { brand: hm.brand, country: "TR", listProducts: (c) => (c === "AE" || c === "SA" ? listHmGulf(c) : hm.listProducts(c)) },
  { brand: gratis.brand, country: "TR", listProducts: gratis.listProducts },
  { brand: mango.brand, country: "TR", listProducts: mango.listProducts },
  { brand: watsons.brand, country: "TR", listProducts: watsons.listProducts },
  { brand: pandora.brand, country: "TR", listProducts: byMarket(pandora.listProducts, listPandoraIntl) },
  { brand: massimodutti.brand, country: "TR", listProducts: massimodutti.listProducts },
  { brand: pullandbear.brand, country: "TR", listProducts: pullandbear.listProducts },
  { brand: stradivarius.brand, country: "TR", listProducts: stradivarius.listProducts },
  { brand: oysho.brand, country: "TR", listProducts: oysho.listProducts },
  { brand: koton.brand, country: "TR", listProducts: koton.listProducts },
  { brand: rossmann.brand, country: "TR", listProducts: rossmann.listProducts },
  { brand: bershka.brand, country: "TR", listProducts: bershka.listProducts },
  { brand: boyner.brand, country: "TR", listProducts: boyner.listProducts },
  { brand: beymen.brand, country: "TR", listProducts: beymen.listProducts },
  // Added 2026-10-10 (competitor brand gap: Combup, Simlek, StokDrop).
  { brand: lefties.brand, country: "TR", listProducts: lefties.listProducts },
  { brand: vakko.brand, country: "TR", listProducts: vakko.listProducts },
  { brand: vakkorama.brand, country: "TR", listProducts: vakkorama.listProducts },
  { brand: nike.brand, country: "TR", listProducts: nike.listProducts },
  { brand: newbalance.brand, country: "TR", listProducts: newbalance.listProducts },
  // Turkey: the distributor's Magento shop; US/CA/GB/CH: PUMA's global storefront GraphQL.
  { brand: puma.brand, country: "TR", listProducts: byMarket(puma.listProducts, listPumaIntl) },
  { brand: superstep.brand, country: "TR", listProducts: superstep.listProducts },
  { brand: modanisa.brand, country: "TR", listProducts: byMarket(modanisa.listProducts, modanisaIntl.listProducts) },
  { brand: network.brand, country: "TR", listProducts: network.listProducts },
  { brand: ipekyol.brand, country: "TR", listProducts: ipekyol.listProducts },
  // Twist and Mavi refuse GitHub runners; their Insider recommendation feeds do not (2026-10-11).
  { brand: "twist", country: "TR", listProducts: () => twistV2.listProducts("TR") },
  // Turkey: lacoste.com.tr (Akinon); US: the NA app's guest token + Salesforce Shopper API.
  { brand: lacoste.brand, country: "TR", listProducts: byMarket(lacoste.listProducts, listLacosteIntl) },
  { brand: pierrecardin.brand, country: "TR", listProducts: pierrecardin.listProducts },
  { brand: derimod.brand, country: "TR", listProducts: derimod.listProducts },
  { brand: marksandspencer.brand, country: "TR", listProducts: byMarket(marksandspencer.listProducts, listMarksIntl) },
  { brand: victoriassecret.brand, country: "TR", listProducts: byMarket(victoriassecret.listProducts, (c) => (c === "US" || c === "CA" ? listVictoriasSecretNA(c) : victoriassecretIntl.listProducts(c))) },
  { brand: lcw.brand, country: "TR", listProducts: lcw.listProducts },
  { brand: defacto.brand, country: "TR", listProducts: defacto.listProducts },
  { brand: "mavi", country: "TR", listProducts: () => maviV2.listProducts("TR") },
  { brand: colins.brand, country: "TR", listProducts: colins.listProducts },
  { brand: mudo.brand, country: "TR", listProducts: mudo.listProducts },
  // Added 2026-10-11: Shopify storefronts in every market (docs/brand-plan-2026-10-11.md).
  // Markets come from lib/brands.ts, so an AU-only store never runs for Turkey.
  ...shopifyAdapters,
  ...intlAdapters,
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
      out.push(a.country === country ? a : { ...a, country });
    }
  }
  return out;
}
