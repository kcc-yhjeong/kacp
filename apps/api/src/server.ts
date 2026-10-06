import { buildApp } from './app.js';
import { config } from './config.js';
import { db, runMigrations } from './db/client.js';
import { seedReservedNames } from './admin/service.js';
import { ensurePlatformPackage, reconcilePackageServers } from './mcp/service.js';
import { startWorkers } from './workers.js';
import { and, eq, isNull } from 'drizzle-orm';
import { teams } from './db/schema.js';
import { scheduleApply } from './teams/runtime.js';

await runMigrations();
await seedReservedNames();
await ensurePlatformPackage();
const app = await buildApp();
startWorkers(app.log);
await app.listen({ host: '0.0.0.0', port: config.port });

// After a deploy, running teams get the current apply-config too (new config rules reach them without a
// team restart). Delayed so the orchestrator, redeployed at the same time, is up.
setTimeout(() => {
  void reconcilePackageServers().catch((err) => app.log.warn({ err }, 'mcp package reconcile failed'));
  void db.select({ name: teams.name }).from(teams)
    .where(and(eq(teams.containerStatus, 'running'), isNull(teams.deletedAt)))
    .then((rows) => { for (const t of rows) void scheduleApply(t.name); })
    .catch((err) => app.log.warn({ err }, 'startup apply-config failed'));
}, 20_000).unref();

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => void app.close().then(() => process.exit(0)));
}
