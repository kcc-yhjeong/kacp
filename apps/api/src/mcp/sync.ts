import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { mcpInstalls, teams } from '../db/schema.js';
import { newId } from '../lib/crypto.js';
import { orchestrator } from '../orchestrator.js';
import { scheduleApply } from '../teams/runtime.js';
import { codexHidesTools, planSync, type Servers } from './logic.js';

// Gateway sync (03-data-model.md mcp_installs, every minute): running teams' `mcp.servers` vs the DB.
// - a server only in the Gateway (added in the Control UI) → recorded as `manual`
// - a manual row whose server is gone from the Gateway → dropped
// - an installed market/default server missing from the Gateway → apply-config again
// - the Codex harness turned on after apply-config (MCP tools hidden) → apply-config again


export async function syncGateways(log: { warn: (o: object, m: string) => void }) {
  const running = await db.select().from(teams).where(and(eq(teams.containerStatus, 'running'), isNull(teams.deletedAt)));
  for (const t of running) {
    try {
      const got = await orchestrator.gatewayConfig(t.name);
      const cfg = got.payload?.config ?? got.payload?.parsed ?? {};
      const servers = ((cfg as { mcp?: { servers?: Servers } }).mcp?.servers) ?? {};
      const rows = await db.select().from(mcpInstalls).where(eq(mcpInstalls.teamId, t.id));
      const plan = planSync(servers, rows);
      for (const m of plan.addManual) {
        await db.insert(mcpInstalls).values({
          id: newId(), teamId: t.id, source: 'manual', manualName: m.key, manualUrl: m.url, serverKey: m.key,
          status: 'installed', installedBy: null, lastCheckedAt: sql`now()`,
        }).onConflictDoNothing();
      }
      for (const key of plan.dropManual) {
        await db.delete(mcpInstalls).where(and(eq(mcpInstalls.teamId, t.id), eq(mcpInstalls.serverKey, key), eq(mcpInstalls.source, 'manual')));
      }
      await db.update(mcpInstalls).set({ lastCheckedAt: sql`now()` }).where(eq(mcpInstalls.teamId, t.id));
      if (plan.reapply || codexHidesTools(cfg)) void scheduleApply(t.name);
    } catch (err) {
      log.warn({ err, team: t.name }, 'mcp gateway sync failed');
    }
  }
}
