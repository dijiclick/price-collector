import { writeFileSync, mkdirSync } from "node:fs";
import { connect } from "./db";

/** Export the current top deals to web/data/deals.json for a DB-less alpha deploy. */
async function main() {
  const db = await connect();
  const deals = await db.query(
    `SELECT id, brand, name, url, image_url AS "imageUrl", category, product_type AS type, group_key AS "groupKey",
            current_price AS price, current_list_price AS "listPrice", in_stock AS "inStock",
            round(100.0*(current_list_price-current_price)/current_list_price)::int AS pct
     FROM products
     WHERE current_list_price > current_price AND image_url IS NOT NULL
     ORDER BY pct DESC, current_price ASC
     LIMIT 200`,
  );
  const counts = await db.query(
    `SELECT brand, count(*)::int AS count FROM products
     WHERE current_list_price > current_price AND image_url IS NOT NULL
     GROUP BY brand ORDER BY count DESC`,
  );
  const total = await db.query(
    `SELECT count(*)::int AS c FROM products WHERE current_list_price > current_price AND image_url IS NOT NULL`,
  );
  mkdirSync("data", { recursive: true });
  writeFileSync("data/deals.json", JSON.stringify({ total: total[0].c, counts, deals }));
  console.log(`exported ${deals.length} deals, total ${total[0].c}`);
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
