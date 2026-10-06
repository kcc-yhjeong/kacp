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
  /** Volume mode: the named volume that holds /data (drive). Bind mode uses dataRoot host paths. */
  dataVolume: process.env.DATA_VOLUME ?? 'kacp-data',
  /** Bind mode only: sandbox image and the per-team sandbox socket proxy image (05 §6). */
  sandboxImage: process.env.SANDBOX_IMAGE ?? 'openclaw-sandbox:bookworm-slim',
  appRuntimeTag: process.env.APP_RUNTIME_TAG ?? '1',
  socketProxyImage: process.env.SOCKET_PROXY_IMAGE ?? 'tecnativa/docker-socket-proxy:v0.5.0',
  /** Build-only socket proxy (BUILD IMAGES POST): MCP image builds and image pulls (05 §6). */
  buildDockerUrl: process.env.DOCKER_BUILD_URL ?? 'http://docker-build-proxy:2375',
  /** Dependency scanner for MCP sources. 0.69.3 predates the 2026-03 trivy release compromise. */
  trivyImage: process.env.TRIVY_IMAGE ?? 'aquasec/trivy:0.69.3',
};

// ── MCP (docs/README.md 6단계, 05 §6) ──
export const MCP_PORT = 8080;
export const EGRESS_PORT = 3128;
/** Internal network where uploaded MCP images are tested (this orchestrator is attached by compose). */
export const MCP_TEST_NETWORK = 'kacp-mcp-test';
/** Bridge network with outside access; only egress proxies sit on it. */
export const EGRESS_NETWORK = 'kacp-egress';
export const TRIVY_CACHE_VOLUME = 'kacp-trivy-cache';
/** Internal network shared by MCP servers, their egress proxies and every team container. */
export const MCP_NETWORK = 'kacp-mcp';
/** One server per package for all teams; secrets come per call as headers (docs/README.md 6단계). */
export const mcpContainer = (pkg: string) => `kacp-mcp-${pkg}`;
export const mcpProxyContainer = (pkg: string) => `kacp-mcpproxy-${pkg}`;
export const mcpServerUrl = (pkg: string) => `http://${mcpContainer(pkg)}:${MCP_PORT}/mcp`;
export const mcpImage = (pkg: string, version: string) => `kacp-mcp/${pkg}:${version}`;
/** Upload, logs and scan report of one version, relative to the data root. */
export const mcpVersionRel = (pkg: string, version: string) => `mcp/${pkg}/${version}`;
/** Team Secret Store (root 0600, never mounted into the team container). */
export const mcpSecretsDir = (team: string, key: string) => `${config.dataRoot}/teams/${team}/mcp/${key}`;

export const GATEWAY_PORT = 18789;
export const STATE_DIR = '/home/node/.openclaw';
export const OPENCLAW_UID = 1000;

export const GWAGENT_PORT = 18800;
/** OpenClaw sandbox listener (HTML previews, Canvas; MCP Apps if ever enabled). */
export const SANDBOX_LISTENER_PORT = 18790;
/** `{team}--sbx.{base}`: a separate origin for that listener ("sbx" is a reserved name — 05 §2). */
export const sandboxHost = (team: string) => `${team}--sbx.${config.baseDomain}`;
export const sandboxOrigin = (team: string) => `${config.scheme}://${sandboxHost(team)}`;

export const teamContainer = (team: string) => `kacp-team-${team}`;
export const gwagentContainer = (team: string) => `kacp-gwagent-${team}`;
export const teamStateVolume = (team: string) => `kacp-team-${team}-state`;
export const teamStateHostDir = (team: string) => `${config.dataRoot}/teams/${team}/openclaw`;
/** Team shared drive, relative to the data root (volume subpath) and absolute (bind / inside this container). */
export const teamSharedRel = (team: string) => `teams/${team}/drive/shared`;
export const teamSharedDir = (team: string) => `${config.dataRoot}/${teamSharedRel(team)}`;
/** Where agents see the shared drive (docs/README.md 4단계). */
export const TEAM_DRIVE_PATH = '/team-drive';
export const MAIN_WORKSPACE_DRIVE = `${'/home/node/.openclaw'}/workspace/team-drive`;
export const sbxProxyContainer = (team: string) => `kacp-sbx-proxy-${team}`;
export const sbxNetwork = (team: string) => `kacp-sbx-${team}`;
/** Sandboxes need bind-mounted sources (OpenClaw docker-backend), so only the VM (bind) mode enables them. */
export const sandboxEnabled = () => config.stateMode === 'bind';
