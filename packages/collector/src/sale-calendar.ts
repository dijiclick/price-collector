/**
 * Dated shopping moments Turkish shoppers already plan around (2026-10-03;
 * research: docs/marketing/daily-engagement-research-2026-10-03.md §4). Sent
 * on the EVE, in the 20:30-22:00 news window, so people track what they want
 * before the day and get the drop alert when it lands.
 *
 * Add next year's dates each autumn; an entry whose date has passed is simply
 * never due. The words for each campaign live per language in
 * i18n/server.<lang>.ts under `saleCalendar[key]`. Black Friday ("Efsane Cuma" in Turkey) is the fourth Friday of
 * November — 27 Nov in 2026.
 */
export interface SaleMoment {
  key: string;
  /** The device-local date it is sent on (YYYY-MM-DD). */
  date: string;
}

export const SALE_CALENDAR: readonly SaleMoment[] = [
  {
    key: "1111-eve-2026",
    date: "2026-11-10",
  },
  {
    key: "efsane-cuma-eve-2026",
    date: "2026-11-26",
  },
];

export function dueCampaigns(now: Date, tz: string | null): SaleMoment[] {
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  return SALE_CALENDAR.filter((c) => c.date === local);
}
