// App API shapes (docs/design/openapi.yaml App · AppCopy · PublicCopy · AppDetail · DeployRequest, 04-api.md §2 앱·배포).

import type { Actor, DriveRef, DriveUserRef } from '@/lib/drive/types';

export type AppStatus = 'starting' | 'running' | 'stopped' | 'error';
/** Only set when `status = stopped`. `limit` is work-only, `admin` is public-only. */
export type StopReason = 'idle' | 'limit' | 'manual' | 'admin';
export type AppCopyKind = 'work' | 'public';
export type DeployRequestKind = 'publish' | 'update';
export type DeployRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type AppRuntime = 'node' | 'python' | 'static';

export interface CopyUsage {
  cpuPct?: number;
  memBytes: number;
  memLimitBytes?: number | null;
}

export interface AppCopy {
  kind: AppCopyKind;
  /** Full origin, e.g. `http://lunch-vote--team1.kacp.localhost`. */
  url: string;
  status: AppStatus;
  stopReason: StopReason | null;
  statusDetail: string | null;
  lastAccessedAt: string | null;
  /** Null while the copy is not running. */
  usage: CopyUsage | null;
}

export interface PublicCopy extends AppCopy {
  name: string;
  version: number;
  publishedAt: string;
  approvedBy: DriveUserRef | null;
}

export interface App {
  id: string;
  team: string;
  slug: string;
  /** v1: always `{kind: 'agent', user: null}`. */
  creator: Actor;
  work: AppCopy;
  /** Null = not published. */
  public: PublicCopy | null;
  pendingRequest: { id: string; kind: DeployRequestKind } | null;
}

export interface DiffSummary {
  added: string[];
  modified: string[];
  removed: string[];
}

export interface DeployRequest {
  id: string;
  appId: string;
  kind: DeployRequestKind;
  /** Publish only. */
  requestedName: string | null;
  /** publish: 공개 이유 / update: 변경 내용 */
  reason: string;
  fromVersion: number | null;
  approvedVersion: number | null;
  diffSummary: DiffSummary | null;
  status: DeployRequestStatus;
  /** Null when the agent asked through `deploy_app` ("에이전트 · 팀"). */
  requestedBy: DriveUserRef | null;
  requestedAt: string;
  decidedBy: DriveUserRef | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface AppDetail extends App {
  source: DriveRef;
  runSpec: { command: string; port: number; runtime: AppRuntime };
  resourceLimits: { cpu: number; memoryMb: number; diskGb: number } | null;
  dataUsage: { workBytes: number; publicBytes: number | null };
  currentRequest: DeployRequest | null;
  history: DeployRequest[];
  /** Team admin: may delete and unpublish. */
  canManage: boolean;
  /** Not in openapi yet; shown as `—` when missing. */
  createdAt?: string;
}

export interface TeamAppsResponse {
  items: App[];
  limits?: { maxRunningWork: number; runningWork: number };
}

export interface SeriesPoint {
  ts: string;
  cpuPct: number;
  memBytes: number;
  memLimitBytes: number | null;
}

export interface AppHostInfo {
  exists: boolean;
  copy: AppCopyKind | null;
  appId: string | null;
  team: string | null;
  slug: string | null;
  status: AppStatus | null;
  stopReason: StopReason | null;
  statusDetail: string | null;
  canWake: boolean;
}

export interface AdminDeployRequest extends DeployRequest {
  app: {
    id: string;
    slug: string;
    team: string;
    workUrl: string;
    publicUrl: string | null;
    publicVersion: number | null;
  };
  /** Pending publish requests only (max 200 paths). */
  sourceFiles?: string[];
}
