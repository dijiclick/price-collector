import type { ServerCopyPartial } from "./server";

/**
 * Arabic server copy: pushes and alert emails. Translate from server.en.ts (same
 * keys; amounts and percentages arrive formatted), with server.tr.ts for the
 * voice. Every key is optional — anything left out is sent in English — and a
 * key server.en.ts does not have fails to compile.
 *
 * Modern Standard Arabic for the Gulf. Counts follow Arabic number agreement
 * (1 and 2 are words, 3–10 take the plural, 11–99 the accusative singular,
 * 100, 1000… the genitive singular). Lines never START with a brand or product
 * name: a notification decides its direction from the first strong letter, so
 * a leading "Zara" lays the whole Arabic line out left to right.
 */

/** Arabic count forms: one, two, 3–10, 11–99, and 0 / 100 / 1000… */
type Forms = readonly [string, string, string, string, string];

/** CLDR plural category for Arabic, as an index into `Forms`. */
function cat(n: number): 0 | 1 | 2 | 3 | 4 {
  const v = Math.abs(Math.trunc(Number.isFinite(n) ? n : 0));
  if (v === 1) return 0;
  if (v === 2) return 1;
  const m = v % 100;
  if (m >= 3 && m <= 10) return 2;
  if (m >= 11 && m <= 99) return 3;
  return 4;
}

/** A number as it arrived ("1,240" or 7) and its value. */
const value = (n: number | string) => (typeof n === "number" ? n : Number(String(n).replace(/\D/g, "")) || 0);

/** "منتج واحد", "منتجان", "3 منتجات", "11 منتجًا", "100 منتج". */
function count(n: number | string, f: Forms): string {
  const c = cat(value(n));
  return c <= 1 ? f[c] : `${n} ${f[c]}`;
}

const PRODUCT: Forms = ["منتج واحد", "منتجان", "منتجات", "منتجًا", "منتج"];
const PRODUCT_AFTER_PREP: Forms = ["منتج واحد", "منتجين", "منتجات", "منتجًا", "منتج"];
const PRODUCT_OBJECT: Forms = ["منتجًا واحدًا", "منتجين", "منتجات", "منتجًا", "منتج"];
const NEW_DROPS: Forms = ["تخفيض جديد", "تخفيضان جديدان", "تخفيضات جديدة", "تخفيضًا جديدًا", "تخفيض جديد"];
const NEW_DEALS: Forms = ["عرض جديد", "عرضان جديدان", "عروض جديدة", "عرضًا جديدًا", "عرض جديد"];
const NEW_MATCHES: Forms = ["نتيجة جديدة", "نتيجتان جديدتان", "نتائج جديدة", "نتيجة جديدة", "نتيجة جديدة"];
const NEW_PRODUCTS: Forms = ["منتج جديد", "منتجان جديدان", "منتجات جديدة", "منتجًا جديدًا", "منتج جديد"];

export const ar: ServerCopyPartial = {
  alert: {
    restock: (size: string | null) => (size ? `المقاس ${size} عاد إلى المخزون 🎉` : "عاد إلى المخزون 🎉"),
    target: (drop: string) => `🎯 وصل إلى هدفك — ${drop}`,
    refund: (saving: string, now: string) => `أرخص بـ${saving} مما دفعت: ${now}. يمكنك إرجاعه وشراؤه مجددًا.`,
    withSize: (size: string, base: string) => `المقاس ${size} · ${base}`,
  },
  email: {
    size: (s: string) => `المقاس ${s}`,
    restock: (s: string | null) => (s ? `المقاس ${s} عاد إلى المخزون 🎉` : "عاد إلى المخزون 🎉"),
    hitTarget: "🎯 وصل إلى الهدف",
    headingBack: "ما تتابعه عاد إلى المخزون 🎉",
    heading: "أخبار من قائمة تتبّعك 🎉",
    footer: "تنبيهات الأسعار من Modadrop. تصلك هذه الرسالة لأنك تتابع هذه المنتجات.",
    unsubscribe: "إلغاء الاشتراك",
    subjectBack: (n: number) => `عاد إلى المخزون: ${count(n, PRODUCT)} من قائمة تتبّعك`,
    subject: (n: number) => `أخبار عن ${count(n, PRODUCT_AFTER_PREP)} من قائمة تتبّعك`,
  },
  news: {
    and: "و",
    digestTitle: (n: number) => `${count(n, NEW_DROPS)} في ماركاتك`,
    digestBody: (brands: string) => `انخفضت الأسعار للتو لدى ${brands}. مقاسك قد لا ينتظر طويلًا.`,
    saleStartTitle: (brand: string) => `بدأت تخفيضات ${brand}`,
    saleStartBody: "المنتجات التي تتابعها ومقاساتك قد تنفد بسرعة.",
  },
  saleCalendar: {
    "1111-eve-2026": { title: "عروض 11.11 غدًا", body: "تتبّع ما تريده الآن، وستعرف قبل الجميع عندما ينخفض سعره." },
    "efsane-cuma-eve-2026": { title: "الجمعة البيضاء غدًا", body: "تتبّع ما يعجبك الآن، وسنخبرك فور انخفاض الأسعار." },
  },
  reminder: {
    title: "ما زلنا نراقب لك 👀",
    body: (n: number) =>
      `نراقب لك ${count(n, PRODUCT_OBJECT)}: سنخبرك عندما ينخفض السعر أو يعود مقاسك. وفي الأثناء، عروض اليوم بانتظارك.`,
  },
  welcome: {
    and: " و ",
    drops1Title: (n: number, pct: string) => `${count(n, PRODUCT)} بخصم ${pct} أو أكثر اليوم`,
    drops1Body: (brands: string) => `في صدارة تخفيضات اليوم: ${brands}. مقاسك قد لا ينتظر طويلًا.`,
    deal3Title: (brand: string, pct: string) => `خصم ${pct} لدى ${brand}`,
    deal3Body: (name: string, price: string) => `سعر ${name} الآن ${price}. بلمسة على ♡ تتبّعه، ونخبرك إذا انخفض أكثر.`,
    look5Title: "إطلالة مختارة لك",
    look5Body: "نسّق الستايلست لدينا إطلالة من عروض اليوم. يمكنك تبديل أي قطعة بلمسة واحدة.",
    week7Title: (n: string) => `${count(n, NEW_DEALS)} هذا الأسبوع`,
    week7Body: "تتبّع منتجًا واحدًا يعجبك، ولن نراسلك إلا بشأن ما يخصك.",
  },
  signIn: {
    subject: (code: string) => `رمز تسجيل الدخول إلى Modadrop: ${code}`,
    intro: "رمز تسجيل الدخول:",
    note: "الرمز صالح لمدة 10 دقائق. إذا لم يكن هذا الطلب منك، يمكن تجاهل هذه الرسالة، ولن يتغير شيء في حسابك.",
  },
  stilist: {
    alarmTitle: (n: number) => `منبّه البحث الذكي: ${count(n, NEW_MATCHES)}`,
    interestTitle: (what: string, n: number) =>
      n === 1 ? `جديد في نتائج ${what}` : `نتائج ${what}: ${count(n, NEW_PRODUCTS)}`,
    yourSearch: "بحثك",
    interestBody: (item: string) => `وصل ${item} للتو.`,
  },
};
