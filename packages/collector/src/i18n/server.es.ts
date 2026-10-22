import type { ServerCopyPartial } from "./server";

/**
 * Spanish server copy: pushes and alert emails. Translated from server.en.ts
 * (same keys; amounts and percentages arrive formatted), with server.tr.ts for
 * the voice. Spain Spanish with "tú", worded so US Hispanic readers read it
 * just as naturally. Every key is optional — anything left out is sent in
 * English — and a key server.en.ts does not have fails to compile.
 */
export const es: ServerCopyPartial = {
  alert: {
    restock: (size: string | null) => (size ? `La talla ${size} vuelve a estar disponible 🎉` : "De nuevo disponible 🎉"),
    target: (drop: string) => `🎯 Llegó a tu precio objetivo — ${drop}`,
    refund: (saving: string, now: string) =>
      `${saving} más barato de lo que pagaste: ${now}. Puedes devolverlo y volver a comprarlo.`,
    withSize: (size: string, base: string) => `Talla ${size} · ${base}`,
  },
  email: {
    size: (s: string) => `Talla ${s}`,
    restock: (s: string | null) => (s ? `La talla ${s} vuelve a estar disponible 🎉` : "De nuevo disponible 🎉"),
    hitTarget: "🎯 Precio objetivo alcanzado",
    headingBack: "Lo que sigues vuelve a estar disponible 🎉",
    heading: "Novedades de tu lista de seguimiento 🎉",
    footer: "Modadrop · alertas de precio. Recibes este correo porque sigues estos productos.",
    unsubscribe: "Darse de baja",
    subjectBack: (n: number) =>
      n === 1
        ? "Un producto que sigues vuelve a estar disponible"
        : `${n} productos que sigues vuelven a estar disponibles`,
    subject: (n: number) =>
      n === 1 ? "Novedades de un producto que sigues" : `Novedades de ${n} productos que sigues`,
  },
  news: {
    and: "y",
    digestTitle: (n: number) => `${n} ${n === 1 ? "bajada nueva" : "bajadas nuevas"} en tus marcas`,
    digestBody: (brands: string) => `${brands}: acaban de bajar los precios. Échales un vistazo antes de que se agote tu talla.`,
    saleStartTitle: (brand: string) => `Empiezan las rebajas: ${brand}`,
    saleStartBody: "Revisa lo que sigues y tus tallas antes de que se agoten.",
  },
  saleCalendar: {
    "1111-eve-2026": { title: "Mañana es el 11.11", body: "Sigue ahora lo que quieres y entérate antes que nadie cuando baje." },
    "efsane-cuma-eve-2026": {
      title: "Mañana es Black Friday",
      body: "Sigue ahora lo que te gusta y te avisamos en cuanto bajen los precios.",
    },
  },
  reminder: {
    title: "Seguimos atentos por ti 👀",
    body: (n: number) =>
      `Vigilamos ${n === 1 ? "tu artículo" : `tus ${n} artículos`}: te avisaremos cuando baje el precio o vuelva tu talla. Mientras tanto, mira las ofertas de hoy.`,
  },
  welcome: {
    and: " y ",
    drops1Title: (n: number, pct: string) =>
      `${n} ${n === 1 ? "artículo ha bajado" : "artículos han bajado"} un ${pct} o más hoy`,
    drops1Body: (brands: string) => `${brands} encabezan las bajadas de hoy. Échales un vistazo antes de que se agote tu talla.`,
    deal3Title: (brand: string, pct: string) => `${brand}: ${pct} de descuento`,
    deal3Body: (name: string, price: string) =>
      `${name} ahora cuesta ${price}. Toca ♡ para seguirlo y te avisamos si vuelve a bajar.`,
    look5Title: "Un look elegido para ti",
    look5Body: "Nuestra estilista ha creado un look con las ofertas de hoy. Cambia cualquier prenda con un toque.",
    week7Title: (n: string) => `${n} ofertas nuevas esta semana`,
    week7Body: "Sigue un artículo que te guste y solo te escribiremos sobre lo tuyo.",
  },
  signIn: {
    subject: (code: string) => `Tu código de acceso a Modadrop: ${code}`,
    intro: "Tu código de acceso:",
    note: "El código es válido durante 10 minutos. Si no lo has pedido tú, ignora este correo: no cambia nada en tu cuenta.",
  },
  stilist: {
    alarmTitle: (n: number) =>
      `Alarma del asistente: ${n} ${n === 1 ? "coincidencia nueva" : "coincidencias nuevas"}`,
    interestTitle: (what: string, n: number) => (n === 1 ? `Novedad para ${what}` : `${n} novedades para ${what}`),
    yourSearch: "tu búsqueda",
    interestBody: (item: string) => `Acaba de llegar: ${item}.`,
  },
};
