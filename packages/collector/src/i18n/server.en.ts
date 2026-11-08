/**
 * English copy for everything the SERVER writes to a person: price-alert
 * pushes, alert emails, the news/round-up pushes, the day-3 reminder, the
 * first-week welcome series and assistant alarms.
 *
 * THIS FILE IS THE SHAPE: every other server.<lang>.ts is typed against it,
 * and anything a language leaves out is sent in English. Turkish
 * (server.tr.ts) is the original copy and the voice to match.
 *
 * Amounts and percentages arrive ALREADY FORMATTED for the reader's language
 * (lib/format.ts: "₺1,310.00", "61%"), so no file here places a currency sign
 * or a percent sign itself. Brand names arrive as their brand label and are
 * never translated.
 */
export const en = {
  /** Personal price alerts (push.ts). */
  alert: {
    /** The two prices of a drop, in a sentence. */
    line: (was: string, now: string) => `${now}, was ${was}.`,
    restock: (size: string | null) => (size ? `Size ${size} is back` : "Back in stock"),
    target: (drop: string) => `Your target price is here. ${drop}`,
    refund: (saving: string, now: string) => `Now ${saving} less than you paid: ${now}. Check your return options.`,
    withSize: (size: string, base: string) => `Size ${size}. ${base}`,
  },
  /** The alert email (notifier.ts). */
  email: {
    size: (s: string) => `Size ${s}`,
    restock: (s: string | null) => (s ? `Size ${s} is back in stock 🎉` : "Back in stock 🎉"),
    hitTarget: "🎯 Target reached",
    headingBack: "What you're tracking is back in stock 🎉",
    heading: "News from your tracked list 🎉",
    footer: "Modadrop · price alerts. You're getting this because you tracked these products.",
    unsubscribe: "Unsubscribe",
    subjectBack: (n: number) =>
      `${n} product${n === 1 ? "" : "s"} you track ${n === 1 ? "is" : "are"} back in stock`,
    subject: (n: number) => `News on ${n} product${n === 1 ? "" : "s"} you track`,
  },
  /** The evening round-up and brand sale-start pushes (push-news.ts). */
  news: {
    /** Joins the last two brand names: "Zara, Mango and H&M". */
    and: "and",
    digestTitle: (n: number) => `${n} new ${n === 1 ? "drop" : "drops"} on your brands`,
    digestBody: (brands: string) => `${brands} cut prices.`,
    saleStartTitle: (brand: string) => `The ${brand} sale has started`,
    saleStartBody: "Check the prices of your tracked items.",
  },
  /**
   * The one push a day (push-brands.ts, 2026-11-08): one real product, its price.
   * Titles and wording reviewed with Codex.
   * `n` arrives formatted, `pct` is the smallest qualifying cut. "New
   * arrivals", never "collection": a launch cannot be told from a restock.
   */
  daily: {
    fromFollowed: 'From a brand you follow',
    onSale: (b: string) => `${b}: on sale`,
    saleStarted: (b: string) => `${b}: sale started`,
    justAdded: (b: string) => `${b}: just added`,
  },
  /**
   * Sale-calendar eves (sale-calendar.ts), keyed by the campaign key there. A
   * campaign with no entry in a language is sent in English; one with no
   * English entry is not sent to that reader at all.
   */
  saleCalendar: {
    "1111-eve-2026": { title: "11.11 is tomorrow", body: "Track what you like and we'll tell you when the price drops." },
    "efsane-cuma-eve-2026": { title: "Black Friday is tomorrow", body: "Track what you like and we'll tell you when the price drops." },
  } as Record<string, { title: string; body: string }>,
  /** The one day-3 reminder (push-reminder.ts). */
  reminder: {
    title: "Still on your list",
    body: (n: number) => `${n} items on your list. We'll tell you if a price drops or your size is back.`,
  },
  /** The first-week welcome series (push-welcome.ts). `pct` is formatted ("30%"). */
  welcome: {
    and: " and ",
    drops1Title: (n: number, pct: string) => `${n} items dropped ${pct}+ today`,
    drops1Body: (brands: string) => `${brands} are in today's deals.`,
    deal3Title: (brand: string, pct: string) => `${brand}: ${pct} off`,
    deal3Body: (name: string, price: string) => `${name} is now ${price}. Track it for price updates.`,
    look5Title: "Today's look",
    look5Body: "A look from today's deals. Swap any piece.",
    /** `n` arrives grouped ("1,240"). */
    week7Title: (n: string) => `${n} new deals this week`,
    week7Body: "Track one item you like and we'll tell you when the price drops.",
  },
  /**
   * The sign-in code email (lib/auth/mailer.ts), sent the moment someone taps
   * "Send a code" in the app. The code itself is placed by the mailer.
   */
  signIn: {
    subject: (code: string) => `Your Modadrop sign-in code: ${code}`,
    intro: "Your sign-in code:",
    note: "The code is valid for 10 minutes. If you didn't ask for it, ignore this email — nothing changes in your account.",
  },
  /** Assistant alarms and remembered searches (stilist-alarms.ts). */
  stilist: {
    alarmFor: (q: string) => `For your search: ${q}`,
    alarmTitle: (n: number) => `${n} new for your search`,
    /** `what` is the search in quotes, or `yourSearch`. */
    interestTitle: (what: string, n: number) => (n === 1 ? `New for ${what}` : `${n} new for ${what}`),
    yourSearch: "your search",
    interestBody: (item: string) => `${item} just arrived.`,
  },
};
