/**
 * A brand's sale has started (2026-10-03).
 *
 * Measured on production over 45 days of price_drop events: Koton's sale
 * start on 2026-09-30 dropped 12,076 products in a day, Gratis runs promotion
 * waves of 5-13k about every two weeks, and the median brand-country drops 9
 * products a day (p90: ~100). So a sale start is 10% of the brand's in-stock
 * catalogue — and never fewer than 150 products — within 6 hours. One row per
 * brand and country per 21 days, so a promotion-heavy shop (Gratis) is
 * announced once per cycle, not every wave.
 *
 * push-news.ts tells the devices that track that brand.
 */
import type { Db } from "./db";

const MIN_DROPS = 150;
const SHARE = 10; // percent of in-stock products
const WINDOW = "6 hours";
const COOLDOWN = "21 days";

/**
 * Candidates first (150+ products dropped in the window — a small set), then
 * each candidate's in-stock count through the (brand, country, external_id)
 * index. Counting every in-stock product up front was a scan of ~2M rows on
 * every collector run.
 */
export const BRAND_SALES_SQL = `
  WITH d AS (
    SELECT p.brand, p.country, count(DISTINCT p.id)::int AS drops
    FROM events e JOIN products p ON p.id = e.product_id
    WHERE e.type = 'price_drop' AND e.ts > $1::timestamptz - interval '${WINDOW}' AND e.ts <= $1::timestamptz
    GROUP BY 1, 2
    HAVING count(DISTINCT p.id) >= ${MIN_DROPS})
  SELECT d.brand, d.country, d.drops
  FROM d CROSS JOIN LATERAL (
    SELECT count(*)::int AS live FROM products s WHERE s.brand = d.brand AND s.country = d.country AND s.in_stock
  ) s
  WHERE d.drops >= GREATEST(${MIN_DROPS}, s.live * ${SHARE} / 100)
    AND NOT EXISTS (SELECT 1 FROM brand_sales b WHERE b.brand = d.brand AND b.country = d.country
                    AND b.started_at > $1::timestamptz - interval '${COOLDOWN}')
  ORDER BY d.brand, d.country`;

export async function detectBrandSales(db: Db, opts: { now?: Date } = {}): Promise<{ brand: string; country: string }[]> {
  const now = (opts.now ?? new Date()).toISOString();
  const rows = await db.query<{ brand: string; country: string; drops: number }>(BRAND_SALES_SQL, [now]);
  for (const r of rows) {
    await db.query(
      `INSERT INTO brand_sales (brand, country, started_at, drops) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [r.brand, r.country, now, r.drops],
    );
  }
  if (rows.length) console.log(`brand sales started: ${rows.map((r) => `${r.brand}/${r.country} (${r.drops})`).join(", ")}`);
  return rows.map(({ brand, country }) => ({ brand, country }));
}
