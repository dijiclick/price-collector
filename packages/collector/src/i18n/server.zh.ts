import type { ServerCopyPartial } from "./server";

/**
 * Simplified Chinese server copy: pushes and alert emails. Translated from
 * server.en.ts (same keys; amounts and percentages arrive formatted), with
 * server.tr.ts for the voice. Chinese needs no plural forms and no spaces
 * around words; `news.and` / `welcome.and` join brand lists.
 */
export const zh: ServerCopyPartial = {
  alert: {
    restock: (size: string | null) => (size ? `${size} 码已补货 🎉` : "已补货 🎉"),
    target: (drop: string) => `🎯 已达到你的目标价 — ${drop}`,
    refund: (saving: string, now: string) => `比你买的时候便宜了 ${saving}：现价 ${now}。可以退货后重新下单。`,
    withSize: (size: string, base: string) => `${size} 码 · ${base}`,
  },
  email: {
    size: (s: string) => `${s} 码`,
    restock: (s: string | null) => (s ? `${s} 码已补货 🎉` : "已补货 🎉"),
    hitTarget: "🎯 已达到目标价",
    headingBack: "你关注的商品已补货 🎉",
    heading: "你的关注清单有新动态 🎉",
    footer: "Modadrop · 价格提醒。你收到这封邮件，是因为你关注了这些商品。",
    unsubscribe: "取消订阅",
    subjectBack: (n: number) => `你关注的 ${n} 件商品已补货`,
    subject: (n: number) => `你关注的 ${n} 件商品有新动态`,
  },
  news: {
    and: "和",
    digestTitle: (n: number) => `你关注的品牌有 ${n} 件新降价`,
    digestBody: (brands: string) => `${brands} 刚刚降价了。趁你的尺码还在，快去看看。`,
    saleStartTitle: (brand: string) => `${brand} 打折开始了`,
    saleStartBody: "看看你关注的商品和尺码，抢先下手。",
  },
  saleCalendar: {
    "1111-eve-2026": { title: "明天就是双十一", body: "现在就关注想要的商品，降价第一时间通知你。" },
    "efsane-cuma-eve-2026": { title: "明天就是黑色星期五", body: "现在关注心仪的商品，一降价或你的尺码到货，我们马上告诉你。" },
  },
  reminder: {
    title: "我们一直在帮你盯着 👀",
    body: (n: number) =>
      `我们正在关注你的 ${n} 件商品：降价或你的尺码到货时会通知你。现在先看看今天的折扣吧。`,
  },
  welcome: {
    and: "和",
    drops1Title: (n: number, pct: string) => `今天有 ${n} 件商品降价 ${pct} 以上`,
    drops1Body: (brands: string) => `今天降价最多的是 ${brands}。趁你的尺码还在，快去看看。`,
    deal3Title: (brand: string, pct: string) => `${brand}：直降 ${pct}`,
    deal3Body: (name: string, price: string) => `${name} 现价 ${price}。点 ♡ 关注，再降价我们会第一时间告诉你。`,
    look5Title: "为你挑选的一套穿搭",
    look5Body: "我们的造型师用今天的折扣单品搭了一套。每件单品都能一键替换。",
    week7Title: (n: string) => `本周新增 ${n} 件折扣`,
    week7Body: "关注一件你喜欢的商品，我们只会通知你关心的内容。",
  },
  signIn: {
    subject: (code: string) => `你的 Modadrop 登录验证码：${code}`,
    intro: "你的登录验证码：",
    note: "验证码 10 分钟内有效。如果不是你本人申请的，请忽略这封邮件，你的账户不会有任何变化。",
  },
  stilist: {
    alarmTitle: (n: number) => `助手提醒：${n} 件新匹配`,
    interestTitle: (what: string, n: number) => (n === 1 ? `${what} 有新品` : `${what} 有 ${n} 件新品`),
    yourSearch: "你的搜索",
    interestBody: (item: string) => `${item} 刚刚上架。`,
  },
};
