import type { ServerCopyPartial } from "./server";

/**
 * Norwegian Bokmål server copy: pushes and alert emails. Translate from server.en.ts (same
 * keys; amounts and percentages arrive formatted), with server.tr.ts for the
 * voice. Every key is optional — anything left out is sent in English — and a
 * key server.en.ts does not have fails to compile.
 */
export const nb: ServerCopyPartial = {
  alert: {
    restock: (size: string | null) => (size ? `Størrelse ${size} er tilbake på lager 🎉` : "Tilbake på lager 🎉"),
    target: (drop: string) => `🎯 Målprisen er nådd – ${drop}`,
    refund: (saving: string, now: string) => `${saving} billigere enn du betalte: ${now}. Du kan returnere den og kjøpe den på nytt.`,
    withSize: (size: string, base: string) => `Størrelse ${size} · ${base}`,
  },
  email: {
    size: (s: string) => `Størrelse ${s}`,
    restock: (s: string | null) => (s ? `Størrelse ${s} er tilbake på lager 🎉` : "Tilbake på lager 🎉"),
    hitTarget: "🎯 Målprisen er nådd",
    headingBack: "Det du følger, er tilbake på lager 🎉",
    heading: "Nytt fra listen du følger 🎉",
    footer: "Modadrop · prisvarsler. Du får denne e-posten fordi du følger disse produktene.",
    unsubscribe: "Meld deg av",
    subjectBack: (n: number) => `${n} ${n === 1 ? "produkt" : "produkter"} du følger, er tilbake på lager`,
    subject: (n: number) => `Nytt om ${n} ${n === 1 ? "produkt" : "produkter"} du følger`,
  },
  news: {
    and: "og",
    digestTitle: (n: number) => `${n} ${n === 1 ? "nytt prisfall" : "nye prisfall"} hos merkene dine`,
    digestBody: (brands: string) => `${brands}: prisene har akkurat falt. Ta en titt før størrelsen din blir utsolgt.`,
    saleStartTitle: (brand: string) => `Salget hos ${brand} har startet`,
    saleStartBody: "Sjekk varene og størrelsene du følger, før de forsvinner.",
  },
  saleCalendar: {
    "1111-eve-2026": { title: "11.11 er i morgen", body: "Følg det du vil ha nå, og bli den første som får vite når prisen synker." },
    "efsane-cuma-eve-2026": { title: "Black Friday er i morgen", body: "Følg favorittene dine nå, så sier vi fra med en gang prisene faller." },
  },
  reminder: {
    title: "Vi følger fortsatt med for deg 👀",
    body: (n: number) =>
      `Vi følger med på ${n === 1 ? "varen din" : `de ${n} varene dine`}: du får beskjed når prisen synker eller størrelsen din er tilbake. I mellomtiden kan du se dagens tilbud.`,
  },
  welcome: {
    and: " og ",
    drops1Title: (n: number, pct: string) => `${n} ${n === 1 ? "vare" : "varer"} satt ned minst ${pct} i dag`,
    drops1Body: (brands: string) => `${brands} leder dagens prisfall. Ta en titt før størrelsen din blir utsolgt.`,
    deal3Title: (brand: string, pct: string) => `${brand}: ${pct} rabatt`,
    deal3Body: (name: string, price: string) => `${name} koster nå ${price}. Trykk ♡ for å følge den – vi sier fra hvis den synker igjen.`,
    look5Title: "En look valgt ut til deg",
    look5Body: "Stylisten vår har satt sammen et antrekk av dagens tilbud. Bytt ut hvilket som helst plagg med ett trykk.",
    week7Title: (n: string) => `${n} nye tilbud denne uken`,
    week7Body: "Følg en vare du liker, så får du bare beskjed om det som gjelder deg.",
  },
  signIn: {
    subject: (code: string) => `Innloggingskoden din for Modadrop: ${code}`,
    intro: "Innloggingskoden din:",
    note: "Koden er gyldig i 10 minutter. Hvis du ikke ba om den, kan du se bort fra denne e-posten – ingenting endres på kontoen din.",
  },
  stilist: {
    alarmTitle: (n: number) => `Søkealarm: ${n} ${n === 1 ? "nytt treff" : "nye treff"}`,
    interestTitle: (what: string, n: number) => (n === 1 ? `Nytt treff på ${what}` : `${n} nye treff på ${what}`),
    yourSearch: "søket ditt",
    interestBody: (item: string) => `${item} har akkurat kommet.`,
  },
};
