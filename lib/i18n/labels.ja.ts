import type { LibLabelsPartial } from "./types";

/**
 * Japanese display names for the browse taxonomy. Same keys as
 * labels.en.ts (see its header: keys stay Turkish, subtypes are keyed
 * `type:subtype`). ZOZOTOWN / @cosme category wording.
 */
export const ja: LibLabelsPartial = {
  /** Shelf names, keyed by productTypes.ts type key. */
  types: {
    makyaj: "メイク",
    parfum: "フレグランス",
    sac: "ヘアケア",
    "cilt-bakim": "スキンケア",
    "kisisel-bakim": "ボディ・日用品",
    ayakkabi: "シューズ",
    canta: "バッグ",
    mayo: "水着",
    "ic-giyim": "インナー",
    elbise: "ワンピース",
    "dis-giyim": "アウター",
    triko: "ニット・スウェット",
    ust: "トップス",
    alt: "ボトムス",
    aksesuar: "アクセサリー",
  },
  groups: {
    giyim: "ファッション",
    ayakkabi: "シューズ",
    canta: "バッグ",
    aksesuar: "アクセサリー",
    kozmetik: "コスメ",
  },
  /** Keyed `type:subtype` — subtype keys repeat across types (see labels.en.ts). */
  subtypes: {
    "alt:etek": "スカート",
    "alt:sort": "ショートパンツ",
    "alt:tayt": "レギンス",
    "alt:jean": "デニムパンツ",
    "alt:pantolon": "パンツ",

    "ust:tisort": "Tシャツ",
    "ust:gomlek": "シャツ",
    "ust:bluz": "ブラウス",
    "ust:atlet": "タンクトップ・キャミソール",
    "ust:tunik": "チュニック",

    "dis-giyim:trenckot": "トレンチコート",
    "dis-giyim:blazer": "テーラードジャケット",
    "dis-giyim:yelek": "ベスト",
    "dis-giyim:mont": "コート・ダウン",
    "dis-giyim:ceket": "ジャケット",

    "ayakkabi:bot": "ブーツ",
    "ayakkabi:topuklu": "パンプス・ヒール",
    "ayakkabi:sneaker": "スニーカー",
    "ayakkabi:sandalet": "サンダル",
    "ayakkabi:babet": "フラットシューズ",

    "cilt-bakim:gunes": "日焼け止め",
    "cilt-bakim:maske": "フェイスパック",
    "cilt-bakim:serum": "美容液",
    "cilt-bakim:goz": "アイケア",
    "cilt-bakim:dudak": "リップケア",
    "cilt-bakim:temizleyici": "洗顔料",
    "cilt-bakim:nemlendirici": "保湿クリーム・乳液",

    "elbise:tulum": "オールインワン",
    "elbise:abiye": "パーティードレス",
    "elbise:gomlek": "シャツワンピース",
    "elbise:maksi": "マキシ丈",
    "elbise:midi": "ミディ丈",
    "elbise:mini": "ミニ丈",

    "kisisel-bakim:hijyen": "生理用品",
    "kisisel-bakim:agiz": "オーラルケア",
    "kisisel-bakim:banyo": "バス・ボディケア",
    "kisisel-bakim:tiras": "シェービング・除毛",
    "kisisel-bakim:mendil": "ウェットティッシュ",
    "kisisel-bakim:yara": "絆創膏",

    "triko:hirka": "カーディガン",
    "triko:sweatshirt": "スウェット",
    "triko:polo": "ポロシャツ",
    "triko:kazak": "ニット・セーター",

    "ic-giyim:pijama": "パジャマ",
    "ic-giyim:corap": "ソックス・タイツ",
    "ic-giyim:sutyen": "ブラジャー",
    "ic-giyim:kulot": "ショーツ",
    "ic-giyim:atlet": "インナー・ボディスーツ",

    "mayo:bikini": "ビキニ",
    "mayo:mayo": "ワンピース水着",
    "mayo:deniz-sortu": "サーフパンツ",
    "mayo:plaj": "ビーチウェア",

    "canta:cuzdan": "財布・カードケース",
    "canta:sirt": "リュック",
    "canta:tote": "トートバッグ",
    "canta:capraz": "ショルダーバッグ",
    "canta:el": "ハンドバッグ",
    "canta:valiz": "スーツケース",
    "canta:canta-aksesuar": "バッグアクセサリー",

    "aksesuar:gozluk": "メガネ・サングラス",
    "aksesuar:sapka": "帽子",
    "aksesuar:kemer": "ベルト",
    "aksesuar:sal": "マフラー・ストール",
    "aksesuar:taki": "ジュエリー",
    "aksesuar:kolye": "ネックレス",
    "aksesuar:kupe": "ピアス・イヤリング",
    "aksesuar:bileklik": "ブレスレット",
    "aksesuar:yuzuk": "リング",
    "aksesuar:saat": "腕時計",
    "aksesuar:toka": "ヘアアクセサリー",

    "makyaj:dudak": "リップメイク",
    "makyaj:goz": "アイメイク",
    "makyaj:yuz": "ベースメイク",
    "makyaj:oje": "ネイル",
    "makyaj:firca": "メイクツール",
    "makyaj:temizleme": "クレンジング",

    "parfum:deodorant": "デオドラント",
    "parfum:edp": "オードパルファム",
    "parfum:edt": "オードトワレ",
    "parfum:vucut": "ボディミスト",
    "parfum:ev": "ルームフレグランス",
    "parfum:set": "フレグランスギフトセット",

    "sac:boya": "ヘアカラー",
    "sac:sampuan": "シャンプー",
    "sac:maske": "ヘアマスク・ヘアオイル",
    "sac:sekillendirici": "スタイリング",
    "sac:krem": "コンディショナー",
  },
  /** The shelf for products no type caught (productTypes.ts UNTYPED). */
  untyped: "その他の商品",
  /** Colour-filter names, keyed by colors.ts COLOR_FAMILIES key. */
  colors: {
    lacivert: "ネイビー",
    siyah: "ブラック",
    beyaz: "ホワイト",
    gri: "グレー",
    bej: "ベージュ",
    kahverengi: "ブラウン",
    kirmizi: "レッド",
    pembe: "ピンク",
    mor: "パープル",
    mavi: "ブルー",
    yesil: "グリーン",
    sari: "イエロー",
    turuncu: "オレンジ",
    metalik: "メタリック",
    "cok-renkli": "マルチカラー",
  },
  /** The Akıllı Arama chips for what the assistant understood (assistant.ts). Prices arrive formatted. */
  chips: {
    gender: { kadin: "レディース", erkek: "メンズ", cocuk: "キッズ" },
    under: (p: string) => `${p}以下`,
    over: (p: string) => `${p}以上`,
    size: (s: string) => `サイズ ${s}`,
    sale: "セール中",
    cheapest: "安い順",
  },
};
