import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
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
    return reply.code(200).send();
  });
}
