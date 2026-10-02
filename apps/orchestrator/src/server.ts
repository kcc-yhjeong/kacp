import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { NAME_PATTERN } from '@kacp/shared';
import { config } from './config.js';
import { ensureRunning, provision, startHealthWatch, stop } from './teams.js';

// Internal API — called by the api only, over kacp-core with the shared token (04-api.md §3).

const Spec = z.object({
  gatewayPassword: z.string().min(16),
  adminEmails: z.array(z.string()),
  resourceLimits: z.object({ cpu: z.number().positive(), memoryMb: z.number().int().positive(), diskGb: z.number().int().positive() }),
});
const TeamParams = z.object({ team: z.string().regex(NAME_PATTERN) });

const app = Fastify({ logger: { level: config.logLevel } });
const expected = Buffer.from(`Bearer ${config.internalToken}`);

app.addHook('onRequest', async (req, reply) => {
  if (req.url === '/healthz') return;
  const got = Buffer.from(req.headers.authorization ?? '');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return reply.code(401).send();
});

app.get('/healthz', async () => ({ ok: true }));

app.post('/internal/teams/:team/provision', async (req, reply) => {
  const { team } = TeamParams.parse(req.params);
  await provision(team, Spec.parse(req.body));
  return reply.code(204).send();
});

app.post('/internal/teams/:team/ensure-running', async (req, reply) => {
  const { team } = TeamParams.parse(req.params);
  const spec = Spec.parse(req.body);
  void ensureRunning(team, spec);
  return reply.code(202).send({ accepted: true });
});

app.post('/internal/teams/:team/stop', async (req, reply) => {
  const { team } = TeamParams.parse(req.params);
  void stop(team);
  return reply.code(202).send({ accepted: true });
});

startHealthWatch((msg) => app.log.warn(msg));
await app.listen({ host: '0.0.0.0', port: config.port });
