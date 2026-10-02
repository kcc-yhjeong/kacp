// orchestrator 대역: config.get 으로 hash 를 받고 config.patch(merge patch) 를 보낸다.
// usage: node /orch/cfg.mjs get <path>   |   node /orch/cfg.mjs patch '<rawJSON>'
const call = async (method, params = {}) => {
  const r = await fetch(process.env.GW + '/api/v1/admin/rpc', { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.GW_PASSWORD },
    body: JSON.stringify({ method, params }) });
  return { status: r.status, body: await r.json() };
};
const pick = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const [, , cmd, arg] = process.argv;
const got = await call('config.get');
const cfg = got.body.payload?.config ?? got.body.payload?.parsed ?? got.body.payload;
const hash = got.body.payload?.hash ?? got.body.payload?.baseHash;
if (cmd === 'get') { console.log('config.get', got.status, 'hash=' + String(hash).slice(0, 12), arg, '=', JSON.stringify(pick(cfg, arg))); }
if (cmd === 'keys') { console.log(Object.keys(got.body.payload || {})); }
if (cmd === 'patch') {
  const t0 = Date.now();
  const rp = process.argv[4] ? JSON.parse(process.argv[4]) : undefined;
  const res = await call('config.patch', { raw: arg, baseHash: hash, note: 'kacp spike 04', ...(rp ? { replacePaths: rp } : {}) });
  console.log('config.patch', res.status, Date.now() - t0 + 'ms', JSON.stringify(res.body).slice(0, 300));
}
