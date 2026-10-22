import type { ServerCopyPartial } from "./server";

/**
 * Danish server copy: pushes and alert emails. Translate from server.en.ts (same
 * keys; amounts and percentages arrive formatted), with server.tr.ts for the
 * voice. Every key is optional — anything left out is sent in English — and a
 * key server.en.ts does not have fails to compile.
 */
export const da: ServerCopyPartial = {
  alert: {
    restock: (size: string | null) => (size ? `Størrelse ${size} er på lager igen 🎉` : "På lager igen 🎉"),
    target: (drop: string) => `🎯 Din målpris er nået – ${drop}`,
    refund: (saving: string, now: string) => `${saving} billigere, end du betalte: ${now}. Du kan returnere den og købe den igen.`,
    withSize: (size: string, base: string) => `Str. ${size} · ${base}`,
  },
  email: {
    size: (s: string) => `Størrelse ${s}`,
    restock: (s: string | null) => (s ? `Størrelse ${s} er på lager igen 🎉` : "På lager igen 🎉"),
    hitTarget: "🎯 Målpris nået",
    headingBack: "Det, du følger, er på lager igen 🎉",
    heading: "Nyt om det, du følger 🎉",
    footer: "Modadrop · prisalarmer. Du får denne e-mail, fordi du følger disse produkter.",
    unsubscribe: "Afmeld",
    subjectBack: (n: number) =>
      `${n} ${n === 1 ? "produkt" : "produkter"}, du følger, er på lager igen`,
    subject: (n: number) => `Nyt om ${n} ${n === 1 ? "produkt" : "produkter"}, du følger`,
  },
  news: {
    and: "og",
    digestTitle: (n: number) => `${n} ${n === 1 ? "nyt prisfald" : "nye prisfald"} hos dine mærker`,
    digestBody: (brands: string) => `${brands}: Priserne er lige faldet. Kig forbi, før din størrelse er væk.`,
    saleStartTitle: (brand: string) => `Udsalget hos ${brand} er startet`,
    saleStartBody: "Tjek de varer og størrelser, du følger, før de er væk.",
  },
  saleCalendar: {
    "1111-eve-2026": { title: "11.11 er i morgen", body: "Følg det, du gerne vil have, nu, og hør det først, når prisen falder." },
    "efsane-cuma-eve-2026": { title: "Black Friday er i morgen", body: "Følg dine favoritter nu, så giver vi besked, så snart priserne falder." },
  },
  reminder: {
    title: "Vi holder stadig øje for dig 👀",
    body: (n: number) =>
      `Vi holder øje med ${n === 1 ? "din vare" : `dine ${n} varer`}: Du får besked, når prisen falder, eller din størrelse er tilbage. Se dagens tilbud imens.`,
  },
  welcome: {
    and: " og ",
    drops1Title: (n: number, pct: string) => `${n} ${n === 1 ? "vare er" : "varer er"} sat mindst ${pct} ned i dag`,
    drops1Body: (brands: string) => `${brands} fører an i dagens prisfald. Kig forbi, før din størrelse er væk.`,
    deal3Title: (brand: string, pct: string) => `${brand}: ${pct} rabat`,
    deal3Body: (name: string, price: string) => `${name} koster nu ${price}. Tryk på ♡ for at følge den – vi giver besked, hvis den falder igen.`,
    look5Title: "Et look udvalgt til dig",
    look5Body: "Vores stylist har sat et outfit sammen af dagens tilbud. Skift en del ud med ét tryk.",
    week7Title: (n: string) => `${n} nye tilbud i denne uge`,
    week7Body: "Følg én vare, du kan lide, så skriver vi kun til dig om det, der er dit.",
  },
  signIn: {
    subject: (code: string) => `Din Modadrop-loginkode: ${code}`,
    intro: "Din loginkode:",
    note: "Koden er gyldig i 10 minutter. Hvis du ikke har bedt om den, kan du se bort fra denne mail – der ændres ikke noget på din konto.",
  },
  stilist: {
    alarmTitle: (n: number) => `Smart søgning: ${n} ${n === 1 ? "nyt match" : "nye match"}`,
    interestTitle: (what: string, n: number) => (n === 1 ? `Nyt i ${what}` : `${n} nye i ${what}`),
    yourSearch: "din søgning",
    interestBody: (item: string) => `${item} er lige kommet.`,
  },
};
