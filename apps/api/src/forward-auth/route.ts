import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { apps } from '../db/schema.js';
import { appForHost } from '../apps/service.js';
import { membershipRole, nameOwner, teamByName } from '../teams/lookup.js';
import { decide, type ForwardAuthDeps } from './decide.js';

const deps: ForwardAuthDeps = {
  baseDomain: config.baseDomain,
  scheme: config.scheme,
  lookupName: nameOwner,
  lookupTeam: async (team) => {
    const t = await teamByName(team);
    return t ? { teamId: t.id } : null;
  },
  membership: membershipRole,
};

const header = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

// App visits keep copies awake (docs/README.md 5단계): last_accessed_at at most once a minute per host.
const lastTouch = new Map<string, number>();
async function touchApp(host: string) {
  const now = Date.now();
  if (now - (lastTouch.get(host) ?? 0) < 60_000) return;
  lastTouch.set(host, now);
  const found = await appForHost(host);
  if (!found) return;
  await db.update(apps).set(found.copy === 'work' ? { workLastAccessedAt: sql`now()` } : { publicLastAccessedAt: sql`now()` })
    .where(eq(apps.id, found.app.id));
}

/** Called by Traefik for every request on team, app and fallback routers (06-auth.md §5). */
export async function forwardAuthRoutes(app: FastifyInstance) {
  app.get('/internal/forward-auth', { logLevel: 'warn' }, async (req, reply) => {
    const d = await decide(
      {
        host: header(req.headers['x-forwarded-host']),
        uri: header(req.headers['x-forwarded-uri']) || '/',
        accept: header(req.headers.accept),
        // Traefik may drop Upgrade/Connection on the auth request; Sec-WebSocket-Version survives.
        upgrade: header(req.headers.upgrade) || (req.headers['sec-websocket-version'] ? 'websocket' : ''),
        session: req.session,
      },
      deps,
    );
    if (d.status === 302) return reply.code(302).header('location', d.location).send();
    if (d.status !== 200) return reply.code(d.status).send();
    for (const [k, v] of Object.entries(d.headers)) reply.header(k, v);
    const host = header(req.headers['x-forwarded-host']);
    if (d.headers['X-KACP-User-Id'] && (host.includes('--') || !d.headers['X-KACP-Team'])) {
      void touchApp(host).catch((err) => req.log.warn({ err }, 'app touch failed'));
    }
    return reply.code(200).send();
  });
}
