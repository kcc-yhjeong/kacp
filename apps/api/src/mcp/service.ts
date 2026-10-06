import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { mcpGatewayKey, type McpManifest } from '@kacp/shared';
import { db } from '../db/client.js';
import { departments, mcpInstalls, mcpPackages, mcpVersions, teams, users, type McpFinding, type McpToolInfo } from '../db/schema.js';
import { config } from '../config.js';
import { newId } from '../lib/crypto.js';
import { ApiError } from '../lib/errors.js';
import { orchestrator } from '../orchestrator.js';
import { scheduleApply } from '../teams/runtime.js';
import type { PackageFile } from './package.js';
import { missingSecrets } from './logic.js';

// MCP market state (docs/README.md 6단계): packages, versions through the build pipeline, team installs.
// The orchestrator builds and runs; this module decides and records. Secret values pass through only.

export type PackageRow = typeof mcpPackages.$inferSelect;
export type VersionRow = typeof mcpVersions.$inferSelect;
export type InstallRow = typeof mcpInstalls.$inferSelect;

export const PLATFORM_PACKAGE = 'platform-mcp';
const BUILDING = ['validating', 'building', 'scanning', 'testing'] as const;
/** A stage that has not reported for this long is failed by the dispatcher (orchestrator restarted mid-build). */
const STAGE_TIMEOUT = sql`now() - interval '25 minutes'`;

export const versionDir = (pkg: string, version: string) => `${config.dataRoot}/mcp/${pkg}/${version}`;
export const mcpServerUrl = (key: string, team: string) => `http://kacp-mcp-${key}--${team}:8080/mcp`;

// ── output shapes (openapi McpPackageSummary / McpVersion / McpInstall) ──

