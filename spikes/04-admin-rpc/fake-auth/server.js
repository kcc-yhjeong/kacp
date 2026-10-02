// 가짜 forward-auth. 실제 KACP api 의 /internal/forward-auth 자리를 대신한다.
// 쿠키 kacp_dev_user 로 사용자를 고르고, 팀 멤버십을 확인한 뒤 신원 헤더를 돌려준다.
const http = require('http');

const USERS = {
  alice: { email: 'alice@kcc.dev', teams: { team1: 'team_admin' } },
  bob:   { email: 'bob@kcc.dev',   teams: { team1: 'member' } },
  carol: { email: 'carol@kcc.dev', teams: {} }, // team1 멤버 아님 -> 403 확인용
};

const SCOPES = {
  // WebSocket 에서는 cap 역할만 한다 (grant 아님). admin 은 identityScopes 로 부여.
  team_admin: 'operator.admin,operator.read,operator.write,operator.approvals,operator.questions',
  member: 'operator.read,operator.write,operator.approvals,operator.questions',
};

const cookie = (req, name) =>
  (req.headers.cookie || '').split(';').map(s => s.trim().split('='))
    .find(([k]) => k === name)?.[1];

const log = (...a) => console.log(new Date().toISOString(), ...a);

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  // Traefik forwardAuth 가 호출
  if (url.pathname === '/verify') {
    const host = req.headers['x-forwarded-host'] || '';
    const uri = req.headers['x-forwarded-uri'] || '/';
    const team = host.split('.')[0];
    const id = cookie(req, 'kacp_dev_user');
    const user = USERS[id];
    const isWs = (req.headers['upgrade'] || '').toLowerCase() === 'websocket';

    if (!user) {
      log('verify', host, uri, '-> 302 login', isWs ? '(ws)' : '');
      // 절대 URL 필수: Traefik forwardAuth 는 상대 Location 을 인증 서버 주소(http://fake-auth:4000) 기준으로 바꿔 버린다.
      const proto = req.headers['x-forwarded-proto'] || 'http';
      res.writeHead(302, { Location: `${proto}://${host}/_kacp/login?rd=${encodeURIComponent(uri)}` });
      return res.end();
    }
    const role = user.teams[team];
    if (!role) {
      log('verify', host, uri, id, '-> 403 not member');
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<p>${user.email} 은(는) ${team} 멤버가 아닙니다. <a href="/_kacp/login">다른 사용자</a></p>`);
    }
    log('verify', host, uri, id, role, '-> 200', isWs ? '(ws)' : '');
    res.writeHead(200, {
      'X-Forwarded-User': user.email,
      'X-Openclaw-Scopes': SCOPES[role],
    });
    return res.end();
  }

  if (url.pathname === '/_kacp/login') {
    const as = url.searchParams.get('as');
    const rd = url.searchParams.get('rd') || '/';
    if (as && USERS[as]) {
      res.writeHead(302, {
        'Set-Cookie': `kacp_dev_user=${as}; Path=/; HttpOnly; SameSite=Lax`,
        Location: rd.startsWith('/') ? rd : '/',
      });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<h3>KACP dev login</h3>` + Object.entries(USERS).map(([k, u]) =>
      `<p><a href="/_kacp/login?as=${k}&rd=${encodeURIComponent(rd)}">${u.email}</a> ${JSON.stringify(u.teams)}</p>`
    ).join(''));
  }

  if (url.pathname === '/_kacp/logout') {
    res.writeHead(302, { 'Set-Cookie': 'kacp_dev_user=; Path=/; Max-Age=0', Location: '/_kacp/login' });
    return res.end();
  }

  // spike 03: 셸 자리. 같은 팀 주소에서 /claw 를 iframe 으로 띄운다.
  if (url.pathname === '/') {
    const email = req.headers['x-forwarded-user'] || '(unknown)';
    let start = url.searchParams.get('start') || '/claw/';
    if (!start.startsWith('/claw')) start = '/claw/';
    const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><meta charset="utf-8"><title>KACP 셸 (spike 03)</title>
<style>body{margin:0;font-family:system-ui,sans-serif}header{height:44px;display:flex;gap:14px;align-items:center;padding:0 12px;background:#111;color:#eee;font-size:14px}header a{color:#9cf}iframe{display:block;border:0;width:100%;height:calc(100vh - 44px)}</style>
<header><b>KACP 셸</b><span>${esc(email)}</span><span>iframe: ${esc(start)}</span>
<a href="/?start=/claw/">/claw/</a><a href="/?start=/claw/new">/claw/new</a><a href="/_kacp/logout">로그아웃</a></header>
<iframe src="${esc(start)}" allow="clipboard-write; microphone"></iframe>`);
  }

  res.writeHead(404); res.end();
}).listen(4000, () => log('fake-auth listening :4000'));
