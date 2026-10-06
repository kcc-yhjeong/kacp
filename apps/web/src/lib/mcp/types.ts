// MCP API shapes (docs/design/openapi.yaml McpPackageSummary · McpVersion · McpInstall · McpTool, 04-api.md §2 MCP 마켓).

import type { McpManifest } from '@kacp/shared';
import type { DriveUserRef } from '@/lib/drive/types';

export type { McpManifest };

export type McpVersionStatus =
  | 'uploaded'
  | 'validating'
  | 'building'
  | 'scanning'
  | 'testing'
  | 'in_review'
  | 'published'
  | 'failed'
  | 'rejected'
  | 'superseded';

export type McpFailedStage = 'validate' | 'build' | 'scan' | 'test';
export type McpLogStage = 'build' | 'scan' | 'test';
export type McpInstallStatus = 'installing' | 'installed' | 'error' | 'removing';
export type McpInstallSource = 'default' | 'market' | 'manual';
export type McpPackageStatus = 'active' | 'suspended';
export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface ScanSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface McpPackageSummary {
  name: string;
  displayName: string;
  summary: string;
  category: string;
  icon?: string | null;
  owner: DriveUserRef | null;
  status: McpPackageStatus;
  isDefault: boolean;
  isPlatform: boolean;
  latestVersion: string | null;
  installCount: number;
  installedInTeam: boolean;
}

export interface McpVersion {
  id: string;
  packageName: string;
  version: string;
  status: McpVersionStatus;
  failedStage: McpFailedStage | null;
  /** Short cause for failed versions (not in openapi; shown when present). */
  statusDetail?: string | null;
  uploadedBy: DriveUserRef | null;
  uploadedAt: string;
  manifest: McpManifest | null;
  scanSummary: ScanSummary | null;
  tools: McpTool[];
  reviewNote: string | null;
  /** Not in openapi; shown when present. */
  reviewedAt?: string | null;
  publishedAt?: string | null;
}

export interface McpPackageDetail extends McpPackageSummary {
  readme: string;
  manifest: McpManifest | null;
  tools: McpTool[];
  /** published / superseded, newest first. */
  versions: McpVersion[];
  /** Team names where the caller may install. */
  canInstallTeams: string[];
}

export interface Finding {
  severity: Severity | (string & {});
  pkg: string;
  id: string;
  title: string;
}

export interface McpVersionDetail extends McpVersion {
  findings: Finding[];
}

export interface MyMcpPackage extends McpPackageSummary {
  versions: McpVersion[];
}

export interface McpInstall {
  id: string;
  source: McpInstallSource;
  name: string;
  packageName: string | null;
  version: string | null;
  manualUrl: string | null;
  status: McpInstallStatus;
  statusDetail: string | null;
  secretNames: string[];
  installedBy: DriveUserRef | null;
  lastCheckedAt: string | null;
  /** Not in openapi; shown as `—` when missing (A-08 직접 추가 시각). */
  installedAt?: string | null;
  /** Latest container sample (last 5 min); null when stopped, manual or not measured yet. */
  usage?: { cpuPct?: number; memBytes: number; memLimitBytes?: number | null } | null;
}

export interface TeamInstallsResponse {
  items: McpInstall[];
  teamRunning: boolean;
  lastSyncedAt: string | null;
  canManage: boolean;
}

export interface AdminMcpInstall extends McpInstall {
  team: string;
}

export interface VersionChanges {
  secretsAdded: string[];
  secretsRemoved: string[];
  networkAdded: string[];
  networkRemoved: string[];
}

export interface AdminMcpVersionDetail extends McpVersion {
  findings: Finding[];
  previous: McpVersion | null;
  changes: VersionChanges;
}
