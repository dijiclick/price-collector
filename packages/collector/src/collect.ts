import { main } from "./collector";
import { adapters, marketAdapters, selectCountries } from "./registry";

/**
 * Optional brand filters, so one schedule can run a subset of the registry.
 *
 * This exists because the collector is split across two hosts: GitHub Actions
 * has the CPU to sweep the whole catalog quickly, but its Azure egress is
 * blocked by Rossmann; a small always-on box reaches Rossmann but is far too
 * slow for the heavy brands. So Actions runs SKIP_BRANDS=rossmann and the box
 * runs ONLY_BRANDS=rossmann.
 *
 *   ONLY_BRANDS=rossmann,koton   collect just these
 *   SKIP_BRANDS=rossmann         collect everything else
 */
const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const only = list(process.env.ONLY_BRANDS);
const skip = list(process.env.SKIP_BRANDS);

/**
 * Which markets this run sweeps: `COUNTRIES=TR,AE,GB`. Unset is Turkey, which
 * is the schedule that has always run — the international sweep is a separate
 * workflow on a slower cadence, because prices abroad do not move faster than
 * they do in Turkey and one origin can only take so much.
 */
let countries;
try {
  countries = selectCountries(process.env.COUNTRIES);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

let selected = marketAdapters(countries);
if (only.length > 0) selected = selected.filter((a) => only.includes(a.brand));
if (skip.length > 0) selected = selected.filter((a) => !skip.includes(a.brand));

const unknown = only.filter((b) => !adapters.some((a) => a.brand === b));
if (unknown.length > 0) {
  // A typo here would silently collect nothing, which the blocked-brand guard
  // can't distinguish from an outage. Fail loudly instead.
  console.error(`ONLY_BRANDS names no such brand: ${unknown.join(", ")}`);
  process.exit(1);
}
if (selected.length === 0) {
  console.error("brand filters selected nothing — refusing to run");
  process.exit(1);
}
const all = marketAdapters(countries);
if (selected.length !== all.length) {
  console.log(
    `collecting ${selected.length}/${all.length} brand×market pairs: ` +
      selected.map((a) => (a.country === "TR" ? a.brand : `${a.brand}/${a.country}`)).join(", "),
  );
}
if (countries.length > 1) {
  console.log(`markets: ${countries.join(", ")} (${all.length} brand×market pairs)`);
}

main(selected).catch((err) => {
  console.error(err);
  process.exit(1);
});
