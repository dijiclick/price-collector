import type { ServerCopy } from "./server";

/** Turkish: the original copy, and the voice every other language matches. Complete. */
export const tr: ServerCopy = {
  alert: {
    restock: (size: string | null) => (size ? `Beden ${size} tekrar stokta 🎉` : "Tekrar stokta 🎉"),
    target: (drop: string) => `🎯 Hedefe ulaştı — ${drop}`,
    refund: (saving: string, now: string) => `Aldığından ${saving} ucuz: ${now}. İade edip yeniden alabilirsin.`,
    withSize: (size: string, base: string) => `Beden ${size} · ${base}`,
  },
  email: {
    size: (s: string) => `Beden ${s}`,
    restock: (s: string | null) => (s ? `Beden ${s} tekrar stokta 🎉` : "Tekrar stokta 🎉"),
    hitTarget: "🎯 Hedefine ulaştı",
    headingBack: "Takip ettiğin ürünler tekrar stokta 🎉",
    heading: "Takip listenden haberler 🎉",
    footer: "Modadrop · fiyat alarmı. Bu bildirimi takip listene eklediğin için aldın.",
    unsubscribe: "Aboneliği kaldır",
    subjectBack: (n: number) => `${n} takip ettiğin ürün tekrar stokta`,
    subject: (n: number) => `${n} takip ettiğin ürün için haber var`,
  },
  news: {
    and: "ve",
    digestTitle: (n: number) => `Takip ettiğin markalarda ${n} yeni indirim`,
    digestBody: (brands: string) => `${brands} fiyatlarını düşürdü. Bedenin tükenmeden göz at.`,
    // No locative suffix ('da/'de/'ta/'te): it depends on how each brand name
    // ends and sounds, and a wrong one reads as a machine wrote it.
    saleStartTitle: (brand: string) => `İndirim başladı: ${brand}`,
    saleStartBody: "Takip ettiğin ürünlere ve bedenine bak, ilk sen yakala.",
  },
  saleCalendar: {
    "1111-eve-2026": { title: "Yarın 11.11", body: "İstediğin ürünleri şimdi takibe al, fiyatı düşünce ilk sen öğren." },
    "efsane-cuma-eve-2026": { title: "Yarın Efsane Cuma", body: "Beğendiklerini takibe al; fiyatı düşünce ya da bedenin gelince haber verelim." },
  },
  reminder: {
    title: "Takibin sürüyor 👀",
    body: (n: number) =>
      `${n} ürününü izliyoruz: fiyatı düşünce ya da bedenin gelince haber vereceğiz. Bu arada bugünkü indirimlere göz at.`,
  },
  welcome: {
    and: " ve ",
    drops1Title: (n: number, pct: string) => `Bugün ${n} üründe ${pct}+ indirim`,
    drops1Body: (brands: string) => `${brands} başı çekiyor. Bedenin tükenmeden göz at.`,
    deal3Title: (brand: string, pct: string) => `${brand}: ${pct} indirim`,
    deal3Body: (name: string, price: string) => `${name} şimdi ${price}. ♡ ile takibe al, daha da düşerse ilk sen öğren.`,
    look5Title: "Sana özel bir kombin",
    look5Body: "Stilistimiz bugünün indirimlerinden bir kombin hazırladı. Her parçayı tek dokunuşla değiştir.",
    week7Title: (n: string) => `Bu hafta ${n} yeni indirim`,
    week7Body: "Beğendiğin bir ürünü takibe al, sadece senin ürünlerin için haber verelim.",
  },
  signIn: {
    subject: (code: string) => `Modadrop giriş kodun: ${code}`,
    intro: "Giriş kodun:",
    note: "Kod 10 dakika geçerli. Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin — hesabında hiçbir şey değişmez.",
  },
  stilist: {
    alarmTitle: (n: number) => `Asistan alarmı: ${n} yeni eşleşme`,
    interestTitle: (what: string, n: number) => (n === 1 ? `${what} için yeni ürün` : `${what} için ${n} yeni ürün`),
    yourSearch: "aradığın ürün",
    interestBody: (item: string) => `${item} yeni geldi.`,
  },
};
