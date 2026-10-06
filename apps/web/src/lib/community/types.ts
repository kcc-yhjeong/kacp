import type { DriveUserRef } from '@/lib/drive/types';
import type { McpPackageSummary } from '@/lib/mcp/types';
import type { PostCategory } from './logic';

// U-13 shapes (04-api.md §2 /posts).

export interface PostSummary {
  id: string;
  category: PostCategory;
  title: string;
  author: (DriveUserRef & { email: string; departmentName: string | null }) | null;
  createdAt: string;
  updatedAt: string;
  hasPackage: boolean;
  hasApp: boolean;
}

/** `available: false` → the app is no longer public (other fields may be null). */
export interface AttachedApp {
  id: string;
  name: string | null;
  slug: string | null;
  team: string | null;
  url: string | null;
  version: number | null;
  available: boolean;
}

export interface PostDetail extends PostSummary {
  bodyMd: string;
  attachedPackage: McpPackageSummary | null;
  attachedApp: AttachedApp | null;
  canEdit: boolean;
}

export interface PostPage {
  items: PostSummary[];
  nextCursor: string | null;
}

export interface PublicAppRef {
  id: string;
  name: string;
  slug: string;
  team: string;
  url: string;
  version: number;
}

export interface PostInput {
  category: PostCategory;
  title: string;
  bodyMd: string;
  attachedPackage?: string | null;
  attachedAppId?: string | null;
}
