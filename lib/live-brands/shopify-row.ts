/**
 * Shopify stores added 2026-11-10 (Australia / rest-of-world package). Same
 * row shape as SHOPIFY_STORES (./shopify-sites.ts). Every site's `/meta.json`
 * currency matches its market, and the feed named here answered a GitHub
 * runner with `cookie: localization=<CC>` (probe runs 42798112099,
 * 42799215480, 42799779596): reduced rows with a compare-at above the price.
 *
 * `collections` = the store's own sale collection, walked instead of the whole
 * catalogue (Culture Kings lists ~150k products, Marais ~27k). Collection
 * sizes are from each store's `/collections.json` on 2026-11-10.
 *
 * Left out on purpose (do not retry without a reason):
 * - Tiger Mist (804 of 838 visible products "on sale"), Lioness (736 of 743),
 *   Order of Style (every row reduced), Superdry AU and Champion AU (a standing
 *   storewide %), Gorman / Dangerfield / Princess Highway (Factory X: the
 *   whole catalogue carries a compare-at), Review (80% "on sale"), Betts (a
 *   storewide 30% badge on 3,321 of 3,121 products), Kathmandu (clearance is
 *   16k of 20k rows) — was-prices that are not markdowns. Jashanmal's sale is
 *   homeware and appliances; Livid's `women-sale` has no compare-at.
 * - Nordics: Bubbleroom's `outlet` (all four country stores), Rains' `outlet`,
 *   Tom Wood's `archive-sale` and Norse Projects' `sale` carry no compare-at
 *   price; Sofie Schnoor answered a runner in USD for Denmark; Pilgrim tags its
 *   retail rows `B2B` as well as `B2C`, which the wholesale filter drops.
 * - Birkenstock AU `last-chance` has no compare-at prices; Zulu & Zephyr's
 *   `sale` answered 0 rows to a runner; Harrolds shows nothing in stock to a
 *   runner and has no sale collection.
 */
import type { ShopifySite } from "./shopify-sites";

