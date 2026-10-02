import { parseArgs } from 'node:util';
import { createTeam, createUser, seedReservedNames } from './admin/service.js';
import { runMigrations, sqlClient } from './db/client.js';

// Stage 2 operator CLI (the admin screens arrive in stage 3).
//   user:create --email a@kcc.co.kr --name 홍길동 [--admin] [--password ...]
//   team:create --name team1 --display 마케팅팀 --admins a@kcc.co.kr [--members b@...,c@...]
//   demo        creates the demo accounts and team1 (docs/README.md 2단계 데모)

const [cmd, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    display: { type: 'string' },
    password: { type: 'string' },
    admin: { type: 'boolean' },
    admins: { type: 'string' },
    members: { type: 'string' },
  },
});
const list = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

await runMigrations();
await seedReservedNames();
try {
  if (cmd === 'user:create') {
    const u = await createUser(
      { email: values.email!, name: values.name!, platformRole: values.admin ? 'admin' : 'user', password: values.password },
      null,
    );
    console.log(`created ${u.email} — initial password: ${u.initialPassword}`);
  } else if (cmd === 'team:create') {
    const t = await createTeam({ name: values.name!, displayName: values.display!, admins: list(values.admins), members: list(values.members) }, null);
    console.log(`created team ${t.name}`);
  } else if (cmd === 'demo') {
    const pw = values.password ?? 'Kacp-demo-2026';
    const people = [
      { email: 'admin@kcc.co.kr', name: '플랫폼관리자', platformRole: 'admin' as const },
      { email: 'kim@kcc.co.kr', name: '김하늘' },
      { email: 'lee@kcc.co.kr', name: '이준호' },
      { email: 'park@kcc.co.kr', name: '박소연' },
    ];
    for (const p of people) await createUser({ ...p, password: pw }, null);
    await createTeam({ name: 'team1', displayName: '마케팅팀', admins: ['kim@kcc.co.kr'], members: ['lee@kcc.co.kr'] }, null);
    console.log(`demo ready — password for all: ${pw} (must change on first login). park@ has no team.`);
  } else {
    console.log('usage: user:create | team:create | demo');
    process.exitCode = 1;
  }
} finally {
  await sqlClient.end();
}
