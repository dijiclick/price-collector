import type { LibLabelsPartial } from "./types";

/**
 * Turkish. The shelf names are NOT here: Turkish is the taxonomy's own label
 * (PRODUCT_TYPE_LABELS / PRODUCT_GROUPS / PRODUCT_SUBTYPES in productTypes.ts),
 * which is also what classification matches against. Only what has no other
 * home lives here.
 */
export const tr: LibLabelsPartial = {
  untyped: "Diğer ürünler",
  colors: {
    lacivert: "Lacivert",
    siyah: "Siyah",
    beyaz: "Beyaz",
    gri: "Gri",
    bej: "Bej",
    kahverengi: "Kahverengi",
    kirmizi: "Kırmızı",
    pembe: "Pembe",
    mor: "Mor",
    mavi: "Mavi",
    yesil: "Yeşil",
    sari: "Sarı",
    turuncu: "Turuncu",
    metalik: "Metalik",
    "cok-renkli": "Çok renkli",
  },
  chips: {
    gender: { kadin: "Kadın", erkek: "Erkek", cocuk: "Çocuk" },
    under: (p: string) => `${p} altı`,
    over: (p: string) => `${p} üstü`,
    size: (s: string) => `Beden ${s}`,
    sale: "İndirimde",
    cheapest: "En ucuz",
  },
};
