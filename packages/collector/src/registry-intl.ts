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
import { listCalzedoniaGroup } from "./brands/_calzedoniagroup";
import { listTicimaxBrand } from "./brands/_ticimax";
import { listPhantomBrand } from "./brands/_phantom";
import * as suwen from "./brands/suwen";
import * as haydigiy from "./brands/haydigiy";
import { listBoohooGroup } from "./brands/boohoogroup";
import { listTfgLondon } from "./brands/tfglondon";
import { listGymshark } from "./brands/gymshark";
import { listMacys } from "./brands/macys";
import { listJcrew } from "./brands/jcrew";
import { listLululemonTr } from "./brands/lululemon-tr";
import { listShopify } from "./brands/_shopify";
import { shopifyStore } from "./brands/shopify-stores";
import { listSweatyBetty } from "./brands/sweatybetty";
import { listSpaceNk } from "./brands/spacenk";
import { listAritzia } from "./brands/aritzia";
import { listLululemon } from "./brands/lululemon";
import { listLornaJane } from "./brands/lornajane";
import { listFaces } from "./brands/faces";
import { listBoots } from "./brands/boots";
import { listBootsGb } from "./brands/boots-gb";
import { listUniqlo } from "./brands/uniqlo";
import { listAmericanEagleNA } from "./brands/americaneagle-na";
import * as garage from "./brands/garage";
import * as dynamite from "./brands/dynamite";
import { listTheIconic } from "./brands/theiconic";
import { listGlassons } from "./brands/glassons";
import { listHelloMolly } from "./brands/hellomolly";
import { listMeshki } from "./brands/meshki";
import { listAdoreBeauty } from "./brands/adorebeauty";
import { listZalando } from "./brands/zalando";
import { listDouglas } from "./brands/douglas";
import { listVarner } from "./brands/_varner";
import { listLindex } from "./brands/lindex";
import { listNelly } from "./brands/nelly";
import { listLyko } from "./brands/lyko";
import { listAivi } from "./brands/aivi";
import { listStyli } from "./brands/styli";
import { listLandmark } from "./brands/_landmark";
import { listOunass } from "./brands/ounass";
import { listFtech } from "./brands/_ftech";
import * as kiko from "./brands/kiko";
import * as skechers from "./brands/skechers";
import { listSkechersNa } from "./brands/skechers-na";
import { listCrocs } from "./brands/crocs";
import { listLevis } from "./brands/levis";
import { listPvh } from "./brands/pvh";
import * as sneaksup from "./brands/sneaksup";
import { listHmGroup } from "./brands/hmgroup";
import * as topshop from "./brands/topshop";
import * as newlook from "./brands/newlook";
import * as asos from "./brands/asos";

type List = (country: CountryCode) => Promise<ProductRecord[]>;

/** Turkey's long-standing adapter at home, the new one everywhere else. */
export const byMarket = (tr: () => Promise<ProductRecord[]>, intl: List): List => (c) => (c === "TR" ? tr() : intl(c));

const tr = (list: () => Promise<ProductRecord[]>): List => (c) => (c === "TR" ? list() : Promise.resolve([]));
/** A single-market adapter: runs only for that market. */
const tr2 = (only: CountryCode, list: () => Promise<ProductRecord[]>): List => (c) => (c === only ? list() : Promise.resolve([]));

