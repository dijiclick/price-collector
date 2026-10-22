import type { ServerCopyPartial } from "./server";

/**
 * German server copy: pushes and alert emails. Translate from server.en.ts (same
 * keys; amounts and percentages arrive formatted), with server.tr.ts for the
 * voice. Every key is optional — anything left out is sent in English — and a
 * key server.en.ts does not have fails to compile.
 *
 * Same words as the app (strings.de.ts): beobachten, Wunschpreis, Deals.
 */
export const de: ServerCopyPartial = {
  alert: {
    restock: (size: string | null) => (size ? `Größe ${size} ist wieder verfügbar 🎉` : "Wieder verfügbar 🎉"),
    target: (drop: string) => `🎯 Wunschpreis erreicht – ${drop}`,
    refund: (saving: string, now: string) => `${saving} günstiger als bezahlt: jetzt ${now}. Zurückschicken und günstiger neu kaufen.`,
    withSize: (size: string, base: string) => `Größe ${size} · ${base}`,
  },
  email: {
    size: (s: string) => `Größe ${s}`,
    restock: (s: string | null) => (s ? `Größe ${s} ist wieder verfügbar 🎉` : "Wieder verfügbar 🎉"),
    hitTarget: "🎯 Wunschpreis erreicht",
    headingBack: "Was du beobachtest, ist wieder verfügbar 🎉",
    heading: "Neues von deiner Beobachtungsliste 🎉",
    footer: "Modadrop · Preisalarme. Du bekommst diese E-Mail, weil du diese Produkte beobachtest.",
    unsubscribe: "Abmelden",
    subjectBack: (n: number) =>
      n === 1 ? "1 beobachtetes Produkt ist wieder verfügbar" : `${n} beobachtete Produkte sind wieder verfügbar`,
    subject: (n: number) => `Neues zu ${n} ${n === 1 ? "beobachtetem Produkt" : "beobachteten Produkten"}`,
  },
  news: {
    and: "und",
    digestTitle: (n: number) => `${n} ${n === 1 ? "neue Preissenkung" : "neue Preissenkungen"} bei deinen Marken`,
    digestBody: (brands: string) => `${brands}: Die Preise sind gerade gefallen. Schau rein, bevor deine Größe weg ist.`,
    saleStartTitle: (brand: string) => `Der Sale bei ${brand} hat begonnen`,
    saleStartBody: "Check deine beobachteten Artikel und Größen, bevor sie weg sind.",
  },
  saleCalendar: {
    "1111-eve-2026": { title: "Morgen ist 11.11", body: "Beobachte jetzt, was du willst, und erfahre als Erstes, wenn der Preis fällt." },
    "efsane-cuma-eve-2026": { title: "Morgen ist Black Friday", body: "Beobachte jetzt deine Favoriten – wir melden uns, sobald die Preise fallen." },
  },
  reminder: {
    title: "Wir behalten alles im Blick 👀",
    body: (n: number) =>
      `Wir beobachten ${n === 1 ? "deinen Artikel" : `deine ${n} Artikel`}: Du erfährst es, wenn der Preis sinkt oder deine Größe wieder da ist. Schau dir solange die Deals von heute an.`,
  },
  welcome: {
    and: " und ",
    drops1Title: (n: number, pct: string) => `Heute ${n} Artikel mit ${pct}+ Rabatt`,
    drops1Body: (brands: string) => `${brands} ${/ und /.test(brands) ? "liegen" : "liegt"} heute vorn. Schau rein, bevor deine Größe weg ist.`,
    deal3Title: (brand: string, pct: string) => `${brand}: ${pct} Rabatt`,
    deal3Body: (name: string, price: string) => `${name} kostet jetzt ${price}. Mit ♡ beobachten – wir melden uns, wenn der Preis weiter fällt.`,
    look5Title: "Ein Look, nur für dich",
    look5Body: "Unser Stylist hat aus den Deals von heute ein Outfit zusammengestellt. Tausche jedes Teil mit einem Tipp.",
    week7Title: (n: string) => `${n} neue Deals diese Woche`,
    week7Body: "Beobachte einen Artikel, der dir gefällt – dann melden wir uns nur zu dem, was dich interessiert.",
  },
  signIn: {
    subject: (code: string) => `Dein Modadrop-Anmeldecode: ${code}`,
    intro: "Dein Anmeldecode:",
    note: "Der Code ist 10 Minuten gültig. Wenn du ihn nicht angefordert hast, ignoriere diese E-Mail – an deinem Konto ändert sich nichts.",
  },
  stilist: {
    alarmTitle: (n: number) => `Suchalarm: ${n} ${n === 1 ? "neuer Treffer" : "neue Treffer"}`,
    interestTitle: (what: string, n: number) => (n === 1 ? `Neu für ${what}` : `${n} neue Treffer für ${what}`),
    yourSearch: "deine Suche",
    interestBody: (item: string) => `${item} ist gerade neu reingekommen.`,
  },
};
