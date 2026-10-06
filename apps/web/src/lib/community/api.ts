import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import type { CategoryRow, PostCategory, PostCategoryInfo } from './logic';
import type { PostComment, PostDetail, PostInput, PostPage, PublicAppRef } from './types';

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
  comments: (id: string) => ['posts', 'comments', id] as const,
  categories: ['post-categories'] as const,
};

export const postApi = {
  list: (f: PostFilter, cursor?: string) => api.get<PostPage>(`/posts${qs({ category: f.category, q: f.q, cursor })}`),
  get: (id: string, team?: string) => api.get<PostDetail>(`/posts/${enc(id)}${qs({ team })}`),
  create: (body: PostInput) => api.post<PostDetail>('/posts', body),
  update: (id: string, body: Partial<PostInput>) => api.patch<PostDetail>(`/posts/${enc(id)}`, body),
  remove: (id: string) => api.delete<void>(`/posts/${enc(id)}`),
  publicApps: (q: string) => api.get<{ items: PublicAppRef[] }>(`/public-apps${qs({ q })}`),
  categories: () => api.get<{ items: PostCategoryInfo[] }>('/post-categories'),
  saveCategories: (items: CategoryRow[]) => api.put<{ items: PostCategoryInfo[] }>('/admin/post-categories', { items }),
  comments: (id: string) => api.get<{ items: PostComment[] }>(`/posts/${enc(id)}/comments`),
  addComment: (id: string, body: string) => api.post<PostComment>(`/posts/${enc(id)}/comments`, { body }),
  removeComment: (id: string, commentId: string) => api.delete<void>(`/posts/${enc(id)}/comments/${enc(commentId)}`),
};

/** Categories in display order (admins also get hidden ones). */
export function usePostCategories() {
  return useQuery({
    queryKey: postKeys.categories,
    queryFn: async () => (await postApi.categories()).items,
    staleTime: 60_000,
  });
}

/** Comments under a post, oldest first. */
export function usePostComments(id: string) {
  return useQuery({ queryKey: postKeys.comments(id), queryFn: async () => (await postApi.comments(id)).items });
}

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
