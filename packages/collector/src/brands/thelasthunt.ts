/**
 * The Last Hunt (thelasthunt.com) — Canada only. Altitude Sports' off-price
 * outlet: past-season The North Face, adidas, Columbia, New Balance, Vans,
 * Matt & Nat, Dr. Martens, Patagonia... (14,490 styles on 2026-11-10).
 *
 * Same Next.js build and Algolia record shape as altitude-sports.com (see
 * altitudesports.ts for the row rules), on its own Algolia app: the public
 * search-only key sits in the storefront's `_app-*.js` (`APP_ID:"2YG4O6L95L",
 * SEARCH_API_KEY:"e8b3…"`). Algolia answers a GitHub runner directly — no proxy
 * (probe run 42799158188, 2026-11-10).
 *
 * It is an outlet, so every style is below its regular price
 * (`original_price`, the price the same style carried at Altitude Sports);
 * the product page shows the same pair. We read the best sellers only: the
 * famous brands first, then women's, then men's — wearables and bags, no kids,
 * capped at 2,000 rows.
 */
import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { BIG, MUST, listAltiShop, type AltiShop, type Walk } from "./altitudesports";

export const brand = "thelasthunt";

export const LAST_HUNT: AltiShop = {
  brand,
  appId: "2YG4O6L95L",
  apiKey: "e8b31524fd0d708f603240f2bfaec48a",
  index: "PRODUCTS_TLH_en-CA_bestSeller",
  site: "https://www.thelasthunt.com",
  cap: 2000,
  setMaker: true,
};

const anyBrand = (names: string[]) => `(${names.map((b) => `attributes.brand_name:"${b.replace(/"/g, '\\"')}"`).join(" OR ")})`;
/** Names this outlet carries that Altitude's own lists do not. */
const OUTLET = ["Matt & Nat", "Reebok", "UGG", "Lolë", "tentree", "Billabong", "Roxy", "Maaji", "Kari Traa", "Oakley", "Reigning Champ", "Blundstone"];

export const TLH_WALKS: Walk[] = [
  { label: "famous brands, women", filter: `${anyBrand([...MUST, ...BIG, ...OUTLET])} AND attributes.gender:Women`, gender: "kadin", limit: 900 },
  { label: "women", filter: "attributes.gender:Women", gender: "kadin", limit: 900 },
  { label: "famous brands, men", filter: `${anyBrand([...MUST, ...BIG, ...OUTLET])} AND attributes.gender:Men`, gender: "erkek", limit: 600 },
];

export const listTheLastHunt = (country: CountryCode): Promise<ProductRecord[]> => listAltiShop(LAST_HUNT, TLH_WALKS, country);
export const listProducts = listTheLastHunt;
