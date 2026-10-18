/**
 * Brands that are not collected at night, Turkish time (owner 2026-10-18).
 *
 * Gratis prices its deals as "Gratis Kart Fiyatı" (the free loyalty card's
 * price) and switches extra card-only campaigns on at 00:00 and off at 09:00.
 * Since the card price is now what the app shows, a night sweep would read
 * each night's campaign as a drop and the morning as a rise. Skipping the
 * brand from 00:00 to 09:00 keeps the daytime price standing overnight.
 *
 * Pure and platform-free: the collector skips these brands, and the health
 * check (lib/collector-health.ts) does not call them stale for it.
 */
export const NIGHT_PAUSED = new Set(["gratis"]);

/** Hour of day in Turkey (UTC+3 all year). */
export function turkeyHour(now: Date): number {
  return (now.getUTCHours() + 3) % 24;
}

/** True when `brand` is paused right now. */
export function nightPaused(brand: string, now: Date = new Date()): boolean {
  return NIGHT_PAUSED.has(brand) && turkeyHour(now) < 9;
}
