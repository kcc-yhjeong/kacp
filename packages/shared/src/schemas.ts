import { z } from 'zod';
import { PLATFORM_ROLES, TEAM_CONTAINER_STATUSES, TEAM_ROLES } from './status.js';

// Request bodies (validated in api) and response shapes (used by web). Mirrors openapi.yaml.

export const LoginRequest = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const PasswordChangeRequest = z.object({
  currentPassword: z.string().max(256).optional(),
  newPassword: z.string().min(1).max(256),
});
export type PasswordChangeRequest = z.infer<typeof PasswordChangeRequest>;

export const Me = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  platformRole: z.enum(PLATFORM_ROLES),
  department: z.object({ id: z.string(), code: z.string(), name: z.string(), pathNames: z.array(z.string()) }).nullable(),
  title: z.string().nullable(),
  mustChangePassword: z.boolean(),
  csrfToken: z.string(),
});
export type Me = z.infer<typeof Me>;

export const TeamStatus = z.object({
  status: z.enum(TEAM_CONTAINER_STATUSES),
  detail: z.string().nullable(),
  activeUsers: z.number().int(),
  since: z.string(),
});
export type TeamStatus = z.infer<typeof TeamStatus>;

export const MyTeam = z.object({
  name: z.string(),
  displayName: z.string(),
  teamRole: z.enum(TEAM_ROLES),
  containerStatus: z.enum(TEAM_CONTAINER_STATUSES),
  url: z.string(),
});
export type MyTeam = z.infer<typeof MyTeam>;

export const SessionInfo = z.object({
  id: z.string(),
  current: z.boolean(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

export const UserRef = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  departmentName: z.string().nullable(),
});
export type UserRef = z.infer<typeof UserRef>;

export const Member = z.object({
  user: UserRef,
  teamRole: z.enum(TEAM_ROLES),
  addedAt: z.string(),
});
export type Member = z.infer<typeof Member>;

export const TeamDetail = z.object({
  name: z.string(),
  displayName: z.string(),
  url: z.string(),
  myRole: z.enum(TEAM_ROLES),
  status: TeamStatus,
  agents: z.array(z.unknown()),
  resourceLimits: z.object({ cpu: z.number(), memoryMb: z.number(), diskGb: z.number() }),
});
export type TeamDetail = z.infer<typeof TeamDetail>;

export const HostKind = z.enum(['team', 'public_app', 'private_app', 'none']);
export type HostKind = z.infer<typeof HostKind>;

export interface ListResponse<T> {
  items: T[];
  nextCursor?: string | null;
}
