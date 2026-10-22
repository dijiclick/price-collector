import type { ServerCopyPartial } from "./server";

/**
 * Dutch server copy: pushes and alert emails. Translated from server.en.ts
 * (same keys; amounts and percentages arrive formatted), with server.tr.ts for
 * the voice. Informal "je", neutral between the Netherlands and Flanders.
 */
export const nl: ServerCopyPartial = {
  alert: {
    restock: (size: string | null) => (size ? `Maat ${size} is weer op voorraad 🎉` : "Weer op voorraad 🎉"),
    target: (drop: string) => `🎯 Je streefprijs is bereikt — ${drop}`,
    refund: (saving: string, now: string) => `${saving} goedkoper dan je betaalde: ${now}. Je kunt het retourneren en opnieuw kopen.`,
    withSize: (size: string, base: string) => `Maat ${size} · ${base}`,
  },
  email: {
    size: (s: string) => `Maat ${s}`,
    restock: (s: string | null) => (s ? `Maat ${s} is weer op voorraad 🎉` : "Weer op voorraad 🎉"),
    hitTarget: "🎯 Streefprijs bereikt",
    headingBack: "Wat je volgt is weer op voorraad 🎉",
    heading: "Nieuws over je volglijst 🎉",
    footer: "Modadrop · prijsalerts. Je krijgt deze e-mail omdat je deze producten volgt.",
    unsubscribe: "Afmelden",
    subjectBack: (n: number) =>
      `${n} ${n === 1 ? "product dat je volgt is" : "producten die je volgt zijn"} weer op voorraad`,
    subject: (n: number) => `Nieuws over ${n} ${n === 1 ? "product dat" : "producten die"} je volgt`,
  },
  news: {
    and: "en",
    digestTitle: (n: number) => `${n} nieuwe ${n === 1 ? "prijsdaling" : "prijsdalingen"} bij je merken`,
    digestBody: (brands: string) => `${brands}: de prijzen zijn net gedaald. Kijk snel, voordat je maat op is.`,
    saleStartTitle: (brand: string) => `De sale bij ${brand} is begonnen`,
    saleStartBody: "Check je gevolgde items en maten voordat ze op zijn.",
  },
  saleCalendar: {
    "1111-eve-2026": { title: "Morgen is het 11.11", body: "Volg nu wat je wilt hebben en hoor als eerste wanneer de prijs daalt." },
    "efsane-cuma-eve-2026": { title: "Morgen is het Black Friday", body: "Volg je favorieten nu, dan laten we het je meteen weten als de prijzen dalen." },
  },
  reminder: {
    title: "We houden het voor je in de gaten 👀",
    body: (n: number) =>
      `We houden je ${n} ${n === 1 ? "item" : "items"} in de gaten: je hoort het als de prijs daalt of je maat terug is. Bekijk intussen de deals van vandaag.`,
  },
  welcome: {
    and: " en ",
    drops1Title: (n: number, pct: string) => `Vandaag ${pct}+ korting op ${n} ${n === 1 ? "item" : "items"}`,
    drops1Body: (brands: string) => `De grootste dalingen van vandaag: ${brands}. Kijk snel, voordat je maat op is.`,
    deal3Title: (brand: string, pct: string) => `${brand}: ${pct} korting`,
    deal3Body: (name: string, price: string) => `${name} kost nu ${price}. Tik op ♡ om het te volgen — we laten het je weten als het nog verder daalt.`,
    look5Title: "Een look, speciaal voor jou",
    look5Body: "Onze stylist heeft een outfit samengesteld uit de deals van vandaag. Wissel elk item met één tik.",
    week7Title: (n: string) => `${n} nieuwe deals deze week`,
    week7Body: "Volg één item dat je mooi vindt, dan hoor je voortaan alleen over wat bij jou past.",
  },
  signIn: {
    subject: (code: string) => `Je Modadrop-inlogcode: ${code}`,
    intro: "Je inlogcode:",
    note: "De code is 10 minuten geldig. Heb je hem niet aangevraagd? Negeer dan deze e-mail – er verandert niets aan je account.",
  },
  stilist: {
    alarmTitle: (n: number) => `Zoekalarm: ${n} ${n === 1 ? "nieuwe match" : "nieuwe matches"}`,
    interestTitle: (what: string, n: number) => (n === 1 ? `Nieuw voor ${what}` : `${n} nieuwe items voor ${what}`),
    yourSearch: "je zoekopdracht",
    interestBody: (item: string) => `${item} is net binnen.`,
  },
};
