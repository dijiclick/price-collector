import type { ServerCopyPartial } from "./server";

/**
 * European Portuguese server copy: pushes and alert emails. Translate from server.en.ts (same
 * keys; amounts and percentages arrive formatted), with server.tr.ts for the
 * voice. Every key is optional — anything left out is sent in English — and a
 * key server.en.ts does not have fails to compile.
 */
export const pt: ServerCopyPartial = {
  alert: {
    restock: (size: string | null) => (size ? `Tamanho ${size} de novo em stock 🎉` : "De novo em stock 🎉"),
    target: (drop: string) => `🎯 Atingiu o teu alvo — ${drop}`,
    refund: (saving: string, now: string) => `${saving} mais barato do que pagaste: ${now}. Podes devolver e voltar a comprar.`,
    withSize: (size: string, base: string) => `Tamanho ${size} · ${base}`,
  },
  email: {
    size: (s: string) => `Tamanho ${s}`,
    restock: (s: string | null) => (s ? `Tamanho ${s} de novo em stock 🎉` : "De novo em stock 🎉"),
    hitTarget: "🎯 Preço-alvo atingido",
    headingBack: "O que segues está de novo em stock 🎉",
    heading: "Novidades da tua lista de seguidos 🎉",
    footer: "Modadrop · alertas de preço. Recebes este e-mail porque segues estes produtos.",
    unsubscribe: "Cancelar subscrição",
    subjectBack: (n: number) =>
      n === 1 ? "1 produto que segues está de novo em stock" : `${n} produtos que segues estão de novo em stock`,
    subject: (n: number) => `Novidades sobre ${n} ${n === 1 ? "produto" : "produtos"} que segues`,
  },
  news: {
    and: "e",
    digestTitle: (n: number) => `${n} ${n === 1 ? "nova descida" : "novas descidas"} nas tuas marcas`,
    digestBody: (brands: string) => `${brands}: os preços acabaram de baixar. Espreita antes que o teu tamanho esgote.`,
    // Brand first would need "da"/"do" by the brand's gender; the colon avoids guessing.
    saleStartTitle: (brand: string) => `Começaram as promoções: ${brand}`,
    saleStartBody: "Vê os artigos e tamanhos que segues antes que esgotem.",
  },
  saleCalendar: {
    "1111-eve-2026": { title: "O 11.11 é amanhã", body: "Segue já o que queres e fica a saber antes de todos quando baixar." },
    "efsane-cuma-eve-2026": { title: "A Black Friday é amanhã", body: "Segue já os teus favoritos e avisamos-te assim que os preços baixarem." },
  },
  reminder: {
    title: "Continuamos atentos por ti 👀",
    body: (n: number) =>
      `Estamos a acompanhar ${n === 1 ? "o teu artigo" : `os teus ${n} artigos`}: avisamos-te quando o preço baixar ou o teu tamanho voltar. Entretanto, vê as promoções de hoje.`,
  },
  welcome: {
    and: " e ",
    drops1Title: (n: number, pct: string) => `${n} ${n === 1 ? "artigo baixou" : "artigos baixaram"} ${pct} ou mais hoje`,
    drops1Body: (brands: string) => `As descidas de hoje são lideradas por ${brands}. Espreita antes que o teu tamanho esgote.`,
    deal3Title: (brand: string, pct: string) => `${brand}: ${pct} de desconto`,
    deal3Body: (name: string, price: string) => `${name} está agora a ${price}. Toca em ♡ para o seguir — avisamos-te se voltar a baixar.`,
    look5Title: "Um look escolhido para ti",
    look5Body: "O nosso stylist criou um look com as promoções de hoje. Troca qualquer peça com um toque.",
    week7Title: (n: string) => `${n} novas promoções esta semana`,
    week7Body: "Segue um artigo de que gostes e só te enviamos mensagens sobre o que te interessa.",
  },
  signIn: {
    subject: (code: string) => `O teu código de acesso Modadrop: ${code}`,
    intro: "O teu código de acesso:",
    note: "O código é válido durante 10 minutos. Se não o pediste, ignora este e-mail — nada muda na tua conta.",
  },
  stilist: {
    alarmTitle: (n: number) => `Alarme de pesquisa: ${n} ${n === 1 ? "novo resultado" : "novos resultados"}`,
    interestTitle: (what: string, n: number) => (n === 1 ? `Novidade para ${what}` : `${n} novidades para ${what}`),
    yourSearch: "a tua pesquisa",
    interestBody: (item: string) => `${item} acabou de chegar.`,
  },
};
