import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Avatar, ErrorState, PageContainer } from '@/components/admin/page';
import { PostComments } from '@/components/community/comments';
import { AttachedAppCard, AttachedPackageCard, CategoryBadge } from '@/components/community/parts';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { MarkdownView } from '@/components/mcp/markdown-view';
import { PageLoader } from '@/components/page-loader';
import { Button } from '@/components/ui/button';
import { ApiError, errorMessage } from '@/lib/api';
import { postApi, postKeys, usePost } from '@/lib/community/api';
import { formatTime } from '@/lib/format';
import { CommunityLayout, type CommunityContext } from './community-layout';

/** U-13 글 보기 — `/community/{id}`. */
export function PostPage({ postId }: { postId: string }) {
  return <CommunityLayout>{(ctx) => <PostView postId={postId} ctx={ctx} />}</CommunityLayout>;
}

function PostView({ postId, ctx }: { postId: string; ctx: CommunityContext }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const post = usePost(postId, ctx.team?.name);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (post.isPending) return <PageLoader />;
  if (post.isError) {
    const notFound = post.error instanceof ApiError && post.error.status === 404;
    return (
      <PageContainer className="max-w-4xl">
        <Crumb />
        <div className="rounded-xl border">
          <ErrorState
            title={notFound ? '찾을 수 없는 글이에요' : '글을 불러오지 못했어요'}
            error={notFound ? undefined : post.error}
            onRetry={notFound ? undefined : () => void post.refetch()}
          />
        </div>
      </PageContainer>
    );
  }
  const p = post.data;
  const edited = p.updatedAt !== p.createdAt && new Date(p.updatedAt).getTime() - new Date(p.createdAt).getTime() > 1000;

  const onDelete = async () => {
    setDeleting(true);
    try {
      await postApi.remove(p.id);
      qc.removeQueries({ queryKey: postKeys.detailAll(p.id) });
      void qc.invalidateQueries({ queryKey: ['posts', 'list'] });
      toast.success('글을 삭제했어요');
      setConfirm(false);
      void navigate({ to: '/community' });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <PageContainer className="max-w-4xl">
      <Crumb category={p.category} label={p.categoryLabel} />
      <article className="flex flex-col gap-5">
        <header className="flex flex-col gap-3 border-b pb-5">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <CategoryBadge category={p.category} label={p.categoryLabel} className="self-start" />
              <h1 className="text-2xl font-bold tracking-tight text-pretty break-words">{p.title}</h1>
            </div>
            {p.canEdit && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link to="/community/$postId/edit" params={{ postId: p.id }}>
                    <Pencil strokeWidth={1.75} />
                    수정
                  </Link>
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>
                  <Trash2 strokeWidth={1.75} />
                  삭제
                </Button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Avatar name={p.author?.name ?? '?'} />
            <span className="text-foreground">{p.author?.name ?? '알 수 없음'}</span>
            {p.author?.departmentName && <span className="text-xs">· {p.author.departmentName}</span>}
            <span aria-hidden>·</span>
            <span className="tabular-nums">{formatTime(p.createdAt)}</span>
            {edited && <span className="text-xs">(수정됨)</span>}
          </div>
        </header>

        {p.bodyMd.trim() ? (
          <MarkdownView source={p.bodyMd} className="text-sm" />
        ) : (
          <p className="text-[13px] text-muted-foreground">본문이 없어요</p>
        )}

        {(p.attachedPackage || p.attachedApp) && (
          <section className="flex flex-col gap-2">
            <h2 className="text-[13px] font-medium text-muted-foreground">첨부</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {p.attachedPackage && <AttachedPackageCard pkg={p.attachedPackage} team={ctx.team} teams={ctx.teams} />}
              {p.attachedApp && <AttachedAppCard app={p.attachedApp} />}
            </div>
          </section>
        )}
      </article>

      <PostComments postId={p.id} />

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="글을 삭제할까요?"
        description="삭제한 글은 목록과 검색에서 사라지고 되돌릴 수 없어요."
        confirmLabel="글 삭제"
        destructive
        pending={deleting}
        onConfirm={() => void onDelete()}
      />
    </PageContainer>
  );
}

function Crumb({ category, label }: { category?: string; label?: string }) {
  return (
    <nav className="flex items-center gap-1 text-[13px] text-muted-foreground">
      <Link to="/community" className="hover:text-foreground">
        커뮤니티
      </Link>
      {category && (
        <>
          <ChevronRight className="size-3.5" />
          <Link to="/community" search={{ category }} className="hover:text-foreground">
            {label ?? category}
          </Link>
        </>
      )}
    </nav>
  );
}
