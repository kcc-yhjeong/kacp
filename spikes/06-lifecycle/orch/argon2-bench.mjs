// spike 06 — argon2id 해시 시간(06-auth §2: m=64MB, t=3, p=1 → 로그인 300ms 내외 목표)
import { hash, verify } from '@node-rs/argon2';
const cases = [[65536, 3, 1], [65536, 2, 1], [47104, 2, 1], [19456, 2, 1], [131072, 3, 1]];
for (const [m, t, p] of cases) {
  const h = await hash('correct horse battery staple', { memoryCost: m, timeCost: t, parallelism: p, algorithm: 2 });
  const xs = [];
  for (let i = 0; i < 7; i++) {
    const t0 = performance.now();
    await verify(h, 'correct horse battery staple');
    xs.push(performance.now() - t0);
  }
  xs.sort((a, b) => a - b);
  console.log(`m=${m / 1024}MB t=${t} p=${p}  verify median=${xs[3].toFixed(0)}ms  min=${xs[0].toFixed(0)} max=${xs[6].toFixed(0)}`);
}
