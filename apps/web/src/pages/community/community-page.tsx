import { Link, useNavigate } from '@tanstack/react-router';
import { Loader2, MessagesSquare, PenLine, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EmptyState, ErrorState, ListSkeleton, PageContainer, PageHeader } from '@/components/admin/page';
import { useDebounced } from '@/components/admin/user-picker';
import { AttachmentBadges, CategoryBadge } from '@/components/community/parts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePosts } from '@/lib/community/api';
import { POST_CATEGORIES, POST_CATEGORY_LABEL, type PostCategory } from '@/lib/community/logic';
import type { PostSummary } from '@/lib/community/types';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CommunityLayout } from './community-layout';

const tabClass = (on: boolean) =>
  cn(
    '-mb-px inline-flex h-9 items-center border-b-2 px-2.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
    on ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
  );

/** U-13 커뮤니티 목록 — `/community?category=&q=`. */
export function CommunityPage({ category, q }: { category?: PostCategory; q?: string }) {
  return <CommunityLayout>{() => <PostList category={category} q={q ?? ''} />}</CommunityLayout>;
}

function PostList({ category, q }: { category?: PostCategory; q: string }) {
  const navigate = useNavigate();
  const [text, setText] = useState(q);
  const dq = useDebounced(text.trim());

  // Keep the search in the URL so "뒤로" comes back to the same list.
  useEffect(() => {
    if (dq === q) return;
    void navigate({ to: '/community', search: { category, q: dq || undefined }, replace: true });
  }, [dq, q, category, navigate]);

  const posts = usePosts({ category, q: q || undefined });
  const items = posts.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = !!category || q !== '';

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader
        title="커뮤니티"
        description="MCP와 앱, 쓰는 요령을 전사에 나눠요."
        actions={
          <Button asChild>
            <Link to="/community/new" search={category && category !== 'notice' ? { category } : {}}>
              <PenLine strokeWidth={1.75} />
              글쓰기
            </Link>
          </Button>
        }
      />
      <nav aria-label="분류" className="flex flex-wrap items-center gap-1 border-b">
        <Link to="/community" search={{ q: q || undefined }} className={tabClass(!category)} aria-current={!category ? 'page' : undefined}>
          전체
        </Link>
        {POST_CATEGORIES.map((c) => (
          <Link
            key={c}
            to="/community"
            search={{ category: c, q: q || undefined }}
            className={tabClass(category === c)}
            aria-current={category === c ? 'page' : undefined}
          >
            {POST_CATEGORY_LABEL[c]}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-2">
        <div className="relative w-[280px]">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="제목·내용 검색" className="pl-8" aria-label="제목·내용 검색" />
        </div>
        {text && (
          <Button variant="ghost" size="sm" onClick={() => setText('')}>
            초기화
            <X />
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border">
        {posts.isPending ? (
          <ListSkeleton rows={6} />
        ) : posts.isError ? (
          <ErrorState title="글 목록을 불러오지 못했어요" error={posts.error} onRetry={() => void posts.refetch()} />
        ) : items.length === 0 ? (
          filtered ? (
            <EmptyState icon={Search} title="조건에 맞는 글이 없어요" description="검색어나 분류를 바꿔 보세요" />
          ) : (
            <EmptyState
              icon={MessagesSquare}
              title="아직 글이 없어요"
              description="만든 MCP나 앱, 쓰는 요령을 처음으로 나눠 보세요"
              action={
                <Button size="sm" variant="outline" asChild>
                  <Link to="/community/new">글쓰기</Link>
                </Button>
              }
            />
          )
        ) : (
          <ul>
            {items.map((p) => (
              <li key={p.id} className="border-b last:border-b-0">
                <PostRow post={p} />
              </li>
            ))}
          </ul>
        )}
      </div>
      {posts.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void posts.fetchNextPage()} disabled={posts.isFetchingNextPage}>
            {posts.isFetchingNextPage && <Loader2 className="animate-spin" />}더 보기
          </Button>
        </div>
      )}
    </PageContainer>
  );
}

function PostRow({ post }: { post: PostSummary }) {
  return (
    <Link
      to="/community/$postId"
      params={{ postId: post.id }}
      className="flex flex-col gap-1.5 px-5 py-3.5 outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
    >
      <span className="flex min-w-0 items-center gap-2">
        <CategoryBadge category={post.category} small />
        <span className="truncate font-medium">{post.title}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <AttachmentBadges hasPackage={post.hasPackage} hasApp={post.hasApp} />
        </span>
      </span>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="text-foreground/80">{post.author?.name ?? '알 수 없음'}</span>
        {post.author?.departmentName && <span>· {post.author.departmentName}</span>}
        <span aria-hidden>·</span>
        <span className="tabular-nums">{formatTime(post.createdAt)}</span>
      </span>
    </Link>
  );
}
