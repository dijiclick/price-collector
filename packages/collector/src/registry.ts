import type { BrandAdapter } from "./types";
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
export const adapters: BrandAdapter[] = [
  { brand: zara.brand, listProducts: zara.listProducts },
  { brand: guess.brand, listProducts: guess.listProducts },
  { brand: penti.brand, listProducts: penti.listProducts },
  { brand: sephora.brand, listProducts: sephora.listProducts },
  { brand: hm.brand, listProducts: hm.listProducts },
  { brand: gratis.brand, listProducts: gratis.listProducts },
  { brand: mango.brand, listProducts: mango.listProducts },
  { brand: watsons.brand, listProducts: watsons.listProducts },
  { brand: pandora.brand, listProducts: pandora.listProducts },
  { brand: massimodutti.brand, listProducts: massimodutti.listProducts },
  { brand: pullandbear.brand, listProducts: pullandbear.listProducts },
  { brand: stradivarius.brand, listProducts: stradivarius.listProducts },
  { brand: oysho.brand, listProducts: oysho.listProducts },
  { brand: koton.brand, listProducts: koton.listProducts },
  { brand: rossmann.brand, listProducts: rossmann.listProducts },
  { brand: bershka.brand, listProducts: bershka.listProducts },
  { brand: boyner.brand, listProducts: boyner.listProducts },
  { brand: beymen.brand, listProducts: beymen.listProducts },
];
