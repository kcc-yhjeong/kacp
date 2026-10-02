// Orchestrator configuration (05-urls-and-storage.md §5–§7).

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  /** docker-socket-proxy (orchestrator-only, limited API — spike 06). */
  dockerUrl: process.env.DOCKER_URL ?? 'http://docker-socket-proxy:2375',
  openclawImage: process.env.OPENCLAW_IMAGE ?? 'kacp/openclaw:2026.9.7-1',
  /** `bind` on the VM (/data/teams/{team}/openclaw), `volume` on Windows Docker Desktop (bind chmod fails — spike 01). */
  stateMode: (process.env.STATE_MODE === 'bind' ? 'bind' : 'volume') as 'bind' | 'volume',
  /** Host path of the data disk (bind sources) — also where it is mounted inside this container. */
  dataRoot: process.env.DATA_ROOT ?? '/data',
  edgeNetwork: process.env.EDGE_NETWORK ?? 'kacp-edge',
  /** Traefik's fixed address on kacp-edge → openclaw.json gateway.trustedProxies. */
  traefikIp: required('TRAEFIK_IP'),
  baseDomain: required('BASE_DOMAIN'),
  scheme: (process.env.PUBLIC_SCHEME === 'http' ? 'http' : 'https') as 'http' | 'https',
  apiUrl: process.env.API_URL ?? 'http://api:3000',
  internalToken: required('INTERNAL_TOKEN'),
  /** Env var names copied into team containers (model provider keys until platform settings exist in stage 3). */
  teamEnvPassthrough: (process.env.TEAM_ENV_PASSTHROUGH ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  /** Requests arriving on this subnet (kacp-edge) are refused: only the api on kacp-core may call us. */
  edgeSubnetPrefix: process.env.EDGE_SUBNET_PREFIX ?? '172.30.',
  /** Image that runs the Gateway sidecar (this orchestrator image, `node dist/gwagent.js`). */
  gwagentImage: process.env.GWAGENT_IMAGE ?? 'kacp/orchestrator:dev',
};

export const GATEWAY_PORT = 18789;
export const STATE_DIR = '/home/node/.openclaw';
export const OPENCLAW_UID = 1000;

export const GWAGENT_PORT = 18800;

export const teamContainer = (team: string) => `kacp-team-${team}`;
export const gwagentContainer = (team: string) => `kacp-gwagent-${team}`;
export const teamStateVolume = (team: string) => `kacp-team-${team}-state`;
export const teamStateHostDir = (team: string) => `${config.dataRoot}/teams/${team}/openclaw`;
