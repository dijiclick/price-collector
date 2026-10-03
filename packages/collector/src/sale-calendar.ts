/**
 * Dated shopping moments Turkish shoppers already plan around (2026-10-03;
 * research: docs/marketing/daily-engagement-research-2026-10-03.md §4). Sent
 * on the EVE, in the 20:30-22:00 news window, so people track what they want
 * before the day and get the drop alert when it lands.
 *
 * Add next year's dates each autumn; an entry whose date has passed is simply
 * never due. Black Friday ("Efsane Cuma" in Turkey) is the fourth Friday of
 * November — 27 Nov in 2026.
 */
export interface SaleMoment {
  key: string;
  /** The device-local date it is sent on (YYYY-MM-DD). */
  date: string;
  tr: { title: string; body: string };
  en: { title: string; body: string };
}

export const SALE_CALENDAR: readonly SaleMoment[] = [
  {
    key: "1111-eve-2026",
    date: "2026-11-10",
    tr: { title: "Yarın 11.11", body: "İstediğin ürünleri şimdi takibe al, fiyatı düşünce ilk sen öğren." },
    en: { title: "11.11 is tomorrow", body: "Track what you want now and hear first when it drops." },
  },
  {
    key: "efsane-cuma-eve-2026",
    date: "2026-11-26",
    tr: { title: "Yarın Efsane Cuma", body: "Beğendiklerini takibe al; fiyatı düşünce ya da bedenin gelince haber verelim." },
    en: { title: "Black Friday is tomorrow", body: "Track your picks now and we'll tell you the moment prices fall." },
  },
];

export function dueCampaigns(now: Date, tz: string | null): SaleMoment[] {
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  return SALE_CALENDAR.filter((c) => c.date === local);
}
