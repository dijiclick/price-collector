import type { ServerCopyPartial } from "./server";

/**
 * Traditional Chinese (Hong Kong) server copy: pushes and alert emails. Translated from server.en.ts (same
 * keys; amounts and percentages arrive formatted), with server.tr.ts for the
 * voice. Written standard Chinese with Hong Kong vocabulary (減價, 電郵, 日), 你 not 您.
 * Every key is optional — anything left out is sent in English — and a
 * key server.en.ts does not have fails to compile.
 */
export const zhHant: ServerCopyPartial = {
  /** Personal price alerts (push.ts). */
  alert: {
    restock: (size: string | null) => (size ? `${size} 碼已補貨 🎉` : "已補貨 🎉"),
    target: (drop: string) => `🎯 已達你的目標價 — ${drop}`,
    refund: (saving: string, now: string) => `比你的購買價低 ${saving}：現價 ${now}。你可以退貨後再買。`,
    withSize: (size: string, base: string) => `${size} 碼 · ${base}`,
  },
  /** The alert email (notifier.ts). */
  email: {
    size: (s: string) => `${s} 碼`,
    restock: (s: string | null) => (s ? `${s} 碼已補貨 🎉` : "已補貨 🎉"),
    hitTarget: "🎯 已達目標價",
    headingBack: "你追蹤的商品已補貨 🎉",
    heading: "你的追蹤清單有新消息 🎉",
    footer: "Modadrop · 價格通知。你收到此電郵，是因為你追蹤了這些商品。",
    unsubscribe: "取消訂閱",
    subjectBack: (n: number) => `你追蹤的 ${n} 件商品已補貨`,
    subject: (n: number) => `你追蹤的 ${n} 件商品有新消息`,
  },
  /** The evening round-up and brand sale-start pushes (push-news.ts). */
  news: {
    /** Joins the last two brand names: "Zara, Mango 及 H&M". */
    and: "及",
    digestTitle: (n: number) => `你的品牌有 ${n} 項新減價`,
    digestBody: (brands: string) => `${brands} 剛剛減價。趁你的尺碼未賣完，快去看看。`,
    saleStartTitle: (brand: string) => `${brand} 減價開始了`,
    saleStartBody: "趁貨品未賣完，看看你追蹤的商品和尺碼。",
  },
  /**
   * Sale-calendar eves (sale-calendar.ts), keyed by the campaign key there.
   * Black Friday is called that in Hong Kong too; the Turkish "Efsane Cuma" is
   * the same day under Trendyol's name.
   */
  saleCalendar: {
    "1111-eve-2026": { title: "明天就是 11.11", body: "現在追蹤你想要的商品，一減價就最先知道。" },
    "efsane-cuma-eve-2026": { title: "明天就是黑色星期五", body: "現在追蹤你心儀的商品，一減價我們會即時通知你。" },
  } as Record<string, { title: string; body: string }>,
  /** The one day-3 reminder (push-reminder.ts). */
  reminder: {
    title: "我們仍在替你留意 👀",
    body: (n: number) =>
      `我們正在留意你的 ${n} 件商品：減價或你的尺碼補貨時會通知你。同時看看今日的優惠吧。`,
  },
  /** The first-week welcome series (push-welcome.ts). `pct` is formatted ("30%"). */
  welcome: {
    and: " 及 ",
    drops1Title: (n: number, pct: string) => `今日有 ${n} 件商品減價 ${pct} 或以上`,
    drops1Body: (brands: string) => `${brands} 領先今日減價。趁你的尺碼未賣完，快去看看。`,
    deal3Title: (brand: string, pct: string) => `${brand}：減 ${pct}`,
    deal3Body: (name: string, price: string) => `${name} 現價 ${price}。按 ♡ 追蹤，再減價時我們會通知你。`,
    look5Title: "為你挑選的造型",
    look5Body: "我們的造型師用今日的優惠為你配搭了一套造型。每件單品都可一按更換。",
    /** `n` arrives grouped ("1,240"). */
    week7Title: (n: string) => `本週 ${n} 項新優惠`,
    week7Body: "追蹤一件你喜歡的商品，我們只會就你的商品通知你。",
  },
  /** Assistant alarms and remembered searches (stilist-alarms.ts). */
  signIn: {
    subject: (code: string) => `你的 Modadrop 登入驗證碼：${code}`,
    intro: "你的登入驗證碼：",
    note: "驗證碼 10 分鐘內有效。如果不是你本人要求的，請忽略這封電郵，你的帳戶不會有任何改變。",
  },
  stilist: {
    alarmTitle: (n: number) => `助手提示：${n} 件新的相符商品`,
    /** `what` is the search in quotes, or `yourSearch`. */
    interestTitle: (what: string, n: number) => (n === 1 ? `${what}有新貨` : `${what}有 ${n} 件新貨`),
    yourSearch: "你搜尋的商品",
    interestBody: (item: string) => `${item} 剛剛到貨。`,
  },
};
