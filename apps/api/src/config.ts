// Environment configuration. Everything the api needs from outside comes through here.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

const scheme = process.env.PUBLIC_SCHEME === 'http' ? 'http' : 'https';

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  /** `kacp.cloud` on the VM, `kacp.localhost` locally. */
  baseDomain: required('BASE_DOMAIN'),
  scheme: scheme as 'http' | 'https',
  /** Shared bearer token for service-to-service calls (04-api.md §3). */
  internalToken: required('INTERNAL_TOKEN'),
  /** 32 bytes, base64. AES-256-GCM for `*_enc` columns and the CSRF HMAC key derivation. */
  encryptionKey: Buffer.from(required('APP_ENCRYPTION_KEY'), 'base64'),
  /** Data disk root (/data/teams/{team}/drive …). Locally the kacp-data volume. */
  dataRoot: process.env.DATA_ROOT ?? '/data',
  orchestratorUrl: process.env.ORCHESTRATOR_URL ?? 'http://orchestrator:4000',
  logLevel: process.env.LOG_LEVEL ?? 'info',
};

if (config.encryptionKey.length !== 32) throw new Error('APP_ENCRYPTION_KEY must be 32 bytes (base64)');

export const appOrigin = `${config.scheme}://app.${config.baseDomain}`;
export const teamUrl = (team: string) => `${config.scheme}://${team}.${config.baseDomain}`;