export async function userRefs(ids: (string | null)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, { id: string; name: string; email: string; departmentName: string | null }>();
  const rows = await db.select({ id: users.id, name: users.name, email: users.email, departmentName: departments.name })
    .from(users).leftJoin(departments, eq(departments.id, users.departmentId)).where(inArray(users.id, list));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function packagesOut(rows: PackageRow[], teamId?: string | null) {
  const owners = await userRefs(rows.map((r) => r.ownerId));
  const latest = rows.map((r) => r.latestVersionId).filter((x): x is string => !!x);
  const versions = latest.length
    ? new Map((await db.select({ id: mcpVersions.id, version: mcpVersions.version, publishedAt: mcpVersions.publishedAt }).from(mcpVersions).where(inArray(mcpVersions.id, latest))).map((v) => [v.id, v]))
    : new Map();
  const installed = teamId
    ? new Set((await db.select({ p: mcpInstalls.packageId }).from(mcpInstalls).where(eq(mcpInstalls.teamId, teamId))).map((r) => r.p))
    : new Set<string | null>();
  const teamCount = rows.some((r) => r.isPlatform)
    ? (await db.select({ n: sql<number>`count(*)::int` }).from(teams).where(isNull(teams.deletedAt)))[0]!.n : 0;
  return rows.map((r) => ({
    name: r.name,
    displayName: r.displayName,
    summary: r.summary,
    category: r.category,
    icon: r.icon ?? '🧩',
    owner: r.ownerId ? owners.get(r.ownerId) ?? null : null,
    status: r.status as 'active' | 'suspended',
    isDefault: r.isDefault,
    isPlatform: r.isPlatform,
    latestVersion: r.latestVersionId ? (versions.get(r.latestVersionId)?.version ?? null) : null,
    publishedAt: r.latestVersionId ? (versions.get(r.latestVersionId)?.publishedAt?.toISOString() ?? null) : null,
    installCount: r.isPlatform ? teamCount : r.installCount,
    installedInTeam: r.isPlatform ? !!teamId : installed.has(r.id),
  }));
}

export async function versionsOut(rows: VersionRow[], pkgNames?: Map<string, string>) {
  if (!rows.length) return [];
  const ups = await userRefs(rows.map((r) => r.uploadedBy));
  const names = pkgNames ?? new Map((await db.select({ id: mcpPackages.id, name: mcpPackages.name }).from(mcpPackages)
    .where(inArray(mcpPackages.id, [...new Set(rows.map((r) => r.packageId))]))).map((p) => [p.id, p.name]));
  return rows.map((r) => ({
    id: r.id,
    packageName: names.get(r.packageId) ?? '',
    version: r.version,
    status: r.status,
    failedStage: r.failedStage,
    statusDetail: r.statusDetail,
    uploadedBy: r.uploadedBy ? ups.get(r.uploadedBy) ?? null : null,
    uploadedAt: r.createdAt.toISOString(),
    stageAt: r.stageAt.toISOString(),
    manifest: r.manifest as McpManifest,
    scanSummary: r.scanSummary ?? null,
    tools: r.tools ?? [],
    reviewNote: r.reviewNote,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    publishedAt: r.publishedAt?.toISOString() ?? null,
  }));
}

export async function installsOut(rows: InstallRow[]) {
  const pkgIds = [...new Set(rows.map((r) => r.packageId).filter((x): x is string => !!x))];
  const verIds = [...new Set(rows.map((r) => r.versionId).filter((x): x is string => !!x))];
  const pkgs = pkgIds.length ? new Map((await db.select().from(mcpPackages).where(inArray(mcpPackages.id, pkgIds))).map((p) => [p.id, p])) : new Map<string, PackageRow>();
  const vers = verIds.length ? new Map((await db.select({ id: mcpVersions.id, version: mcpVersions.version }).from(mcpVersions).where(inArray(mcpVersions.id, verIds))).map((v) => [v.id, v.version])) : new Map<string, string>();
  const by = await userRefs(rows.map((r) => r.installedBy));
  return rows.map((r) => {
    const p = r.packageId ? pkgs.get(r.packageId) : undefined;
    return {
      id: r.id,
      source: r.source as 'default' | 'market' | 'manual',
      name: p?.displayName ?? r.manualName ?? r.serverKey,
      icon: p?.icon ?? null,
      packageName: p?.name ?? null,
      packageStatus: p?.status ?? null,
      version: r.versionId ? vers.get(r.versionId) ?? null : null,
      manualUrl: r.manualUrl,
      serverKey: r.serverKey,
      status: r.status as 'installing' | 'installed' | 'error' | 'removing',
      statusDetail: r.statusDetail,
      secretNames: r.secretNames,
      installedBy: r.installedBy ? by.get(r.installedBy) ?? null : null,
      installedAt: r.createdAt.toISOString(),
      lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null,
    };
  });
}

/** platform-mcp is not a row per team: every team shows it as a default install (cannot be removed). */
export async function platformInstallRow() {
  const [p] = await db.select().from(mcpPackages).where(eq(mcpPackages.name, PLATFORM_PACKAGE));
  return {
    id: p?.id ?? '00000000-0000-0000-0000-000000000000',
    source: 'default' as const,
    name: p?.displayName ?? '플랫폼 기본 도구',
    icon: p?.icon ?? '🛠️',
    packageName: PLATFORM_PACKAGE,
    packageStatus: 'active',
    version: null,
    manualUrl: null,
    serverKey: 'platform',
    status: 'installed' as const,
    statusDetail: null,
    secretNames: [] as string[],
    installedBy: null,
    installedAt: p?.createdAt.toISOString() ?? new Date(0).toISOString(),
    lastCheckedAt: null,
  };
}

// ── seed ──

export async function ensurePlatformPackage() {
  await db.insert(mcpPackages).values({
    id: newId(),
    name: PLATFORM_PACKAGE,
    ownerId: null,
    displayName: '플랫폼 기본 도구',
    summary: '앱 실행·공개 요청과 팀 드라이브 읽기·쓰기. 모든 팀에 기본으로 들어 있어요.',
    category: '업무',
    icon: '🛠️',
    isPlatform: true,
  }).onConflictDoNothing({ target: mcpPackages.name });
}

// ── uploads ──

export async function storeUpload(pkg: string, version: string, zip: Buffer, files: PackageFile[]) {
  const dir = versionDir(pkg, version);
  await rm(dir, { recursive: true, force: true });
  await mkdir(`${dir}/src`, { recursive: true });
  await writeFile(`${dir}/source.zip`, zip);
  for (const f of files) {
    const target = path.posix.join(dir, 'src', f.path);
    if (!target.startsWith(`${dir}/src/`)) continue; // safeEntryPath already refused these
    await mkdir(path.posix.dirname(target), { recursive: true });
    await writeFile(target, f.data);
  }
}

// ── build pipeline: one version at a time, dispatched to the orchestrator ──

let dispatching = false;

export async function dispatchBuilds() {
  if (dispatching) return;
  dispatching = true;
  try {
    // Stuck stages (orchestrator restarted) → failed, so the queue moves on.
    await db.update(mcpVersions)
      .set({ status: 'failed', failedStage: sql`case ${mcpVersions.status} when 'scanning' then 'scan' when 'testing' then 'test' else 'build' end`, statusDetail: '시간이 너무 오래 걸려 중단했어요. 다시 올려 주세요.' })
      .where(and(inArray(mcpVersions.status, [...BUILDING]), lt(mcpVersions.stageAt, STAGE_TIMEOUT)));
    const [busy] = await db.select({ id: mcpVersions.id }).from(mcpVersions).where(inArray(mcpVersions.status, [...BUILDING])).limit(1);
    if (busy) return;
    const [next] = await db.select().from(mcpVersions).where(eq(mcpVersions.status, 'uploaded')).orderBy(asc(mcpVersions.createdAt)).limit(1);
    if (!next) return;
    const [p] = await db.select().from(mcpPackages).where(eq(mcpPackages.id, next.packageId));
    const won = await db.update(mcpVersions).set({ status: 'validating', stageAt: sql`now()` })
      .where(and(eq(mcpVersions.id, next.id), eq(mcpVersions.status, 'uploaded'))).returning({ id: mcpVersions.id });
    if (!won.length || !p) return;
    try {
      await orchestrator.mcpBuild({ versionId: next.id, pkg: p.name, version: next.version, resources: (next.manifest as McpManifest).resources });
    } catch {
      await db.update(mcpVersions).set({ status: 'uploaded' }).where(eq(mcpVersions.id, next.id));
    }
  } finally {
    dispatching = false;
  }
}

export interface BuildEvent {
  id: string;
  status: 'building' | 'scanning' | 'testing' | 'in_review' | 'failed';
  failedStage?: 'validate' | 'build' | 'scan' | 'test' | undefined;
  detail?: string | undefined;
  imageRef?: string | undefined;
  scanSummary?: { critical: number; high: number; medium: number; low: number } | undefined;
  findings?: McpFinding[] | undefined;
  tools?: McpToolInfo[] | undefined;
}

export async function onBuildEvent(ev: BuildEvent) {
  await db.update(mcpVersions).set({
    status: ev.status,
    stageAt: sql`now()`,
    ...(ev.status === 'failed' ? { failedStage: ev.failedStage ?? 'build', statusDetail: ev.detail ?? null } : {}),
    ...(ev.imageRef ? { imageRef: ev.imageRef } : {}),
    ...(ev.scanSummary ? { scanSummary: ev.scanSummary } : {}),
    ...(ev.findings ? { scanFindings: ev.findings } : {}),
    ...(ev.tools ? { tools: ev.tools } : {}),
  }).where(and(eq(mcpVersions.id, ev.id), inArray(mcpVersions.status, [...BUILDING])));
  if (ev.status === 'in_review' || ev.status === 'failed') void dispatchBuilds();
}

// ── installs ──

export async function recountInstalls(packageId: string) {
  await db.update(mcpPackages).set({
    installCount: sql`(select count(*)::int from ${mcpInstalls} where ${mcpInstalls.packageId} = ${packageId})`,
  }).where(eq(mcpPackages.id, packageId));
}

const installSpec = (p: PackageRow, v: VersionRow) => {
  const m = v.manifest as McpManifest;
  return { pkg: p.name, version: v.version, network: m.network, resources: m.resources };
};


/**
 * Inserts the install row and hands the secret values to the orchestrator (Secret Store). The row
 * keeps only the names. Returns the row; the outcome arrives as an mcp.install event.
 */
export async function installPackage(o: {
  team: { id: string; name: string }; pkg: PackageRow; version: VersionRow; source: 'market' | 'default';
  secrets: Record<string, string>; installedBy: string | null;
}) {
  const [row] = await db.insert(mcpInstalls).values({
    id: newId(),
    teamId: o.team.id,
    source: o.source,
    packageId: o.pkg.id,
    versionId: o.version.id,
    serverKey: o.pkg.name,
    status: 'installing',
    secretNames: Object.keys(o.secrets).filter((k) => o.secrets[k] !== '').sort(),
    installedBy: o.installedBy,
  }).onConflictDoNothing().returning();
  if (!row) throw new ApiError(409, 'MCP_ALREADY_INSTALLED');
  try {
    await orchestrator.mcpInstall(o.team.name, o.pkg.name, { ...installSpec(o.pkg, o.version), secrets: o.secrets });
  } catch (err) {
    await db.delete(mcpInstalls).where(eq(mcpInstalls.id, row.id));
    throw err;
  }
  await recountInstalls(o.pkg.id);
  return row;
}

export async function updateSecrets(team: { name: string }, row: InstallRow, secrets: Record<string, string>) {
  const [p] = await db.select().from(mcpPackages).where(eq(mcpPackages.id, row.packageId!));
  const [v] = await db.select().from(mcpVersions).where(eq(mcpVersions.id, row.versionId!));
  if (!p || !v) throw new ApiError(404, 'MCP_NOT_FOUND');
  const names = [...new Set([...row.secretNames, ...Object.keys(secrets).filter((k) => secrets[k] !== '')])].sort();
  await orchestrator.mcpSecrets(team.name, row.serverKey, { ...installSpec(p, v), secrets });
  await db.update(mcpInstalls).set({ status: 'installing', statusDetail: null, secretNames: names, updatedAt: sql`now()` }).where(eq(mcpInstalls.id, row.id));
}

export async function removeInstall(team: { name: string }, row: InstallRow) {
  await db.update(mcpInstalls).set({ status: 'removing', updatedAt: sql`now()` }).where(eq(mcpInstalls.id, row.id));
  try {
    await orchestrator.mcpRemove(team.name, row.serverKey);
  } catch (err) {
    await db.update(mcpInstalls).set({ status: row.status }).where(eq(mcpInstalls.id, row.id));
    throw err;
  }
}

/** mcp.install event: installed / error / removed. Gateway config follows the installed set. */
export async function onInstallEvent(teamName: string, key: string, status: 'installed' | 'error' | 'removed', detail: string | null) {
  const [t] = await db.select().from(teams).where(eq(teams.name, teamName));
  if (!t) return;
  const [row] = await db.select().from(mcpInstalls).where(and(eq(mcpInstalls.teamId, t.id), eq(mcpInstalls.serverKey, key)));
  if (!row) return;
  if (status === 'removed') {
    await db.delete(mcpInstalls).where(eq(mcpInstalls.id, row.id));
    if (row.packageId) await recountInstalls(row.packageId);
  } else if (status === 'error') {
    await db.update(mcpInstalls).set({ status: 'error', statusDetail: detail ?? '설치하지 못했어요.', updatedAt: sql`now()` }).where(eq(mcpInstalls.id, row.id));
  } else {
    const [v] = row.versionId ? await db.select().from(mcpVersions).where(eq(mcpVersions.id, row.versionId)) : [];
    const missing = v ? missingSecrets(v.manifest as McpManifest, row.secretNames) : [];
    await db.update(mcpInstalls).set({
      status: 'installed',
      statusDetail: missing.length ? `필수 비밀값이 없어요: ${missing.join(', ')}. 비밀값 다시 입력에서 넣어 주세요.` : null,
      updatedAt: sql`now()`,
    }).where(eq(mcpInstalls.id, row.id));
  }
  void scheduleApply(teamName);
}

/** New published version: every install of the package moves to it (version pinning is v2). Secrets are kept. */
export async function upgradeInstalls(p: PackageRow, v: VersionRow) {
  const rows = await db.select({ i: mcpInstalls, team: teams.name }).from(mcpInstalls)
    .innerJoin(teams, eq(teams.id, mcpInstalls.teamId)).where(eq(mcpInstalls.packageId, p.id));
  for (const { i, team } of rows) {
    if (i.status === 'removing') continue;
    await db.update(mcpInstalls).set({ versionId: v.id, status: 'installing', updatedAt: sql`now()` }).where(eq(mcpInstalls.id, i.id));
    await orchestrator.mcpInstall(team, i.serverKey, { ...installSpec(p, v), secrets: null }).catch(async () => {
      await db.update(mcpInstalls).set({ status: 'error', statusDetail: '새 버전으로 바꾸지 못했어요.' }).where(eq(mcpInstalls.id, i.id));
    });
  }
}

/**
 * Installs packages by name into a team if missing (전사 기본 MCP at provisioning, template defaultMcp on
 * assignment). Unpublished, suspended or platform packages are skipped. No secret values: required
 * ones show as an install detail until a team admin enters them.
 */
export async function ensureInstalled(team: { id: string; name: string }, names: string[] | 'defaults') {
  const pkgs = names === 'defaults'
    ? await db.select().from(mcpPackages).where(and(eq(mcpPackages.isDefault, true), eq(mcpPackages.status, 'active'), eq(mcpPackages.isPlatform, false)))
    : names.length ? await db.select().from(mcpPackages).where(and(inArray(mcpPackages.name, names), eq(mcpPackages.status, 'active'), eq(mcpPackages.isPlatform, false))) : [];
  for (const p of pkgs) {
    if (!p.latestVersionId) continue;
    const [exists] = await db.select({ id: mcpInstalls.id }).from(mcpInstalls).where(and(eq(mcpInstalls.teamId, team.id), eq(mcpInstalls.serverKey, p.name)));
    if (exists) continue;
    const [v] = await db.select().from(mcpVersions).where(eq(mcpVersions.id, p.latestVersionId));
    if (!v) continue;
    await installPackage({ team, pkg: p, version: v, source: 'default', secrets: {}, installedBy: null }).catch(() => undefined);
  }
}

/** apply-config input: installed market/default servers of a team. */
export async function desiredMcpServers(teamId: string, teamName: string) {
  const rows = await db.select({ key: mcpInstalls.serverKey }).from(mcpInstalls)
    .where(and(eq(mcpInstalls.teamId, teamId), inArray(mcpInstalls.source, ['market', 'default']), eq(mcpInstalls.status, 'installed')));
  return rows.map((r) => ({ key: mcpGatewayKey(r.key), url: mcpServerUrl(r.key, teamName) }));
}
