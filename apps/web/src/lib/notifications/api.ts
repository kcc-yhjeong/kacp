import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { NotificationList } from './logic';

// C-06 API (04-api.md §2 /me/notifications). The team host shell calls the app origin too (CORS with credentials).

export const notificationKeys = {
  all: ['me', 'notifications'] as const,
  unread: ['me', 'notifications', 'unread'] as const,
  list: ['me', 'notifications', 'list'] as const,
};

export const notificationApi = {
  list: (limit = 30) => api.get<NotificationList>(`/me/notifications?limit=${limit}`),
  unreadCount: () => api.get<{ count: number }>('/me/notifications/unread-count'),
  markRead: (body: { ids: string[] } | { all: true }) => api.post<void>('/me/notifications/read', body),
};

/** Unread count, every 30 s. Polling stops while the tab is hidden (TanStack Query focus manager). */
export function useUnreadCount(enabled = true) {
  return useQuery({
    queryKey: notificationKeys.unread,
    queryFn: async () => (await notificationApi.unreadCount()).count,
    enabled,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 15_000,
  });
}

/** Latest 30, loaded when the panel opens. */
export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: notificationKeys.list,
    queryFn: () => notificationApi.list(30),
    enabled,
    staleTime: 0,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: notificationApi.markRead,
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
