// usage: node /orch/rpc.mjs <path> <auth:pw|none|wrong> <method> [paramsJSON]
const [, , path, auth, method, params] = process.argv;
const headers = { 'content-type': 'application/json' };
if (auth === 'pw') headers.authorization = 'Bearer ' + process.env.GW_PASSWORD;
if (auth === 'wrong') headers.authorization = 'Bearer wrong';
const r = await fetch(process.env.GW + path, { method: 'POST', headers, body: JSON.stringify({ method, params: params ? JSON.parse(params) : {} }) });
const t = await r.text();
console.log(r.status, process.env.FULL ? t : t.slice(0, 400));
