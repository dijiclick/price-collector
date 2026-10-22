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
    restock: (size: string | null) => (size ? `Size ${size} is back in stock 🎉` : "Back in stock 🎉"),
    target: (drop: string) => `🎯 Hit your target — ${drop}`,
    refund: (saving: string, now: string) => `${saving} cheaper than you paid: ${now}. You can return it and buy it again.`,
    withSize: (size: string, base: string) => `Size ${size} · ${base}`,
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
    digestBody: (brands: string) => `${brands}: prices just fell. Take a look before your size goes.`,
    saleStartTitle: (brand: string) => `The ${brand} sale has started`,
    saleStartBody: "Check your tracked items and sizes before they go.",
  },
  /**
   * Sale-calendar eves (sale-calendar.ts), keyed by the campaign key there. A
   * campaign with no entry in a language is sent in English; one with no
   * English entry is not sent to that reader at all.
   */
  saleCalendar: {
    "1111-eve-2026": { title: "11.11 is tomorrow", body: "Track what you want now and hear first when it drops." },
    "efsane-cuma-eve-2026": { title: "Black Friday is tomorrow", body: "Track your picks now and we'll tell you the moment prices fall." },
  } as Record<string, { title: string; body: string }>,
  /** The one day-3 reminder (push-reminder.ts). */
  reminder: {
    title: "Still watching for you 👀",
    body: (n: number) =>
      `We're watching your ${n} ${n === 1 ? "item" : "items"}: you'll hear when the price drops or your size is back. Meanwhile, see today's deals.`,
  },
  /** The first-week welcome series (push-welcome.ts). `pct` is formatted ("30%"). */
  welcome: {
    and: " and ",
    drops1Title: (n: number, pct: string) => `${n} items dropped ${pct}+ today`,
    drops1Body: (brands: string) => `${brands} lead today's drops. Have a look before your size goes.`,
    deal3Title: (brand: string, pct: string) => `${brand}: ${pct} off`,
    deal3Body: (name: string, price: string) => `${name} is now ${price}. Tap ♡ to track it — we'll tell you if it drops again.`,
    look5Title: "A look picked for you",
    look5Body: "Our stylist put an outfit together from today's deals. Swap any piece with one tap.",
    /** `n` arrives grouped ("1,240"). */
    week7Title: (n: string) => `${n} new deals this week`,
    week7Body: "Track one item you like and we'll only message you about what's yours.",
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
    alarmTitle: (n: number) => `Assistant alarm: ${n} new ${n === 1 ? "match" : "matches"}`,
    /** `what` is the search in quotes, or `yourSearch`. */
    interestTitle: (what: string, n: number) => (n === 1 ? `New for ${what}` : `${n} new for ${what}`),
    yourSearch: "your search",
    interestBody: (item: string) => `${item} just arrived.`,
  },
};
