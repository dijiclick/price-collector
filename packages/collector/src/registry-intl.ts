/**
 * Adapters added 2026-10-11 for every market (docs/brand-plan-2026-10-11.md).
 * Which markets each brand runs in comes from lib/brands.ts — marketAdapters
 * calls `listProducts(country)` only for those. None of these uses the proxy.
 */
import type { CountryCode } from "../../../lib/countries";
import type { ProductRecord } from "./types";
import { listCottonOn } from "./brands/cottonon";
import { listShowpo } from "./brands/showpo";
import { listSportsgirl } from "./brands/sportsgirl";
import { listJdSports } from "./brands/jdsports";
import { listJdSportsGb } from "./brands/jdsports-gb";
import { listNext, listReiss } from "./brands/_nextplc";
import { listRiverIsland } from "./brands/riverisland";
import { listKappahl, listVita } from "./brands/_avensia";
import { listXxl } from "./brands/xxl";
import { listBlivakker } from "./brands/blivakker";
import { listDeichmann } from "./brands/_deichmann";
import { listChicoree } from "./brands/chicoree";
import * as uspoloassn from "./brands/uspoloassn";
import * as cacharel from "./brands/cacharel";
import * as converse from "./brands/converse";
import * as gant from "./brands/gant";
import * as maccosmetics from "./brands/maccosmetics";
import * as flormar from "./brands/flormar";
import * as fashfed from "./brands/fashfed";
import * as sportive from "./brands/sportive";
import { listGapTr } from "./brands/gap-tr";
import { listGapInc } from "./brands/_gapinc";
import { listAnf } from "./brands/_anf";
import { listUlta } from "./brands/ulta";
import { listSkims, listFashionNova, listAldo } from "./brands/storefront-stores";
import { listOn } from "./brands/on";
import { listRoots } from "./brands/roots";
import { listLaVieEnRose } from "./brands/lavieenrose";
import { listGinaTricot } from "./brands/ginatricot";
import { listNakd } from "./brands/nakd";
import { listEllos } from "./brands/ellos";
import { listFredrikOgLouisa } from "./brands/fredrikoglouisa";
import { listGullfunn } from "./brands/gullfunn";
import { listCanda } from "./brands/c-and-a";
import { listManor } from "./brands/manor";
import { listAboutYou } from "./brands/aboutyou";
import { listImpo } from "./brands/impo";
import { listBestseller } from "./brands/_bestseller";
import { listAlshaya } from "./brands/_alshaya";
import * as goldenscent from "./brands/goldenscent";
import * as vperfumes from "./brands/vperfumes";
import * as bloomingdales from "./brands/bloomingdales";
import * as damas from "./brands/damas";
import * as ajmal from "./brands/ajmal";
import * as nahdi from "./brands/nahdi";

type List = (country: CountryCode) => Promise<ProductRecord[]>;

/** Turkey's long-standing adapter at home, the new one everywhere else. */
export const byMarket = (tr: () => Promise<ProductRecord[]>, intl: List): List => (c) => (c === "TR" ? tr() : intl(c));

const tr = (list: () => Promise<ProductRecord[]>): List => (c) => (c === "TR" ? list() : Promise.resolve([]));

export const intlAdapters: { brand: string; listProducts: List }[] = [
  // Turkey — Akinon storefronts and multi-brand stores (no proxy).
  { brand: "gap", listProducts: byMarket(listGapTr, (c) => listGapInc("gap", c)) },
  { brand: "uspoloassn", listProducts: tr(uspoloassn.listProducts) },
  { brand: "cacharel", listProducts: tr(cacharel.listProducts) },
  { brand: "converse", listProducts: tr(converse.listProducts) },
  { brand: "gant", listProducts: tr(gant.listProducts) },
  { brand: "maccosmetics", listProducts: tr(maccosmetics.listProducts) },
  { brand: "flormar", listProducts: tr(flormar.listProducts) },
  { brand: "fashfed", listProducts: tr(fashfed.listProducts) },
  { brand: "sportive", listProducts: tr(sportive.listProducts) },
  // United States / Canada
  { brand: "oldnavy", listProducts: (c) => listGapInc("oldnavy", c) },
  { brand: "bananarepublic", listProducts: (c) => listGapInc("bananarepublic", c) },
  { brand: "athleta", listProducts: (c) => listGapInc("athleta", c) },
  { brand: "abercrombie", listProducts: (c) => listAnf("abercrombie", c) },
  { brand: "hollister", listProducts: (c) => listAnf("hollister", c) },
  { brand: "ulta", listProducts: listUlta },
  { brand: "skims", listProducts: listSkims },
  { brand: "fashionnova", listProducts: listFashionNova },
  { brand: "aldo", listProducts: listAldo },
  { brand: "on", listProducts: listOn },
  { brand: "roots", listProducts: listRoots },
  { brand: "lavieenrose", listProducts: listLaVieEnRose },
  // United Kingdom
  { brand: "next", listProducts: listNext },
  { brand: "reiss", listProducts: listReiss },
  { brand: "riverisland", listProducts: listRiverIsland },
  { brand: "jdsports", listProducts: listJdSportsGb },
  // Australia
  { brand: "cottonon", listProducts: listCottonOn },
  { brand: "showpo", listProducts: listShowpo },
  { brand: "sportsgirl", listProducts: listSportsgirl },
  { brand: "jd-sports", listProducts: listJdSports },
  // Switzerland
  { brand: "dosenbach", listProducts: (c) => listDeichmann("dosenbach", c) },
  { brand: "ochsnershoes", listProducts: (c) => listDeichmann("ochsner-shoes", c).then((rows) => rows.map((r) => ({ ...r, brand: "ochsnershoes" }))) },
  { brand: "ochsnersport", listProducts: (c) => listDeichmann("ochsnersport", c) },
  { brand: "snipes", listProducts: (c) => listDeichmann("snipes", c) },
  { brand: "chicoree", listProducts: listChicoree },
  { brand: "c-and-a", listProducts: listCanda },
  { brand: "manor", listProducts: listManor },
  { brand: "aboutyou", listProducts: listAboutYou },
  { brand: "impo", listProducts: listImpo },
  { brand: "only", listProducts: (c) => listBestseller("only", c) },
  { brand: "veromoda", listProducts: (c) => listBestseller("veromoda", c) },
  // Norway
  { brand: "kappahl", listProducts: listKappahl },
  { brand: "vita", listProducts: listVita },
  { brand: "xxl", listProducts: listXxl },
  { brand: "blivakker", listProducts: listBlivakker },
  { brand: "ginatricot", listProducts: listGinaTricot },
  { brand: "na-kd", listProducts: listNakd },
  { brand: "ellos", listProducts: listEllos },
  { brand: "fredrikoglouisa", listProducts: listFredrikOgLouisa },
  { brand: "gullfunn", listProducts: listGullfunn },
  // UAE / Saudi Arabia
  { brand: "bathandbodyworks", listProducts: (c) => listAlshaya("bathandbodyworks", c) },
  { brand: "americaneagle", listProducts: (c) => listAlshaya("americaneagle", c) },
  { brand: "goldenscent", listProducts: goldenscent.listProducts },
  { brand: "vperfumes", listProducts: vperfumes.listProducts },
  { brand: "bloomingdales", listProducts: bloomingdales.listProducts },
  { brand: "damas", listProducts: damas.listProducts },
  { brand: "ajmal", listProducts: ajmal.listProducts },
  { brand: "nahdi", listProducts: nahdi.listProducts },
];
