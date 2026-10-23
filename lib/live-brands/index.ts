/**
 * Single-product resolvers for brands added after 2026-10-10, one file per
 * brand. live-lookup.ts spreads this map into its RESOLVERS, so a pasted link
 * to one of these brands is fetched, inserted and tracked like any other.
 * Import shared plumbing from ../live-http, never from ../live-lookup (cycle).
 */
import type { LiveProduct } from "../live-lookup";
import { leftiesUrl } from "./lefties";
import { vakkoUrl } from "./vakko";
import { vakkoramaUrl } from "./vakkorama";
import { nikeUrl } from "./nike";
import { newbalanceUrl } from "./newbalance";
import { pumaUrl } from "./puma";
import { superstepUrl } from "./superstep";
import { modanisaUrl } from "./modanisa";
import { networkUrl } from "./network";
import { ipekyolUrl } from "./ipekyol";
import { twistUrl } from "./twist";
import { lacosteUrl } from "./lacoste";
import { pierrecardinUrl } from "./pierrecardin";
import { derimodUrl } from "./derimod";
import { bloomingdalesUsUrl } from "./bloomingdales-us";
import { kohlsUrl } from "./kohls";
import { asicsUrl } from "./asics";
import { benefitUrl } from "./benefit";
import { patagoniaUrl } from "./patagonia";
import { ralphlaurenUrl } from "./ralphlauren";
import { kendrascottUrl } from "./kendrascott";
import { toryburchUrl } from "./toryburch";
import { dswUrl } from "./dsw";
import { anntaylorUrl } from "./anntaylor";
import { loftUsUrl } from "./loft-us";
import { lanebryantUrl } from "./lanebryant";
import { pacsunUrl } from "./pacsun";
import { birkenstockUrl } from "./birkenstock";
import { bathandbodyworksUrl } from "./bathandbodyworks";
import { torridUrl } from "./torrid";
import { expressUrl } from "./express";
import { marcjacobsUrl } from "./marcjacobs";
import { joefreshUrl } from "./joefresh";
import { sportchekUrl } from "./sportchek";
import { marksUrl } from "./marks";
import { sportinglifeUrl } from "./sportinglife";
import { ssenseUrl } from "./ssense";
import { newbalanceNaUrl } from "./newbalance-na";
import { underarmourNaUrl } from "./underarmour-na";
import { casioUrl } from "./casio";
import { atasayUrl } from "./atasay";
import { zenpirlantaUrl } from "./zenpirlanta";
import { aldoUrl } from "./aldo";
import { quzuUrl } from "./quzu";
import { lesbenjaminsUrl } from "./lesbenjamins";
import { altinbasUrl } from "./altinbas";
import { swarovskiUrl } from "./swarovski";
import { saatvesaatUrl } from "./saatvesaat";
import { levisUrl } from "./levis";
import { vansUrl } from "./vans";
import { timberlandUrl } from "./timberland";
import { underarmourUrl } from "./underarmour";
import { machkaUrl } from "./machka";
import { adlUrl } from "./adl";
import { wcollectionUrl } from "./wcollection";
import { jimmykeyUrl } from "./jimmykey";
import { loftUrl } from "./loft";
import { marksandspencerUrl } from "./marksandspencer";
import { victoriassecretUrl } from "./victoriassecret";
import { lcwUrl } from "./lcw";
import { defactoUrl } from "./defacto";
import { maviUrl } from "./mavi";
import { colinsUrl } from "./colins";
import { mudoUrl } from "./mudo";
import { SHOPIFY_RESOLVERS } from "./shopify";
import { TICIMAX_RESOLVERS } from "./ticimax";

export const EXTRA_RESOLVERS: Record<string, (url: string) => Promise<LiveProduct | null>> = {
  lefties: leftiesUrl,
  vakko: vakkoUrl,
  vakkorama: vakkoramaUrl,
  nike: nikeUrl,
  newbalance: async (u: string) => (await newbalanceNaUrl(u)) ?? newbalanceUrl(u),
  puma: pumaUrl,
  superstep: superstepUrl,
  modanisa: modanisaUrl,
  network: networkUrl,
  ipekyol: ipekyolUrl,
  twist: twistUrl,
  lacoste: lacosteUrl,
  pierrecardin: pierrecardinUrl,
  derimod: derimodUrl,
  bloomingdales: bloomingdalesUsUrl, kohls: kohlsUrl, asics: asicsUrl, benefit: benefitUrl, patagonia: patagoniaUrl, ralphlauren: ralphlaurenUrl,
  kendrascott: kendrascottUrl, toryburch: toryburchUrl, dsw: dswUrl, anntaylor: anntaylorUrl,
  lanebryant: lanebryantUrl, pacsun: pacsunUrl, birkenstock: birkenstockUrl, bathandbodyworks: bathandbodyworksUrl,
  torrid: torridUrl, express: expressUrl, marcjacobs: marcjacobsUrl,
  joefresh: joefreshUrl, sportchek: sportchekUrl, marks: marksUrl, sportinglife: sportinglifeUrl, ssense: ssenseUrl,
  casio: casioUrl,
  atasay: atasayUrl,
  zenpirlanta: zenpirlantaUrl,
  aldo: aldoUrl,
  quzu: quzuUrl,
  lesbenjamins: lesbenjaminsUrl,
  altinbas: altinbasUrl,
  swarovski: swarovskiUrl,
  saatvesaat: saatvesaatUrl,
  levis: levisUrl,
  vans: vansUrl,
  timberland: timberlandUrl,
  underarmour: async (u: string) => (await underarmourNaUrl(u)) ?? underarmourUrl(u),
  machka: machkaUrl,
  adl: adlUrl,
  wcollection: wcollectionUrl,
  jimmykey: jimmykeyUrl,
  loft: async (u: string) => (await loftUrl(u)) ?? loftUsUrl(u),
  marksandspencer: marksandspencerUrl,
  victoriassecret: victoriassecretUrl,
  lcw: lcwUrl,
  defacto: defactoUrl,
  mavi: maviUrl,
  colins: colinsUrl,
  mudo: mudoUrl,
  // 2026-10-11: every Shopify storefront (shopify-sites.ts) through one resolver.
  ...SHOPIFY_RESOLVERS,
  // 2026-10-23: small Turkish Ticimax shops (ticimax.ts), direct egress.
  ...TICIMAX_RESOLVERS,
};
