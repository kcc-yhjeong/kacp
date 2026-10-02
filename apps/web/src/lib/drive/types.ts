// Drive API shapes (docs/design/openapi.yaml DriveEntry · DriveMeta · TrashItem, 04-api.md §2 드라이브).

export const DRIVE_SPACES = ['me', 'shared'] as const;
export type DriveSpace = (typeof DRIVE_SPACES)[number];

export function isDriveSpace(v: unknown): v is DriveSpace {
  return v === 'me' || v === 'shared';
}

export interface DriveUserRef {
  id: string;
  name: string;
  email?: string;
  departmentName?: string | null;
}

/** `kind=agent` → `user` is null ("에이전트 · 팀", spike 05). */
export interface Actor {
  kind: 'user' | 'agent' | 'system';
  user: DriveUserRef | null;
}

export interface DriveEntry {
  name: string;
  /** Relative to the space root, starts with `/`, no trailing slash. */
  path: string;
  space: DriveSpace;
  isDir: boolean;
  size: number;
  mimeType: string;
  modifiedAt: string;
  /** Null when there is no record (file made outside the platform). */
  createdBy: Actor | null;
}

export type DriveAction = 'create' | 'update' | 'rename' | 'move' | 'copy' | 'trash' | 'restore' | 'delete' | (string & {});

export interface DriveHistoryItem {
  action: DriveAction;
  actor: Actor;
  path: string;
  prevPath: string | null;
  at: string;
}

export interface DriveMeta extends DriveEntry {
  createdAt: string | null;
  access: 'only_me' | 'team';
  history: DriveHistoryItem[];
}

export interface TrashItem {
  id: string;
  name: string;
  space: DriveSpace;
  originalPath: string;
  isDir: boolean;
  size: number;
  deletedBy: DriveUserRef | null;
  deletedAt: string;
  purgeAfter: string;
  /** Whether the caller may delete this item permanently. */
  canPurge: boolean;
}

export interface DriveRef {
  space: DriveSpace;
  path: string;
}

export interface DriveUsage {
  usedBytes: number;
  limitBytes: number;
}
