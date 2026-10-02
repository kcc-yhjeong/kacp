import type { FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { csrfTokenFor } from '../lib/crypto.js';
import { ApiError } from '../lib/errors.js';
import { resolveSession, SESSION_COOKIE, type SessionContext } from './session.js';

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionContext | null;
  }
}

const SETUP_ALLOWED = new Set(['/api/v1/auth/me', '/api/v1/auth/password', '/api/v1/auth/logout']);
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** onRequest hook: attaches the session (or null) to every request. */
export async function loadSession(req: FastifyRequest) {
  req.session = await resolveSession(req.cookies[SESSION_COOKIE]);
}

/** Route guard for every `로그인` endpoint (04-api.md §2). Also enforces CSRF and setup-only sessions. */
export async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
  const s = req.session;
  if (!s) throw new ApiError(401, 'AUTH_REQUIRED');
  const path = req.routeOptions.url ?? req.url;
  if (s.setupOnly && !SETUP_ALLOWED.has(path)) throw new ApiError(403, 'AUTH_PASSWORD_CHANGE_REQUIRED');
  if (MUTATING.has(req.method)) checkCsrf(req, s.sessionId);
}

export async function requirePlatformAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireAuth(req, reply);
  if (req.session?.user.platformRole !== 'admin') throw new ApiError(403, 'FORBIDDEN');
}

function checkCsrf(req: FastifyRequest, sessionId: string) {
  const sent = req.headers['x-kacp-csrf'];
  const expected = Buffer.from(csrfTokenFor(sessionId));
  const got = Buffer.from(typeof sent === 'string' ? sent : '');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new ApiError(403, 'CSRF_INVALID');
}

/** Bearer INTERNAL_TOKEN for service-to-service routes (04-api.md §3). */
export async function requireInternal(req: FastifyRequest) {
  const auth = req.headers.authorization ?? '';
  const expected = Buffer.from(`Bearer ${config.internalToken}`);
  const got = Buffer.from(auth);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new ApiError(401, 'AUTH_REQUIRED');
}