export const SHOPIFY_ROW: ShopifySite[] = [
  // Multi-brand: the product's vendor is the real brand.
  { brand: "culturekings", sites: { AU: "https://www.culturekings.com.au" }, collections: { AU: "all-sale" }, vendorIsMaker: true, maxProducts: 2000 },
  { brand: "generalpants", sites: { AU: "https://www.generalpants.com" }, collections: { AU: "sale" }, vendorIsMaker: true },
  // Marais: Melbourne luxury boutique (Loewe, Maison Margiela, Rick Owens, Givenchy…).
  { brand: "marais", sites: { AU: "https://www.marais.com.au" }, collections: { AU: "sale" }, vendorIsMaker: true, maxProducts: 2000 },
  { brand: "incu", sites: { AU: "https://www.incu.com" }, collections: { AU: "sale" }, vendorIsMaker: true },
  { brand: "tuchuzy", sites: { AU: "https://www.tuchuzy.com" }, collections: { AU: "sale" }, vendorIsMaker: true, defaultGender: "kadin" },
  { brand: "parlourx", sites: { AU: "https://www.parlourx.com.au" }, collections: { AU: "clearance" }, vendorIsMaker: true, defaultGender: "kadin" },
  // SurfStitch: `sale` leads with wall clocks and framed records; `womens-sale` is the fashion shelf.
  { brand: "surfstitch", sites: { AU: "https://www.surfstitch.com" }, collections: { AU: "womens-sale" }, vendorIsMaker: true, defaultGender: "kadin" },
  // Australian labels.
  { brand: "witchery", sites: { AU: "https://www.witchery.com.au" }, collections: { AU: "sale" }, defaultGender: "kadin" },
  { brand: "ajeworld", sites: { AU: "https://ajeworld.com.au" }, collections: { AU: "sale" }, defaultGender: "kadin" },
  { brand: "camilla", sites: { AU: "https://au.camilla.com" }, collections: { AU: "sale" }, defaultGender: "kadin" },
  { brand: "assemblylabel", sites: { AU: "https://www.assemblylabel.com" }, collections: { AU: "final-sale" } },
  { brand: "becandbridge", sites: { AU: "https://www.becandbridge.com.au" }, collections: { AU: "sale" }, defaultGender: "kadin" },
  { brand: "shonajoy", sites: { AU: "https://www.shonajoy.com.au" }, collections: { AU: "sale" }, defaultGender: "kadin" },
  { brand: "viktoriaandwoods", sites: { AU: "https://www.viktoriaandwoods.com.au" }, collections: { AU: "shop-sale" }, defaultGender: "kadin" },
  { brand: "bassike", sites: { AU: "https://www.bassike.com" }, collections: { AU: "sale" } },
  { brand: "sportscraft", sites: { AU: "https://www.sportscraft.com.au" } },
  { brand: "saba", sites: { AU: "https://www.saba.com.au" }, collections: { AU: "sale" } },
  { brand: "jag", sites: { AU: "https://www.jag.com.au" }, collections: { AU: "sale" } },
  { brand: "sheike", sites: { AU: "https://www.sheike.com.au" }, collections: { AU: "sale" }, defaultGender: "kadin" },
  { brand: "lskd", sites: { AU: "https://www.lskd.co" }, collections: { AU: "sales" } },
  { brand: "frankie4", sites: { AU: "https://www.frankie4.com.au" }, defaultGender: "kadin" },
  { brand: "jomercer", sites: { AU: "https://www.jomercer.com.au" }, collections: { AU: "shop-sale" }, defaultGender: "kadin" },
  { brand: "nimble", sites: { AU: "https://www.nimbleactivewear.com" }, defaultGender: "kadin" },
  { brand: "kivari", sites: { AU: "https://www.kivari.com.au" }, collections: { AU: "sale" }, defaultGender: "kadin" },
  { brand: "elkthelabel", sites: { AU: "https://www.elkthelabel.com" }, collections: { AU: "womens-sale-items" }, defaultGender: "kadin" },
  { brand: "afends", sites: { AU: "https://afends.com" }, collections: { AU: "all-sale" } },
  { brand: "thrills", sites: { AU: "https://thrills.co" }, collections: { AU: "sale" } },
  { brand: "ripcurl", sites: { AU: "https://www.ripcurl.com.au" }, collections: { AU: "sale" } },
  { brand: "billabong", sites: { AU: "https://www.billabong.com.au" }, collections: { AU: "sale" } },
  { brand: "mcobeauty", sites: { AU: "https://www.mcobeauty.com" }, collections: { AU: "sale" } },
  { brand: "vergegirl", sites: { AU: "https://www.vergegirl.com" }, collections: { AU: "sale" }, defaultGender: "kadin" },
  { brand: "auguste", sites: { AU: "https://www.augustethelabel.com" }, collections: { AU: "sale" }, defaultGender: "kadin" },
  // Markets added to brands that already have an adapter elsewhere.
  { brand: "petalandpup", sites: { AU: "https://www.petalandpup.com.au" }, collections: { AU: "sale" }, defaultGender: "kadin" },
  // Steve Madden Middle East (stevemadden.me): its own Shopify store in AED; 973 of 1,679 products are full price.
  { brand: "stevemadden", sites: { AE: "https://stevemadden.me" } },
  // Ted Baker UAE (tedbaker.ae, AED): `sale-tdm-items` is the store's all-sale collection (probe run 42809427291).
  { brand: "tedbaker", sites: { AE: "https://www.tedbaker.ae" }, collections: { AE: "sale-tdm-items" } },

  // Nordics (probe run 42803998475). Each store's own currency is the market's:
  // SEK for the Swedish shops, DKK for the Danish ones. The EUR-priced Danish /
  // Finnish labels are listed for Finland only — their feeds answer EUR for every
  // `localization` cookie, so Sweden/Denmark/Norway would get the wrong currency.
  { brand: "stayhard", sites: { SE: "https://stayhard.com" }, collections: { SE: "sale" }, vendorIsMaker: true, defaultGender: "erkek" },
  { brand: "sportamore", sites: { SE: "https://sportamore.com" }, collections: { SE: "final-sale-women" }, vendorIsMaker: true, defaultGender: "kadin" },
  { brand: "message", sites: { DK: "https://message.dk" }, collections: { DK: "alt-sale" }, vendorIsMaker: true },
  { brand: "nuenotes", sites: { DK: "https://www.nuenotes.com" }, collections: { DK: "sale" }, defaultGender: "kadin" },
  { brand: "makia", sites: { FI: "https://makia.com" }, collections: { FI: "outlet" } },
  { brand: "modstrom", sites: { FI: "https://www.modstrom.com" }, collections: { FI: "sale" }, defaultGender: "kadin" },
  { brand: "mosmosh", sites: { FI: "https://www.mosmosh.com" }, collections: { FI: "sale-tag" } },
  { brand: "lollyslaundry", sites: { FI: "https://www.lollyslaundry.com" }, collections: { FI: "sale" }, defaultGender: "kadin" },
  // Asia (probe runs 42809744813, 42809821638).
  // Club 21 (Singapore, SGD): luxury multi-brand — Issey Miyake, Comme des Garçons, Juun.J, Dries Van Noten…
  { brand: "club21", sites: { SG: "https://club21.com" }, collections: { SG: "end-of-season-sale" }, vendorIsMaker: true, maxProducts: 2000 },
  // WEGO (Japan, JPY): its `limited-sale` collection. A product row is ~40 KB (50+ photos), so 50 a call, 500 a run.
  { brand: "wego", sites: { JP: "https://wego.jp" }, collections: { JP: "limited-sale" }, pageSize: 50, maxProducts: 500 },
  // Riccovero (Norway, NOK): its sale is split into salg-dame / salg-herre, so the whole catalogue (~1,850) is walked.
  { brand: "riccovero", sites: { NO: "https://www.riccovero.no" } },
];

/**
 * GUESS Australia is a Shopify store (the other markets are Algolia, guess.ts).
 * Kept out of SHOPIFY_ROW so the generic Shopify resolver does not replace the
 * `guess` pasted-link resolver; registry.ts dispatches AU to this row.
 */
export const GUESS_AU: ShopifySite = { brand: "guess", sites: { AU: "https://www.guess.com.au" }, collections: { AU: "all-sale" } };

/**
 * Columbia UAE (columbia.ae, GMG's Shopify store, AED; `sale` = 945 of 2,489).
 * Kept out of SHOPIFY_ROW for the same reason as GUESS_AU: `columbia` has its
 * own adapters and resolver; registry-intl.ts dispatches AE to this row.
 */
export const COLUMBIA_AE: ShopifySite = { brand: "columbia", sites: { AE: "https://www.columbia.ae" }, collections: { AE: "sale" } };
