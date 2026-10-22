import type { ServerCopyPartial } from "./server";

/**
 * French server copy: pushes and alert emails. Translated from server.en.ts
 * (same keys; amounts and percentages arrive formatted, "1 310,00 €" / "30 %"),
 * with server.tr.ts for the voice: "tu", warm, short. Written for France,
 * Belgium, Switzerland and Canada alike — no regional words.
 *
 * French puts a narrow no-break space (U+202F) before : ; ! ? so the sign never
 * wraps onto a line of its own.
 */
export const fr: ServerCopyPartial = {
  alert: {
    restock: (size: string | null) => (size ? `La taille ${size} est de retour en stock 🎉` : "De retour en stock 🎉"),
    target: (drop: string) => `🎯 Prix cible atteint — ${drop}`,
    refund: (saving: string, now: string) => `${saving} de moins que ton prix d’achat : ${now}. Tu peux le retourner et le racheter.`,
    withSize: (size: string, base: string) => `Taille ${size} · ${base}`,
  },
  email: {
    size: (s: string) => `Taille ${s}`,
    restock: (s: string | null) => (s ? `La taille ${s} est de retour en stock 🎉` : "De retour en stock 🎉"),
    hitTarget: "🎯 Prix cible atteint",
    headingBack: "Ce que tu suis est de retour en stock 🎉",
    heading: "Du nouveau dans ta liste de suivi 🎉",
    footer: "Modadrop · alertes prix. Tu reçois cet e-mail parce que tu suis ces articles.",
    unsubscribe: "Se désabonner",
    subjectBack: (n: number) =>
      n === 1 ? "1 article que tu suis est de retour en stock" : `${n} articles que tu suis sont de retour en stock`,
    subject: (n: number) => `Du nouveau sur ${n} ${n === 1 ? "article" : "articles"} que tu suis`,
  },
  news: {
    and: "et",
    digestTitle: (n: number) => `${n} ${n === 1 ? "nouvelle promo" : "nouvelles promos"} chez tes marques`,
    digestBody: (brands: string) => `${brands} : les prix viennent de baisser. Jette un œil avant que ta taille parte.`,
    // "chez" takes any brand name as it is — no article, no elision to get wrong.
    saleStartTitle: (brand: string) => `Les promos ont commencé chez ${brand}`,
    saleStartBody: "Jette un œil à tes articles suivis et à ta taille avant tout le monde.",
  },
  saleCalendar: {
    "1111-eve-2026": { title: "Le 11.11, c’est demain", body: "Suis dès maintenant ce qui te plaît : on te prévient en premier dès que le prix baisse." },
    "efsane-cuma-eve-2026": { title: "Le Black Friday, c’est demain", body: "Suis tes coups de cœur dès maintenant : on te prévient dès que le prix baisse ou que ta taille revient." },
  },
  reminder: {
    title: "On surveille toujours pour toi 👀",
    body: (n: number) =>
      `On surveille ${n === 1 ? "ton article" : `tes ${n} articles`} : on te prévient quand le prix baisse ou que ta taille revient. En attendant, jette un œil aux promos du jour.`,
  },
  welcome: {
    and: " et ",
    drops1Title: (n: number, pct: string) => `${n} ${n === 1 ? "article réduit" : "articles réduits"} de ${pct} ou plus aujourd’hui`,
    drops1Body: (brands: string) => `En tête des promos du jour : ${brands}. Jette un œil avant que ta taille parte.`,
    deal3Title: (brand: string, pct: string) => `${brand} : ${pct} de remise`,
    deal3Body: (name: string, price: string) => `${name} passe à ${price}. Touche ♡ pour suivre l’article — on te prévient si le prix baisse encore.`,
    look5Title: "Une tenue choisie pour toi",
    look5Body: "Notre styliste a composé une tenue avec les promos du jour. Change n’importe quelle pièce d’une seule touche.",
    week7Title: (n: string) => `${n} ${n === "1" ? "nouvelle promo" : "nouvelles promos"} cette semaine`,
    week7Body: "Suis un article qui te plaît : on ne te parlera que de ce qui t’intéresse.",
  },
  signIn: {
    subject: (code: string) => `Ton code de connexion Modadrop : ${code}`,
    intro: "Ton code de connexion :",
    note: "Le code est valable 10 minutes. Si tu ne l’as pas demandé, ignore cet e-mail : rien ne change sur ton compte.",
  },
  stilist: {
    alarmTitle: (n: number) => `Ton alarme : ${n} ${n === 1 ? "nouveau résultat" : "nouveaux résultats"}`,
    interestTitle: (what: string, n: number) => (n === 1 ? `Du nouveau pour ${what}` : `${n} nouveautés pour ${what}`),
    yourSearch: "ta recherche",
    interestBody: (item: string) => `${item} vient d’arriver.`,
  },
};
