/**
 * Premium instant alerts (2026-10-11, owner-approved Premium feature).
 *
 * The full sweep runs every ~90 minutes (and GitHub's scheduler drifts it to
 * ~2 h), so a size that comes back and sells out again in between is missed.
 * This short job runs every 15 minutes (priority.yml) and does only two things:
 * re-check the products PREMIUM devices track, one product page each through
 * the live resolvers, and send the alerts that produces. It shares the main
 * sweep's concurrency group, so the two never notify at the same time (nothing
 * else stops two notifiers sending one event twice).
 *
 *   npm run priority
 */
import { connect, migrate } from "./db";

const STALE_MINUTES = Number(process.env.PRIORITY_STALE_MINUTES ?? 10);
const LIMIT = Number(process.env.PRIORITY_LIMIT ?? 400);

async function main(): Promise<void> {
  const db = await connect();
  await migrate(db);
  try {
    const { repriceTracked } = await import("./reprice");
    const r = await repriceTracked(db, undefined, { premiumOnly: true, staleMinutes: STALE_MINUTES, limit: LIMIT });
    console.log(`priority: ${r.considered} premium products, ${r.repriced} re-checked, ${r.changed} changed, ${r.events} events, ${r.gone} gone, ${r.failed} failed`);
    if (r.events > 0) {
      const { pushNotify } = await import("./push");
      const sent = await pushNotify(db);
      console.log(`priority: ${sent} pushes`);
    }
    // The one push a day has a 3-hour evening window and a full sweep can miss it
    // (10-25 to 11-07: 7 of 14 evenings in Turkey). This job runs far more often
    // and holds the same concurrency group, so nothing can send it twice.
    try {
      const { pushBrands } = await import("./push-brands");
      const daily = await pushBrands(db);
      console.log(`priority: ${daily} daily pushes`);
    } catch (err) {
      console.error("daily push failed:", err instanceof Error ? err.message : err);
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error("priority run failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
