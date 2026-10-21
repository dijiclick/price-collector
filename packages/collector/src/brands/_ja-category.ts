/**
 * Japanese garment words → the English shelf word `lib/productTypes.ts` reads
 * (2026-10-21, Japan wave). The classifier is Turkish/English only, so a JP
 * row whose feed carries no English category would get no type at all. JP
 * adapters pass their feed's own Japanese category (or, when the feed has
 * none, the product name) through `jaCategory` and store the result as
 * `category`; the Japanese product name itself is never changed.
 *
 * Order matters: the first match wins, so compound words come before the
 * words they contain (ワンピース before ピース, スニーカー before 靴,
 * ショートパンツ before パンツ, ニットカーディガン → cardigan before ニット).
 */
const RULES: [RegExp, string][] = [
  // underwear / sleep / swim first: "ブラトップ", "ルームウェア", "水着"
  // ショーツ is panties in lingerie names but shorts in sportswear ("ランニングショーツ").
  [/ブラジャー|ブラトップ|ブラ(?![ウンシッイ])|(?<!ランニング|スポーツ|ハーフ|バスケ|サッカー|スイム|ボード|トレーニング|ゴルフ|テニス)ショーツ(?!パンツ)|ランジェリー|インナー(?!トップス)|下着/, "underwear"],
  [/パジャマ|ルームウェア|ナイトウェア/, "pyjama"],
  [/水着|ビキニ|スイムウェア/, "swimsuit"],
  [/ソックス|靴下|タイツ|ストッキング/, "socks"],
  // footwear
  [/スニーカー/, "sneakers"],
  [/ブーツ|ブーティ/, "boots"],
  [/サンダル/, "sandals"],
  [/パンプス|ローファー|バレエシューズ|フラットシューズ|ミュール|シューズ|靴/, "shoes"],
  // bags
  [/リュック|バックパック/, "backpack"],
  [/財布|ウォレット/, "wallet"],
  [/バッグ|トート|ショルダー(?:バッグ)?$|ポーチ|クラッチ/, "bag"],
  // dresses / sets
  [/ワンピース|ドレス/, "dress"],
  [/オールインワン|サロペット|ジャンプスーツ|つなぎ/, "jumpsuit"],
  [/セットアップ/, "set"],
  // outerwear
  [/(?<!ボタン)ダウン(?!シャツ)|(?<!ス)コート|トレンチ|ジャケット|ブルゾン|ジャンパー|アウター|ブレザー|パーカー(?=.*(?:ジップ|ZIP))|ベスト|ジレ|ポンチョ|ケープ/, "jacket"],
  // knit / sweat
  [/カーディガン/, "cardigan"],
  [/パーカー|フーディ|スウェット|トレーナー/, "sweatshirt"],
  [/ニット|セーター|プルオーバー/, "sweater"],
  // bottoms
  [/ジーンズ|デニムパンツ|デニム(?!ジャケット|シャツ)/, "jeans"],
  [/スカート|スコート/, "skirt"],
  [/ショートパンツ|ハーフパンツ|ショーツ/, "shorts"],
  [/レギンス|スパッツ/, "leggings"],
  [/パンツ|スラックス|チノ|ボトムス|ジョガー|キュロット/, "pants"],
  // tops
  [/ブラウス/, "blouse"],
  [/[TＴ]シャツ|カットソー|ロンT|ロンＴ|タンクトップ|キャミソール|キャミ|チュニック|トップス|ビスチェ/, "top"],
  [/ポロシャツ/, "polo"],
  [/シャツ/, "shirt"],
  // accessories / jewellery
  [/ネックレス|ピアス|イヤリング|(?<![プトスーボ])リング|指輪|ブレスレット|アクセサリー/, "jewellery"],
  [/帽子|キャップ(?!スリーブ)|ハット|ニット帽|ビーニー|ベレー/, "hat"],
  [/マフラー|ストール|スカーフ/, "scarf"],
  [/ベルト/, "belt"],
  [/手袋|グローブ/, "gloves"],
  [/サングラス|メガネ/, "sunglasses"],
  [/ヘアアクセ|ヘアクリップ|シュシュ|バレッタ|カチューシャ/, "hair clip"],
  // beauty
  [/香水|フレグランス|オードパルファム|オードトワレ/, "perfume"],
  [/(?<![クトス])リップ(?!ル)|口紅|ファンデーション|アイシャドウ|マスカラ|チーク|コスメ/, "makeup"],
];

/** English shelf word for a Japanese category/name, or null when nothing matches. Pure. */
export function jaCategory(text: unknown): string | null {
  const s = String(text ?? "").normalize("NFKC");
  if (!s.trim()) return null;
  for (const [re, en] of RULES) if (re.test(s)) return en;
  return null;
}