export const intlAdapters: { brand: string; listProducts: List }[] = [
  // Turkey — Akinon storefronts and multi-brand stores (no proxy).
  { brand: "gap", listProducts: byMarket(listGapTr, (c) => listGapInc("gap", c)) },
  // Gap Inc Factory stores (US/CA): same API, brand codes gapfs / brfs.
  { brand: "gapfactory", listProducts: (c) => listGapInc("gapfactory", c) },
  { brand: "brfactory", listProducts: (c) => listGapInc("brfactory", c) },
  // Macy's (US): the site's own /xapi/discover browse feed — Akamai walls the HTML, not this.
  { brand: "macys", listProducts: listMacys },
  // J.Crew group: Constructor.io search feed (outside the Akamai wall). J.Crew
  // Factory is NOT listed: 99% of its catalogue strikes an invented
  // "comparable value", not a price it ever charged (2026-10-12).
  { brand: "jcrew", listProducts: (c) => listJcrew("jcrew", c) },
  { brand: "madewell", listProducts: (c) => listJcrew("madewell", c) },
  // Crocs (US/CA): the site's Algolia indexes; shoes only (Jibbitz/bags excluded).
  { brand: "crocs", listProducts: listCrocs },
  // Levi's (US/CA): Constructor.io sale groups (levi.com itself is behind Akamai).
  { brand: "levis", listProducts: listLevis },
  // PVH: AU via the shared Magento GraphQL; US via the site's sale grid.
  { brand: "calvinklein", listProducts: (c) => listPvh("calvinklein", c) },
  { brand: "tommyhilfiger", listProducts: (c) => listPvh("tommyhilfiger", c) },
  { brand: "uspoloassn", listProducts: tr(uspoloassn.listProducts) },
  { brand: "cacharel", listProducts: tr(cacharel.listProducts) },
  { brand: "converse", listProducts: tr(converse.listProducts) },
  { brand: "gant", listProducts: tr(gant.listProducts) },
  { brand: "maccosmetics", listProducts: tr(maccosmetics.listProducts) },
  { brand: "flormar", listProducts: tr(flormar.listProducts) },
  { brand: "fashfed", listProducts: tr(fashfed.listProducts) },
  { brand: "sportive", listProducts: tr(sportive.listProducts) },
  // Turkey — Calzedonia group (also CH), Ticimax, Inveon Phantom, own stacks.
  { brand: "calzedonia", listProducts: (c) => listCalzedoniaGroup("calzedonia", c) },
  { brand: "intimissimi", listProducts: (c) => listCalzedoniaGroup("intimissimi", c) },
  { brand: "falconeri", listProducts: (c) => listCalzedoniaGroup("falconeri", c) },
  { brand: "desa", listProducts: (c) => listTicimaxBrand("desa", c) },
  { brand: "elifstil", listProducts: (c) => listTicimaxBrand("elifstil", c) },
  { brand: "noteshop", listProducts: (c) => listTicimaxBrand("noteshop", c) },
  { brand: "yargici", listProducts: (c) => listPhantomBrand("yargici", c) },
  { brand: "hotic", listProducts: (c) => listPhantomBrand("hotic", c) },
  { brand: "suwen", listProducts: tr(() => suwen.listProducts("TR")) },
  { brand: "haydigiy", listProducts: tr(() => haydigiy.listProducts("TR")) },
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
  // Owner's two most-wanted (2026-10-11). Aritzia: public Algolia, no proxy.
  // Lululemon: direct first; the US/CA proxy only after a refusal (~0.5 MB a run).
  { brand: "aritzia", listProducts: listAritzia },
  // Turkey: lululemon.com.tr's own /api/products (Retter platform), no proxy.
  { brand: "lululemon", listProducts: (c) => (c === "TR" ? listLululemonTr() : listLululemon(c)) },
  // United Kingdom
  { brand: "next", listProducts: listNext },
  { brand: "reiss", listProducts: listReiss },
  { brand: "riverisland", listProducts: listRiverIsland },
  { brand: "jdsports", listProducts: listJdSportsGb },
  { brand: "boohoo", listProducts: (c) => listBoohooGroup("boohoo", c) },
  { brand: "prettylittlething", listProducts: (c) => listBoohooGroup("prettylittlething", c) },
  { brand: "whistles", listProducts: (c) => listTfgLondon("whistles", c) },
  { brand: "hobbs", listProducts: (c) => listTfgLondon("hobbs", c) },
  { brand: "gymshark", listProducts: (c) => (c === "GB" ? listGymshark(c) : listShopify(shopifyStore("gymshark"), c)) },
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
  { brand: "bathandbodyworks", listProducts: (c) => (c === "TR" ? listTicimaxBrand("bathandbodyworks", c) : listAlshaya("bathandbodyworks", c)) },
  { brand: "americaneagle", listProducts: (c) => (c === "US" || c === "CA" ? listAmericanEagleNA(c) : listAlshaya("americaneagle", c)) },
  { brand: "goldenscent", listProducts: goldenscent.listProducts },
  { brand: "vperfumes", listProducts: vperfumes.listProducts },
  { brand: "bloomingdales", listProducts: bloomingdales.listProducts },
  { brand: "damas", listProducts: damas.listProducts },
  { brand: "ajmal", listProducts: ajmal.listProducts },
  { brand: "nahdi", listProducts: nahdi.listProducts },
  // ── Round 2 (2026-10-11): big brands behind bot walls, reached through the
  // sites' own search services / app APIs. Proxy only for Lululemon (fallback),
  // Victoria's Secret US/CA and Ounass, each measured < ~1 MB a run.
  { brand: "lornajane", listProducts: listLornaJane },
  { brand: "faces", listProducts: listFaces },
  { brand: "boots", listProducts: (c) => (c === "GB" ? listBootsGb(c) : listBoots(c)) },
  { brand: "uniqlo", listProducts: listUniqlo },
  { brand: "garage", listProducts: (c) => garage.listProducts(c) },
  { brand: "dynamite", listProducts: (c) => dynamite.listProducts(c) },
  { brand: "theiconic", listProducts: listTheIconic },
  { brand: "glassons", listProducts: listGlassons },
  { brand: "hellomolly", listProducts: listHelloMolly },
  { brand: "meshki", listProducts: listMeshki },
  { brand: "adorebeauty", listProducts: listAdoreBeauty },
  { brand: "zalando", listProducts: listZalando },
  { brand: "douglas", listProducts: listDouglas },
  { brand: "cubus", listProducts: (c) => listVarner("cubus", c) },
  { brand: "bikbok", listProducts: (c) => listVarner("bikbok", c) },
  { brand: "lindex", listProducts: listLindex },
  { brand: "nelly", listProducts: listNelly },
  { brand: "lyko", listProducts: listLyko },
  { brand: "aivi", listProducts: listAivi },
  { brand: "styli", listProducts: listStyli },
  { brand: "centrepoint", listProducts: (c) => listLandmark("centrepoint", c) },
  { brand: "maxfashion", listProducts: (c) => listLandmark("maxfashion", c) },
  { brand: "splash", listProducts: (c) => listLandmark("splash", c) },
  { brand: "ounass", listProducts: listOunass },
  { brand: "flo", listProducts: (c) => listFtech("flo", c) },
  { brand: "instreet", listProducts: (c) => listFtech("instreet", c) },
  { brand: "lumberjack", listProducts: (c) => listFtech("lumberjack", c) },
  { brand: "kinetix", listProducts: (c) => listFtech("kinetix", c) },
  { brand: "reebok", listProducts: (c) => listFtech("reebok", c) },
  { brand: "kiko", listProducts: tr(() => kiko.listProducts("TR")) },
  // Skechers: PersonaClick in Turkey; Bloomreach (account 7927) in US/CA.
  { brand: "skechers", listProducts: byMarket(() => skechers.listProducts("TR"), listSkechersNa) },
  { brand: "sneaksup", listProducts: tr(() => sneaksup.listProducts("TR")) },
  { brand: "arket", listProducts: (c) => listHmGroup("arket", c) },
  { brand: "stories", listProducts: (c) => listHmGroup("stories", c) },
  { brand: "weekday", listProducts: (c) => listHmGroup("weekday", c) },
  { brand: "topshop", listProducts: tr2("GB", () => topshop.listProducts("GB")) },
  { brand: "newlook", listProducts: tr2("GB", () => newlook.listProducts("GB")) },
  { brand: "asos", listProducts: tr2("GB", () => asos.listProducts("GB")) },
];
