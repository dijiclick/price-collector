import type { ServerCopyPartial } from "./server";

/**
 * Korean server copy: pushes and alert emails. Translated from server.en.ts
 * (same keys; amounts and percentages arrive formatted), with server.tr.ts for
 * the voice. 해요체 throughout; "track" is 찜, as in the app.
 *
 * Korean particles change with the last sound of the word before them, so no
 * particle follows a slot that can end in anything (a brand, a product name, a
 * search): the copy is phrased around them ("새 상품: ${what}", "${brands}에서").
 */
export const ko: ServerCopyPartial = {
  alert: {
    restock: (size: string | null) => (size ? `${size} 사이즈가 재입고됐어요 🎉` : "재입고됐어요 🎉"),
    target: (drop: string) => `🎯 목표가 도달 — ${drop}`,
    refund: (saving: string, now: string) => `구매가보다 ${saving} 저렴해졌어요: 지금 ${now}. 반품하고 다시 구매할 수 있어요.`,
    withSize: (size: string, base: string) => `${size} 사이즈 · ${base}`,
  },
  email: {
    size: (s: string) => `${s} 사이즈`,
    restock: (s: string | null) => (s ? `${s} 사이즈가 재입고됐어요 🎉` : "재입고됐어요 🎉"),
    hitTarget: "🎯 목표가 도달",
    headingBack: "찜한 상품이 재입고됐어요 🎉",
    heading: "찜 목록에 새 소식이 있어요 🎉",
    footer: "Modadrop · 가격 알림. 상품을 찜해 두셔서 이 메일을 보내 드렸어요.",
    unsubscribe: "수신 거부",
    subjectBack: (n: number) => `찜한 상품 ${n}개가 재입고됐어요`,
    subject: (n: number) => `찜한 상품 ${n}개에 새 소식이 있어요`,
  },
  news: {
    /** Joins the last two brand names: "Zara, Mango 및 H&M". */
    and: "및",
    digestTitle: (n: number) => `내 브랜드에 새 할인 ${n}개`,
    digestBody: (brands: string) => `${brands}에서 가격이 내려갔어요. 내 사이즈가 품절되기 전에 확인해 보세요.`,
    saleStartTitle: (brand: string) => `${brand} 세일이 시작됐어요`,
    saleStartBody: "찜한 상품과 내 사이즈를 품절 전에 확인해 보세요.",
  },
  saleCalendar: {
    "1111-eve-2026": { title: "내일은 11.11", body: "원하는 상품을 지금 찜해 두고, 가격이 내려가면 가장 먼저 알아보세요." },
    "efsane-cuma-eve-2026": { title: "내일은 블랙 프라이데이", body: "마음에 드는 상품을 지금 찜해 두세요. 가격이 내려가는 순간 알려 드릴게요." },
  },
  reminder: {
    title: "계속 지켜보고 있어요 👀",
    body: (n: number) =>
      `찜한 상품 ${n}개를 지켜보고 있어요. 가격이 내려가거나 내 사이즈가 재입고되면 알려 드릴게요. 그동안 오늘의 할인을 둘러보세요.`,
  },
  welcome: {
    and: ", ",
    drops1Title: (n: number, pct: string) => `오늘 상품 ${n}개가 ${pct} 이상 할인됐어요`,
    drops1Body: (brands: string) => `오늘은 ${brands}에서 할인이 가장 많아요. 내 사이즈가 품절되기 전에 확인해 보세요.`,
    deal3Title: (brand: string, pct: string) => `${brand}: ${pct} 할인`,
    deal3Body: (name: string, price: string) => `${name}, 지금 ${price}. ♡ 버튼으로 찜하면 가격이 더 내려갈 때 알려 드려요.`,
    look5Title: "나를 위한 코디",
    look5Body: "스타일리스트가 오늘의 할인 상품으로 코디를 완성했어요. 아이템은 탭 한 번으로 바꿀 수 있어요.",
    week7Title: (n: string) => `이번 주 새 할인 ${n}개`,
    week7Body: "마음에 드는 상품 하나를 찜해 보세요. 내 상품 소식만 골라서 알려 드릴게요.",
  },
  signIn: {
    subject: (code: string) => `Modadrop 로그인 코드: ${code}`,
    intro: "로그인 코드:",
    note: "코드는 10분 동안 유효해요. 직접 요청하지 않으셨다면 이 메일은 무시하셔도 돼요. 계정에는 아무 변화도 없어요.",
  },
  stilist: {
    alarmTitle: (n: number) => `스마트 검색 알림: 새 상품 ${n}개`,
    interestTitle: (what: string, n: number) => (n === 1 ? `새 상품: ${what}` : `새 상품 ${n}개: ${what}`),
    yourSearch: "내 검색어",
    interestBody: (item: string) => `새로 들어왔어요: ${item}`,
  },
};
