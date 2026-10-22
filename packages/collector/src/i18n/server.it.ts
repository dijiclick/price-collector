import type { ServerCopyPartial } from "./server";

/**
 * Italian server copy: pushes and alert emails. Translate from server.en.ts (same
 * keys; amounts and percentages arrive formatted), with server.tr.ts for the
 * voice. Every key is optional — anything left out is sent in English — and a
 * key server.en.ts does not have fails to compile.
 */
export const it: ServerCopyPartial = {
  alert: {
    restock: (size: string | null) => (size ? `Taglia ${size} di nuovo disponibile 🎉` : "Di nuovo disponibile 🎉"),
    target: (drop: string) => `🎯 Obiettivo raggiunto: ${drop}`,
    refund: (saving: string, now: string) => `${saving} in meno di quanto hai pagato: ora costa ${now}. Puoi restituirlo e ricomprarlo.`,
    withSize: (size: string, base: string) => `Taglia ${size} · ${base}`,
  },
  email: {
    size: (s: string) => `Taglia ${s}`,
    restock: (s: string | null) => (s ? `Taglia ${s} di nuovo disponibile 🎉` : "Di nuovo disponibile 🎉"),
    hitTarget: "🎯 Obiettivo raggiunto",
    headingBack: "Quello che segui è di nuovo disponibile 🎉",
    heading: "Novità dai prodotti che segui 🎉",
    footer: "Modadrop · avvisi sui prezzi. Ricevi questa email perché segui questi prodotti.",
    unsubscribe: "Annulla l’iscrizione",
    subjectBack: (n: number) =>
      n === 1 ? "1 prodotto che segui è di nuovo disponibile" : `${n} prodotti che segui sono di nuovo disponibili`,
    subject: (n: number) => `Novità su ${n} ${n === 1 ? "prodotto" : "prodotti"} che segui`,
  },
  news: {
    and: "e",
    digestTitle: (n: number) => `${n} ${n === 1 ? "nuovo ribasso" : "nuovi ribassi"} nei tuoi brand`,
    digestBody: (brands: string) => `${brands}: i prezzi sono appena scesi. Dai un’occhiata prima che finisca la tua taglia.`,
    saleStartTitle: (brand: string) => `Al via gli sconti: ${brand}`,
    saleStartBody: "Controlla i prodotti che segui e le tue taglie prima che finiscano.",
  },
  saleCalendar: {
    "1111-eve-2026": { title: "Domani è l’11.11", body: "Segui ora quello che vuoi e scopri subito quando il prezzo scende." },
    "efsane-cuma-eve-2026": { title: "Domani è il Black Friday", body: "Segui ora i tuoi preferiti e ti avvisiamo appena i prezzi scendono." },
  },
  reminder: {
    title: "Continuiamo a controllare per te 👀",
    body: (n: number) =>
      `Stiamo seguendo ${n === 1 ? "il tuo prodotto" : `i tuoi ${n} prodotti`}: ti avvisiamo quando il prezzo scende o torna la tua taglia. Intanto, guarda le offerte di oggi.`,
  },
  welcome: {
    and: " e ",
    drops1Title: (n: number, pct: string) => `Oggi ${n} ${n === 1 ? "prodotto scontato" : "prodotti scontati"} del ${pct} o più`,
    drops1Body: (brands: string) => `In testa ai ribassi di oggi: ${brands}. Dai un’occhiata prima che finisca la tua taglia.`,
    deal3Title: (brand: string, pct: string) => `${brand}: ${pct} di sconto`,
    deal3Body: (name: string, price: string) => `${name} ora costa ${price}. Tocca ♡ per seguirlo: ti avvisiamo se scende ancora.`,
    look5Title: "Un look scelto per te",
    look5Body: "Il nostro stylist ha creato un outfit con le offerte di oggi. Cambia qualsiasi capo con un tocco.",
    week7Title: (n: string) => `${n} nuove offerte questa settimana`,
    week7Body: "Segui un prodotto che ti piace: ti avviseremo solo sui prodotti che segui.",
  },
  signIn: {
    subject: (code: string) => `Il tuo codice di accesso a Modadrop: ${code}`,
    intro: "Il tuo codice di accesso:",
    note: "Il codice è valido per 10 minuti. Se non l’hai richiesto tu, ignora questa email: sul tuo account non cambia nulla.",
  },
  stilist: {
    alarmTitle: (n: number) => `Allarme assistente: ${n} ${n === 1 ? "nuovo risultato" : "nuovi risultati"}`,
    interestTitle: (what: string, n: number) => (n === 1 ? `Novità per ${what}` : `${n} novità per ${what}`),
    yourSearch: "la tua ricerca",
    interestBody: (item: string) => `Nuovo arrivo: ${item}.`,
  },
};
