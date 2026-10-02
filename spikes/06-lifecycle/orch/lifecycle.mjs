// spike 06 — orchestrator 대역. Docker Engine API(소켓 프록시 경유)만 쓴다. 의존성 없음.
// usage: node /orch/lifecycle.mjs <cmd> [team] [n]
//   up <team>         없으면 생성(+첫 기동에만 시드) → 기동 → healthy 대기
//   stop|start|rm <team>
//   bench <team> <n>  콜드(rm→create→start→healthy) n회 + 웜(stop→start→healthy) n회
//   deny [team]       허용하지 않은 API 가 막히는지
import fs from 'node:fs';

const D = process.env.DOCKER;
const IMAGE = process.env.OPENCLAW_IMAGE;
const V = '/v1.43';

async function api(method, path, body, rawTar) {
  const headers = rawTar ? { 'content-type': 'application/x-tar' } : body ? { 'content-type': 'application/json' } : {};
  const r = await fetch(D + V + path, { method, headers, body: rawTar ?? (body ? JSON.stringify(body) : undefined) });
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}
const cname = (team) => `kacp-team-${team}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 최소 ustar 한 파일 (owner 1000:1000, mode 0600)
function tar(filename, content) {
  const data = Buffer.from(content);
  const h = Buffer.alloc(512, 0);
  const put = (s, off, len) => h.write(s, off, len, 'ascii');
  const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  put(filename, 0, 100);
  put(oct(0o600, 8), 100, 8);
  put(oct(1000, 8), 108, 8);
  put(oct(1000, 8), 116, 8);
  put(oct(data.length, 12), 124, 12);
  put(oct(Math.floor(Date.now() / 1000), 12), 136, 12);
  put('        ', 148, 8);
  put('0', 156, 1);
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  put('node', 265, 32);
  put('node', 297, 32);
  let sum = 0;
  for (const b of h) sum += b;
  put(oct(sum, 7) + ' ', 148, 8);
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512, 0);
  return Buffer.concat([h, data, pad, Buffer.alloc(1024, 0)]);
}

async function create(team) {
  const stateMount = process.env.STATE_MODE === 'bind'
    ? { Type: 'bind', Source: `${process.env.DATA_ROOT}/teams/${team}/openclaw`, Target: '/home/node/.openclaw' }
    : { Type: 'volume', Source: `kacp06-${team}-state`, Target: '/home/node/.openclaw' };
  const r = await api('POST', `/containers/create?name=${cname(team)}`, {
    Image: IMAGE,
    Env: [`OPENCLAW_GATEWAY_PASSWORD=${process.env.TEAM1_GATEWAY_PASSWORD}`],
    Labels: { 'kacp.kind': 'team', 'kacp.team': team, 'kacp.id': `spike06-${team}` },
    // 이미지 기본 interval 180s 대신 짧게 (04-api §3 ensure-running)
    Healthcheck: { Test: ['CMD', 'node', 'dist/docker-healthcheck.js'], Interval: 30e9, Timeout: 10e9, StartPeriod: 60e9, StartInterval: 2e9, Retries: 3 },
    HostConfig: { Mounts: [stateMount], Memory: 2 * 1024 ** 3, NanoCpus: 2e9, RestartPolicy: { Name: 'no' } },
    NetworkingConfig: { EndpointsConfig: { [process.env.EDGE_NETWORK]: {} } },
  });
  if (r.status !== 201) throw new Error('create ' + r.status + ' ' + JSON.stringify(r.body));
  // 첫 기동에만 시드: 파일이 있으면 건드리지 않는다 (덮어쓰면 OpenClaw 가 오래된 백업으로 되돌림 — spike 03)
  const head = await fetch(`${D}${V}/containers/${cname(team)}/archive?path=/home/node/.openclaw/openclaw.json`, { method: 'HEAD' });
  if (head.status === 404) {
    const up = await api('PUT', `/containers/${cname(team)}/archive?path=/home/node/.openclaw`, null,
      tar('openclaw.json', fs.readFileSync('/orch/seed-openclaw.json', 'utf8')));
    console.log('seed', up.status === 200 ? 'written' : `FAILED ${up.status} ${JSON.stringify(up.body)}`);
  } else {
    console.log(`seed skipped (HEAD ${head.status})`);
  }
}

async function waitHealthy(team, timeoutMs = 180000) {
  const t0 = Date.now();
  for (;;) {
    const r = await api('GET', `/containers/${cname(team)}/json`);
    const health = r.body?.State?.Health?.Status;
    const status = r.body?.State?.Status;
    if (health === 'healthy') return Date.now() - t0;
    if (status === 'exited') throw new Error('exited: ' + JSON.stringify(r.body.State));
    if (Date.now() - t0 > timeoutMs) throw new Error('timeout, health=' + health);
    await sleep(500);
  }
}
const exists = async (team) => (await api('GET', `/containers/${cname(team)}/json`)).status === 200;
async function start(team) {
  const r = await api('POST', `/containers/${cname(team)}/start`);
  if (![204, 304].includes(r.status)) throw new Error('start ' + r.status + ' ' + JSON.stringify(r.body));
}
const stop = async (team) => (await api('POST', `/containers/${cname(team)}/stop?t=30`)).status;
const rm = async (team) => (await api('DELETE', `/containers/${cname(team)}?force=true`)).status;
const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);

const [, , cmd, team = 'team1', n = '5'] = process.argv;
if (cmd === 'up') {
  if (!(await exists(team))) await create(team);
  const t0 = Date.now();
  await start(team);
  await waitHealthy(team);
  console.log('up → healthy', Date.now() - t0, 'ms');
} else if (cmd === 'stop') {
  console.log('stop', await stop(team));
} else if (cmd === 'start') {
  const t0 = Date.now();
  await start(team);
  await waitHealthy(team);
  console.log('start → healthy', Date.now() - t0, 'ms');
} else if (cmd === 'rm') {
  console.log('rm', await rm(team));
} else if (cmd === 'bench') {
  const cold = [];
  const warm = [];
  for (let i = 0; i < +n; i++) {
    // 반드시 정상 정지 후 삭제: 실행 중 강제 삭제(SIGKILL)하면 상태 폴더 소유권 lease 가 ~5분 남아 새 컨테이너가 못 뜬다
    await stop(team);
    await rm(team);
    const t0 = Date.now();
    await create(team);
    await start(team);
    await waitHealthy(team);
    cold.push(Date.now() - t0);
    console.log(`cold #${i + 1}: ${cold.at(-1)} ms`);
  }
  for (let i = 0; i < +n; i++) {
    await stop(team);
    const t0 = Date.now();
    await start(team);
    await waitHealthy(team);
    warm.push(Date.now() - t0);
    console.log(`warm #${i + 1}: ${warm.at(-1)} ms`);
  }
  console.log(JSON.stringify({ coldAvgMs: avg(cold), coldMs: cold, warmAvgMs: avg(warm), warmMs: warm }));
} else if (cmd === 'deny') {
  const checks = [
    ['GET', '/containers/json?filters=' + encodeURIComponent(JSON.stringify({ label: ['kacp.kind=team'] }))],
    ['GET', '/images/json'],
    ['POST', '/images/create?fromImage=alpine&tag=latest'],
    ['GET', '/volumes'],
    ['POST', '/volumes/create', { Name: 'kacp06-should-not-exist' }],
    ['GET', '/info'],
    ['POST', '/networks/create', { Name: 'kacp06-should-not-exist' }],
    ['POST', `/containers/${cname(team)}/exec`, { Cmd: ['id'] }],
  ];
  for (const [m, p, b] of checks) {
    const r = await api(m, p, b);
    console.log(m.padEnd(5), p.slice(0, 64).padEnd(64), r.status);
  }
} else {
  console.log('usage: up|stop|start|rm|bench|deny [team] [n]');
}
