import { buildApp } from './app.js';
import { config } from './config.js';
import { runMigrations } from './db/client.js';
import { seedReservedNames } from './admin/service.js';
import { startWorkers } from './workers.js';

await runMigrations();
await seedReservedNames();
const app = await buildApp();
startWorkers(app.log);
await app.listen({ host: '0.0.0.0', port: config.port });

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => void app.close().then(() => process.exit(0)));
}
