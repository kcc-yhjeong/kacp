import { useQuery, type QueryClient } from '@tanstack/react-query';
import { driveApi } from './api';
import type { DriveSpace } from './types';

export const driveKeys = {
  all: (team: string) => ['drive', team] as const,
  space: (team: string, space: DriveSpace) => ['drive', team, space] as const,
  list: (team: string, space: DriveSpace, path: string) => ['drive', team, space, 'list', path] as const,
  search: (team: string, space: DriveSpace, q: string) => ['drive', team, space, 'search', q] as const,
  meta: (team: string, space: DriveSpace, path: string) => ['drive', team, space, 'meta', path] as const,
  usage: (team: string) => ['drive', team, 'usage'] as const,
  trash: (team: string) => ['drive', team, 'trash'] as const,
};

export function useDriveList(team: string, space: DriveSpace, path: string, enabled = true) {
  return useQuery({
    queryKey: driveKeys.list(team, space, path),
    queryFn: () => driveApi.list(team, space, path),
    enabled,
  });
}

export function useDriveSearch(team: string, space: DriveSpace, q: string) {
  return useQuery({
    queryKey: driveKeys.search(team, space, q),
    queryFn: () => driveApi.search(team, space, q),
    enabled: q.length > 0,
  });
}

export function useDriveMeta(team: string, space: DriveSpace, path: string | null) {
  return useQuery({
    queryKey: driveKeys.meta(team, space, path ?? ''),
    queryFn: () => driveApi.meta(team, space, path ?? '/'),
    enabled: path !== null,
  });
}

export function useDriveUsage(team: string) {
  return useQuery({ queryKey: driveKeys.usage(team), queryFn: () => driveApi.usage(team), staleTime: 60_000 });
}

export function useTrash(team: string) {
  return useQuery({ queryKey: driveKeys.trash(team), queryFn: () => driveApi.trashList(team) });
}

/** After any write: listings, search, meta, usage and trash of the team may all have changed. */
export function invalidateDrive(qc: QueryClient, team: string): Promise<void> {
  return qc.invalidateQueries({ queryKey: driveKeys.all(team) });
}
