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
import { marksandspencerUrl } from "./marksandspencer";
import { victoriassecretUrl } from "./victoriassecret";
import { lcwUrl } from "./lcw";
import { defactoUrl } from "./defacto";
import { maviUrl } from "./mavi";
import { colinsUrl } from "./colins";
import { mudoUrl } from "./mudo";

export const EXTRA_RESOLVERS: Record<string, (url: string) => Promise<LiveProduct | null>> = {
  lefties: leftiesUrl,
  vakko: vakkoUrl,
  vakkorama: vakkoramaUrl,
  nike: nikeUrl,
  newbalance: newbalanceUrl,
  puma: pumaUrl,
  superstep: superstepUrl,
  modanisa: modanisaUrl,
  network: networkUrl,
  ipekyol: ipekyolUrl,
  twist: twistUrl,
  lacoste: lacosteUrl,
  pierrecardin: pierrecardinUrl,
  derimod: derimodUrl,
  marksandspencer: marksandspencerUrl,
  victoriassecret: victoriassecretUrl,
  lcw: lcwUrl,
  defacto: defactoUrl,
  mavi: maviUrl,
  colins: colinsUrl,
  mudo: mudoUrl,
};
