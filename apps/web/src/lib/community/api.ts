import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import type { PostCategory } from './logic';
import type { PostDetail, PostInput, PostPage, PublicAppRef } from './types';

// U-13 API (04-api.md §2 /posts, /public-apps) and query keys.

const enc = encodeURIComponent;

export interface PostFilter {
  category?: PostCategory;
  q?: string;
}

export const postKeys = {
  all: ['posts'] as const,
  list: (f: PostFilter) => ['posts', 'list', f] as const,
  detail: (id: string, team?: string) => ['posts', 'detail', id, team ?? null] as const,
  detailAll: (id: string) => ['posts', 'detail', id] as const,
  publicApps: (q: string) => ['public-apps', q] as const,
};

export const postApi = {
  list: (f: PostFilter, cursor?: string) => api.get<PostPage>(`/posts${qs({ category: f.category, q: f.q, cursor })}`),
  get: (id: string, team?: string) => api.get<PostDetail>(`/posts/${enc(id)}${qs({ team })}`),
  create: (body: PostInput) => api.post<PostDetail>('/posts', body),
  update: (id: string, body: Partial<PostInput>) => api.patch<PostDetail>(`/posts/${enc(id)}`, body),
  remove: (id: string) => api.delete<void>(`/posts/${enc(id)}`),
  publicApps: (q: string) => api.get<{ items: PublicAppRef[] }>(`/public-apps${qs({ q })}`),
};

/** Newest first, 50 per page; "더 보기" loads the next cursor. */
export function usePosts(f: PostFilter) {
  return useInfiniteQuery({
    queryKey: postKeys.list(f),
    queryFn: ({ pageParam }) => postApi.list(f, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function usePost(id: string, team?: string) {
  return useQuery({ queryKey: postKeys.detail(id, team), queryFn: () => postApi.get(id, team) });
}

export function usePublicApps(q: string, enabled = true) {
  return useQuery({
    queryKey: postKeys.publicApps(q),
    queryFn: async () => (await postApi.publicApps(q)).items,
    enabled,
    staleTime: 15_000,
  });
}
