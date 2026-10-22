import type { ServerCopyPartial } from "./server";

/**
 * Swedish server copy: pushes and alert emails. Translate from server.en.ts (same
 * keys; amounts and percentages arrive formatted), with server.tr.ts for the
 * voice. Every key is optional — anything left out is sent in English — and a
 * key server.en.ts does not have fails to compile.
 *
 * "Track" is "bevaka" throughout (Prisjakt's and Tradera's word), matching the app.
 */
export const sv: ServerCopyPartial = {
  alert: {
    restock: (size: string | null) => (size ? `Storlek ${size} är tillbaka i lager 🎉` : "Tillbaka i lager 🎉"),
    target: (drop: string) => `🎯 Ditt målpris är nått — ${drop}`,
    refund: (saving: string, now: string) => `${saving} billigare än du betalade: ${now}. Du kan returnera den och köpa den igen.`,
    withSize: (size: string, base: string) => `Storlek ${size} · ${base}`,
  },
  email: {
    size: (s: string) => `Storlek ${s}`,
    restock: (s: string | null) => (s ? `Storlek ${s} är tillbaka i lager 🎉` : "Tillbaka i lager 🎉"),
    hitTarget: "🎯 Målpriset är nått",
    headingBack: "Det du bevakar är tillbaka i lager 🎉",
    heading: "Nytt från din bevakningslista 🎉",
    footer: "Modadrop · prisbevakning. Du får det här mejlet eftersom du bevakar de här produkterna.",
    unsubscribe: "Avsluta prenumerationen",
    subjectBack: (n: number) =>
      n === 1 ? `${n} produkt du bevakar är tillbaka i lager` : `${n} produkter du bevakar är tillbaka i lager`,
    subject: (n: number) => `Nytt om ${n} ${n === 1 ? "produkt" : "produkter"} du bevakar`,
  },
  news: {
    and: "och",
    digestTitle: (n: number) => `${n} ${n === 1 ? "ny prissänkning" : "nya prissänkningar"} hos dina märken`,
    digestBody: (brands: string) => `${brands}: priserna har precis sänkts. Kika innan din storlek tar slut.`,
    // Not "${brand}-rean": the hyphenated compound reads oddly after brand
    // names with spaces or symbols, so the brand goes last, as in Turkish.
    saleStartTitle: (brand: string) => `Rean har börjat hos ${brand}`,
    saleStartBody: "Kolla dina bevakade varor och storlekar innan de tar slut.",
  },
  saleCalendar: {
    "1111-eve-2026": { title: "Imorgon är det 11.11", body: "Bevaka det du vill ha nu, så får du veta först när priset sjunker." },
    "efsane-cuma-eve-2026": { title: "Imorgon är det Black Friday", body: "Bevaka dina favoriter nu, så säger vi till direkt när priserna sjunker." },
  },
  reminder: {
    title: "Vi håller utkik åt dig 👀",
    body: (n: number) =>
      `Vi bevakar ${n === 1 ? "din vara" : `dina ${n} varor`}: du får veta när priset sjunker eller din storlek är tillbaka. Kika under tiden på dagens erbjudanden.`,
  },
  welcome: {
    and: " och ",
    drops1Title: (n: number, pct: string) => `${n} ${n === 1 ? "vara har" : "varor har"} sänkts med ${pct} eller mer idag`,
    drops1Body: (brands: string) => `${brands} leder dagens prissänkningar. Kika innan din storlek tar slut.`,
    deal3Title: (brand: string, pct: string) => `${brand}: ${pct} rabatt`,
    deal3Body: (name: string, price: string) => `${name} kostar nu ${price}. Tryck på ♡ för att bevaka den – vi säger till om priset sjunker igen.`,
    look5Title: "En look utvald åt dig",
    look5Body: "Vår stylist har satt ihop en outfit av dagens erbjudanden. Byt ut vilket plagg som helst med ett tryck.",
    week7Title: (n: string) => `${n} nya erbjudanden den här veckan`,
    week7Body: "Bevaka en vara du gillar, så hör vi bara av oss om det som är ditt.",
  },
  signIn: {
    subject: (code: string) => `Din inloggningskod till Modadrop: ${code}`,
    intro: "Din inloggningskod:",
    note: "Koden gäller i 10 minuter. Om du inte har bett om den kan du ignorera det här mejlet – inget ändras på ditt konto.",
  },
  stilist: {
    alarmTitle: (n: number) => `Assistentlarm: ${n} ${n === 1 ? "ny träff" : "nya träffar"}`,
    interestTitle: (what: string, n: number) => (n === 1 ? `Ny träff på ${what}` : `${n} nya träffar på ${what}`),
    yourSearch: "din sökning",
    interestBody: (item: string) => `${item} har precis kommit.`,
  },
};
