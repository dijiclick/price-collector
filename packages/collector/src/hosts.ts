/**
 * Which origin a brand's requests land on.
 *
 * This exists because every brand's fetch concurrency was tuned per HOST for
 * ONE country: `zara.ts` fetches 16-wide, `_inditex.ts` 8-wide, Bershka and
 * Oysho 5-wide, and H&M is strictly sequential because it 403s at 8. Collecting
 * four markets of the same brand at once multiplies each of those by four
 * against a single origin, which is exactly where an IP ban comes from — and
 * all of it leaves GitHub's datacenter egress.
 *
 * Today the group IS the brand: each one talks to its own origin
 * (www.zara.com, api.hm.com, online-orchestrator.mango.com, each Inditex
 * brand's own itxrest host). The indirection is the seam for the day two
 * brands share one, which would otherwise be a silent doubling of load.
 */
const SHARED_HOSTS: Record<string, string> = {};

export const hostGroup = (brand: string): string => SHARED_HOSTS[brand] ?? brand;
