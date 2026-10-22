import type { ServerCopyPartial } from "./server";

/**
 * Finnish server copy: pushes and alert emails. Translated from server.en.ts
 * (same keys; amounts and percentages arrive formatted), with server.tr.ts for
 * the voice. Every key is optional — anything left out is sent in English — and
 * a key server.en.ts does not have fails to compile.
 *
 * Brand and product names cannot safely take a Finnish case ending, so they sit
 * in the nominative: as the subject, or after a colon ("Ale alkoi: Zara").
 */
export const fi: ServerCopyPartial = {
  alert: {
    restock: (size: string | null) => (size ? `Koko ${size} on taas varastossa 🎉` : "Taas varastossa 🎉"),
    target: (drop: string) => `🎯 Tavoite saavutettu – ${drop}`,
    refund: (saving: string, now: string) => `${saving} halvempi kuin ostohintasi: nyt ${now}. Voit palauttaa tuotteen ja ostaa sen uudelleen.`,
    withSize: (size: string, base: string) => `Koko ${size} · ${base}`,
  },
  email: {
    size: (s: string) => `Koko ${s}`,
    restock: (s: string | null) => (s ? `Koko ${s} on taas varastossa 🎉` : "Taas varastossa 🎉"),
    hitTarget: "🎯 Tavoite saavutettu",
    headingBack: "Seuraamasi tuotteet ovat taas varastossa 🎉",
    heading: "Uutisia seurantalistaltasi 🎉",
    footer: "Modadrop · hintahälytykset. Saat tämän viestin, koska otit nämä tuotteet seurantaan.",
    unsubscribe: "Peru tilaus",
    subjectBack: (n: number) =>
      n === 1 ? "Seuraamasi tuote on taas varastossa" : `${n} seuraamaasi tuotetta on taas varastossa`,
    subject: (n: number) => `Uutisia ${n} seuraamastasi tuotteesta`,
  },
  news: {
    and: "ja",
    digestTitle: (n: number) => (n === 1 ? "Seuraamillasi merkeillä 1 uusi alennus" : `Seuraamillasi merkeillä ${n} uutta alennusta`),
    digestBody: (brands: string) => `${brands}: hinnat laskivat juuri. Kurkkaa ennen kuin kokosi loppuu.`,
    saleStartTitle: (brand: string) => `Ale alkoi: ${brand}`,
    saleStartBody: "Tarkista seuraamasi tuotteet ja kokosi ennen kuin ne loppuvat.",
  },
  saleCalendar: {
    "1111-eve-2026": { title: "Huomenna on 11.11.", body: "Ota haluamasi tuotteet seurantaan nyt, niin kuulet ensimmäisenä, kun hinta laskee." },
    "efsane-cuma-eve-2026": { title: "Huomenna on Black Friday", body: "Ota suosikkisi seurantaan nyt, niin kerromme heti, kun hinnat laskevat." },
  },
  reminder: {
    title: "Pidämme yhä silmällä 👀",
    body: (n: number) =>
      `Seuraamme ${n} tuotettasi: kuulet, kun hinta laskee tai kokosi palaa. Sillä välin voit katsoa päivän tarjoukset.`,
  },
  welcome: {
    and: " ja ",
    drops1Title: (n: number, pct: string) => `Tänään vähintään ${pct} alennus ${n} tuotteessa`,
    drops1Body: (brands: string) => `Kärjessä tänään: ${brands}. Kurkkaa ennen kuin kokosi loppuu.`,
    deal3Title: (brand: string, pct: string) => `${brand}: ${pct} alennusta`,
    deal3Body: (name: string, price: string) => `${name} nyt ${price}. Ota seurantaan napauttamalla ♡ – kerromme, jos hinta laskee vielä.`,
    look5Title: "Sinulle valittu asu",
    look5Body: "Stylistimme kokosi asun päivän tarjouksista. Vaihda mikä tahansa osa yhdellä napautuksella.",
    week7Title: (n: string) => `${n} uutta alennusta tällä viikolla`,
    week7Body: "Ota seurantaan yksi tuote, josta pidät, niin kerromme vain sinua kiinnostavista tuotteista.",
  },
  signIn: {
    subject: (code: string) => `Modadrop-kirjautumiskoodisi: ${code}`,
    intro: "Kirjautumiskoodisi:",
    note: "Koodi on voimassa 10 minuuttia. Jos et pyytänyt sitä, voit jättää tämän viestin huomiotta – tilillesi ei tapahdu mitään.",
  },
  stilist: {
    alarmTitle: (n: number) => (n === 1 ? "Älyhaun hälytys: 1 uusi osuma" : `Älyhaun hälytys: ${n} uutta osumaa`),
    // `what` is the search in quotes or `yourSearch`, always at the start.
    interestTitle: (what: string, n: number) => (n === 1 ? `${what}: uusi osuma` : `${what}: ${n} uutta osumaa`),
    yourSearch: "Hakusi",
    interestBody: (item: string) => `${item} on juuri saapunut.`,
  },
};
