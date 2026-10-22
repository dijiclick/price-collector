import type { ServerCopyPartial } from "./server";

/**
 * Japanese server copy: pushes and alert emails. Translated from server.en.ts
 * (same keys; amounts and percentages arrive formatted), with server.tr.ts for
 * the voice. Same register as the app (strings.ja.ts): です/ます in sentences,
 * and "track" is お気に入り, the word the app uses for its heart.
 */

/** The search summary arrives in English curly quotes (stilist-alarms.ts); Japanese quotes with 「」. */
const jaQuote = (what: string) => what.replace(/^“([\s\S]*)”$/, "「$1」");

export const ja: ServerCopyPartial = {
  alert: {
    restock: (size: string | null) => (size ? `${size}サイズが再入荷しました 🎉` : "再入荷しました 🎉"),
    target: (drop: string) => `🎯 目標価格に到達 — ${drop}`,
    refund: (saving: string, now: string) => `購入時より${saving}安くなりました（現在${now}）。返品して買い直すことができます。`,
    withSize: (size: string, base: string) => `サイズ ${size} · ${base}`,
  },
  email: {
    size: (s: string) => `サイズ ${s}`,
    restock: (s: string | null) => (s ? `${s}サイズが再入荷しました 🎉` : "再入荷しました 🎉"),
    hitTarget: "🎯 目標価格に到達",
    headingBack: "お気に入りの商品が再入荷しました 🎉",
    heading: "お気に入りの商品のお知らせ 🎉",
    footer: "Modadrop · 価格のお知らせ。商品をお気に入りに登録されているため、このメールをお送りしています。",
    unsubscribe: "配信停止",
    subjectBack: (n: number) => `お気に入りの商品${n}点が再入荷しました`,
    subject: (n: number) => `お気に入りの商品${n}点のお知らせ`,
  },
  news: {
    and: "と",
    digestTitle: (n: number) => `フォロー中のブランドで${n}点が値下げ`,
    digestBody: (brands: string) => `${brands}が値下げしました。サイズがなくなる前にチェックしましょう。`,
    saleStartTitle: (brand: string) => `${brand}のセールが始まりました`,
    saleStartBody: "お気に入りの商品とサイズを、売り切れる前にチェックしましょう。",
  },
  saleCalendar: {
    "1111-eve-2026": { title: "明日は11.11", body: "欲しいものを今のうちにお気に入り登録して、値下がりをいち早くキャッチしましょう。" },
    "efsane-cuma-eve-2026": { title: "明日はブラックフライデー", body: "気になるアイテムをお気に入りに登録しておけば、値下がりした瞬間にお知らせします。" },
  },
  reminder: {
    title: "引き続きチェックしています 👀",
    body: (n: number) =>
      `お気に入りの${n}点をチェック中です。値下がりやサイズの再入荷があればお知らせします。それまでに今日のセールもご覧ください。`,
  },
  welcome: {
    and: "と",
    drops1Title: (n: number, pct: string) => `今日は${n}点が${pct}以上値下がり`,
    drops1Body: (brands: string) => `今日は${brands}の値下げが目立ちます。サイズがなくなる前にチェックしましょう。`,
    deal3Title: (brand: string, pct: string) => `${brand}：${pct}オフ`,
    deal3Body: (name: string, price: string) => `${name}が${price}に。♡でお気に入り登録すると、さらに値下がりしたときにお知らせします。`,
    look5Title: "あなたにおすすめのコーデ",
    look5Body: "スタイリストが今日のセールアイテムでコーデを組みました。アイテムはワンタップで入れ替えられます。",
    week7Title: (n: string) => `今週の新着セール${n}件`,
    week7Body: "気になるアイテムをひとつお気に入りに登録すれば、あなたに関係のあるお知らせだけをお届けします。",
  },
  signIn: {
    subject: (code: string) => `Modadropのログインコード：${code}`,
    intro: "ログインコード：",
    note: "コードの有効期限は10分です。お心当たりがない場合は、このメールを無視してください。アカウントには何の変更もありません。",
  },
  stilist: {
    alarmTitle: (n: number) => `スマート検索アラート：新たに${n}件が一致`,
    interestTitle: (what: string, n: number) => (n === 1 ? `${jaQuote(what)}の新着` : `${jaQuote(what)}の新着${n}件`),
    yourSearch: "保存した検索",
    interestBody: (item: string) => `新着：${item}`,
  },
};
