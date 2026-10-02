import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import { classifyHost, ERROR_MESSAGES } from '@kacp/shared';
import { appOrigin, config } from './config.js';
import { authRoutes } from './auth/routes.js';
import { loadSession } from './auth/guards.js';
import { forwardAuthRoutes } from './forward-auth/route.js';
import { internalEventRoutes } from './internal/events.js';
import { ApiError } from './lib/errors.js';
import { teamByName } from './teams/lookup.js';
import { teamRoutes } from './teams/routes.js';
import { memberRoutes } from './teams/members.js';
import { adminUserRoutes } from './admin/users.js';
import { adminTeamRoutes } from './admin/teams.js';
import { templateRoutes } from './admin/templates.js';
import { opsRoutes } from './admin/ops.js';
import { orgRoutes } from './org/routes.js';
import { importRoutes } from './import/routes.js';

// CORS (06-auth.md §3): credentials only for the app origin and existing team hosts.
// App hosts (`slug--team`, public names) never get CORS, so user-built apps cannot call the API as the user.
async function allowedOrigin(origin: string): Promise<boolean> {
  if (origin === appOrigin) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== `${config.scheme}:` || url.port) return false;
  const hc = classifyHost(url.hostname, config.baseDomain);
  return hc.kind === 'name' && (await teamByName(hc.name)) !== null;
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  // Action endpoints (session, heartbeat, logout) are POSTs without a body; accept an empty JSON body.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (body === '') return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error('invalid JSON'), { statusCode: 400 }), undefined);
    }
  });

  app.decorateRequest('session', null);
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && req.url.startsWith('/api/') && (await allowedOrigin(origin))) {
      reply.header('access-control-allow-origin', origin);
      reply.header('access-control-allow-credentials', 'true');
      reply.header('vary', 'Origin');
      if (req.method === 'OPTIONS') {
        reply.header('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE');
        reply.header('access-control-allow-headers', 'content-type, x-kacp-csrf');
        reply.header('access-control-max-age', '600');
        return reply.code(204).send();
      }
    }
    await loadSession(req);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_FAILED', message: ERROR_MESSAGES.VALIDATION_FAILED, details: { issues: err.issues } },
      });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.code(status).send({ error: { code: 'VALIDATION_FAILED', message: ERROR_MESSAGES.VALIDATION_FAILED } });
    }
    req.log.error({ err }, 'unhandled');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: ERROR_MESSAGES.INTERNAL } });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: ERROR_MESSAGES.NOT_FOUND } }));

  app.get('/healthz', async () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(teamRoutes);
  await app.register(forwardAuthRoutes);
  await app.register(internalEventRoutes);
  await app.register(memberRoutes);
  await app.register(adminUserRoutes);
  await app.register(adminTeamRoutes);
  await app.register(templateRoutes);
  await app.register(opsRoutes);
  await app.register(orgRoutes);
  await app.register(importRoutes);
  return app;
}
