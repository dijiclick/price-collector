import type { ServerCopy } from "./server";

/** Turkish: the original copy, and the voice every other language matches. Complete. */
export const tr: ServerCopy = {
  alert: {
    line: (was: string, now: string) => `${was} yerine ${now}.`,
    restock: (size: string | null) => (size ? `${size} beden geri geldi` : "Yeniden stokta"),
    target: (drop: string) => `Hedef fiyatına ulaştı. ${drop}`,
    refund: (saving: string, now: string) => `Aldığından ${saving} daha ucuz: ${now}. İade koşullarını kontrol et.`,
    withSize: (size: string, base: string) => `${size} beden. ${base}`,
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
    digestBody: (brands: string) => `${brands} fiyatlarını düşürdü.`,
    // No locative suffix ('da/'de/'ta/'te): it depends on how each brand name
    // ends and sounds, and a wrong one reads as a machine wrote it.
    saleStartTitle: (brand: string) => `İndirim başladı: ${brand}`,
    saleStartBody: "Takip ettiğin ürünlerin fiyatına bak.",
  },
  daily: {
    fromFollowed: 'Takip ettiğin markadan',
    onSale: (b: string) => `${b}: indirimde`,
    saleStarted: (b: string) => `${b}: indirim başladı`,
    justAdded: (b: string) => `${b}: yeni eklendi`,
  },
  saleCalendar: {
    "1111-eve-2026": { title: "11.11 yarın", body: "Beğendiklerini takibe al, fiyatı düşünce haber verelim." },
    "efsane-cuma-eve-2026": { title: "Efsane Cuma yarın", body: "Beğendiklerini takibe al; fiyatı düşünce ya da bedenin gelince haber verelim." },
  },
  reminder: {
    title: "Listendekiler",
    body: (n: number) => `${n} ürün listende. Fiyatı düşerse ya da bedenin gelirse haber veririz.`,
  },
  welcome: {
    and: " ve ",
    drops1Title: (n: number, pct: string) => `Bugün ${n} üründe ${pct} ve üzeri indirim`,
    drops1Body: (brands: string) => `${brands} bugünün indirimlerinde.`,
    deal3Title: (brand: string, pct: string) => `${brand}: ${pct} indirim`,
    deal3Body: (name: string, price: string) => `${name} şimdi ${price}. Takibe al, fiyatı düşünce haber verelim.`,
    look5Title: "Bugünün kombini",
    look5Body: "Bugünün indirimlerinden bir kombin. Her parçayı değiştirebilirsin.",
    week7Title: (n: string) => `Bu hafta ${n} yeni indirim`,
    week7Body: "Beğendiğin bir ürünü takibe al, fiyatı düşünce haber verelim.",
  },
  signIn: {
    subject: (code: string) => `Modadrop giriş kodun: ${code}`,
    intro: "Giriş kodun:",
    note: "Kod 10 dakika geçerli. Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin — hesabında hiçbir şey değişmez.",
  },
  stilist: {
    alarmFor: (q: string) => `Aradığın: ${q}`,
    alarmTitle: (n: number) => `Aradığın üründen ${n} yeni model`,
    interestTitle: (what: string, n: number) => (n === 1 ? `${what} için yeni ürün` : `${what} için ${n} yeni ürün`),
    yourSearch: "aradığın ürün",
    interestBody: (item: string) => `${item} yeni geldi.`,
  },
};
