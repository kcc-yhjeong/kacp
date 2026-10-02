import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { NAME_PATTERN } from '@kacp/shared';
import { config } from './config.js';
import {
  adoptRunning, applyConfig, ensureRunning, gatewayRpc, provision, removeTeam, restart, startHealthWatch, stop, updateResources,
} from './teams.js';
import { startUsageCollector } from './usage.js';

// Internal API — called by the api only, over kacp-core with the shared token (04-api.md §3).
// The orchestrator is also on kacp-edge (to reach sidecars); anything arriving from there is refused.

const Limits = z.object({ cpu: z.number().positive(), memoryMb: z.number().int().positive(), diskGb: z.number().int().positive() });
const Spec = z.object({
  gatewayPassword: z.string().min(16),
  adminEmails: z.array(z.string()),
  resourceLimits: Limits,
  env: z.record(z.string().regex(/^[A-Z][A-Z0-9_]*$/), z.string()).default({}),
});
const Agent = z.object({
  id: z.string().regex(/^kacp-[a-z0-9]+$/),
  name: z.string(),
  emoji: z.string(),
  model: z.string().nullable(),
  thinking: z.enum(['low', 'medium', 'high']).nullable(),
  instructions: z.string(),
  skills: z.array(z.string()),
  tools: z.object({ allow: z.array(z.string()), deny: z.array(z.string()) }),
});
const Desired = z.object({ agents: z.array(Agent), adminEmails: z.array(z.string()) });
const TeamParams = z.object({ team: z.string().regex(NAME_PATTERN) });

const app = Fastify({ logger: { level: config.logLevel } });
const expected = Buffer.from(`Bearer ${config.internalToken}`);

app.addHook('onRequest', async (req, reply) => {
  if (req.url === '/healthz') return;
  const local = req.socket.localAddress ?? '';
  if (local.replace(/^::ffff:/, '').startsWith(config.edgeSubnetPrefix)) return reply.code(403).send();
  const got = Buffer.from(req.headers.authorization ?? '');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return reply.code(401).send();
});

app.setErrorHandler((err, req, reply) => {
  if (err instanceof z.ZodError) return reply.code(400).send({ message: 'invalid request', issues: err.issues });
  req.log.error({ err }, 'request failed');
  return reply.code(502).send({ message: err instanceof Error ? err.message : String(err) });
});

app.get('/healthz', async () => ({ ok: true }));

app.post('/internal/teams/:team/provision', async (req, reply) => {
  const { team } = TeamParams.parse(req.params);
  void provision(team, Spec.parse(req.body));
  return reply.code(202).send({ accepted: true });
});

app.post('/internal/teams/:team/ensure-running', async (req, reply) => {
  const { team } = TeamParams.parse(req.params);
  void ensureRunning(team, Spec.parse(req.body));
  return reply.code(202).send({ accepted: true });
});

app.post('/internal/teams/:team/restart', async (req, reply) => {
  const { team } = TeamParams.parse(req.params);
  void restart(team, Spec.parse(req.body));
  return reply.code(202).send({ accepted: true });
});

app.post('/internal/teams/:team/stop', async (req, reply) => {
  const { team } = TeamParams.parse(req.params);
  void stop(team);
  return reply.code(202).send({ accepted: true });
});

app.post('/internal/teams/:team/apply-config', async (req) => {
  const { team } = TeamParams.parse(req.params);
  return applyConfig(team, Desired.parse(req.body));
});

app.put('/internal/teams/:team/resources', async (req, reply) => {
  const { team } = TeamParams.parse(req.params);
  await updateResources(team, Limits.parse(req.body));
  return reply.code(204).send();
});

app.delete('/internal/teams/:team', async (req, reply) => {
  const { team } = TeamParams.parse(req.params);
  await removeTeam(team);
  return reply.code(204).send();
});

// api → admin-http-rpc proxy (CLAUDE.md: the api never holds the Gateway password). Read-only methods only.
app.post('/internal/gateway/:team/rpc', async (req) => {
  const { team } = TeamParams.parse(req.params);
  const { method, params } = z.object({ method: z.enum(['config.get', 'health']), params: z.unknown().optional() }).parse(req.body);
  return gatewayRpc(team, method, params);
});

await adoptRunning().catch((err) => app.log.warn({ err }, 'adopt running teams failed'));
startHealthWatch((msg) => app.log.warn(msg));
startUsageCollector((msg) => app.log.warn(msg));
await app.listen({ host: '0.0.0.0', port: config.port });
