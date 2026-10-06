import { useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageSquare, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Avatar, ErrorState, ListSkeleton } from '@/components/admin/page';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/api';
import { postApi, postKeys, usePostComments } from '@/lib/community/api';
import { COMMENT_MAX, commentProblem } from '@/lib/community/logic';
import type { PostComment } from '@/lib/community/types';
import { formatTime } from '@/lib/format';

/** U-13 댓글: list (oldest first, plain text), write box, delete with confirm. */
export function PostComments({ postId }: { postId: string }) {
  const qc = useQueryClient();
  const comments = usePostComments(postId);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [target, setTarget] = useState<PostComment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const items = comments.data ?? [];

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: postKeys.comments(postId) });
    // Comment counts in the list.
    void qc.invalidateQueries({ queryKey: ['posts', 'list'] });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = commentProblem(body);
    if (problem) {
      setError(problem);
      return;
    }
    setPending(true);
    try {
      const created = await postApi.addComment(postId, body.trim());
      qc.setQueryData<PostComment[]>(postKeys.comments(postId), (old) => [...(old ?? []), created]);
      refresh();
      setBody('');
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const onDelete = async () => {
    if (!target) return;
    setDeleting(true);
    try {
      await postApi.removeComment(postId, target.id);
      qc.setQueryData<PostComment[]>(postKeys.comments(postId), (old) => (old ?? []).filter((c) => c.id !== target.id));
      refresh();
      toast.success('댓글을 지웠어요');
      setTarget(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 border-t pt-5" aria-label="댓글">
      <h2 className="flex items-center gap-1.5 text-sm font-medium">
        <MessageSquare className="size-4 text-muted-foreground" strokeWidth={1.75} />
        댓글{comments.data ? <span className="text-muted-foreground tabular-nums">{items.length}</span> : null}
      </h2>

      {comments.isPending ? (
        <div className="rounded-xl border">
          <ListSkeleton rows={2} />
        </div>
      ) : comments.isError ? (
        <div className="rounded-xl border">
          <ErrorState title="댓글을 불러오지 못했어요" error={comments.error} onRetry={() => void comments.refetch()} />
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border px-4 py-6 text-center text-[13px] text-muted-foreground">첫 댓글을 남겨 보세요</p>
      ) : (
        <ul className="rounded-xl border">
          {items.map((c) => (
            <li key={c.id} className="flex gap-3 border-b px-4 py-3 last:border-b-0">
              <Avatar name={c.author?.name ?? '?'} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <span className="text-[13px] font-medium text-foreground">{c.author?.name ?? '알 수 없음'}</span>
                  {c.author?.departmentName && <span>· {c.author.departmentName}</span>}
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">{formatTime(c.createdAt)}</span>
                </span>
                {/* Plain text only: React escapes it, `pre-wrap` keeps line breaks. */}
                <p className="text-sm break-words whitespace-pre-wrap">{c.body}</p>
              </div>
              {c.canDelete && (
                <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="댓글 지우기" onClick={() => setTarget(c)}>
                  <Trash2 strokeWidth={1.75} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-2">
        <Textarea
          aria-label="댓글"
          value={body}
          aria-invalid={!!error}
          onChange={(e) => {
            setBody(e.target.value);
            if (error) setError(null);
          }}
          placeholder="댓글을 입력하세요"
          className="min-h-20 text-sm"
        />
        <div className="flex items-center gap-2">
          {error ? (
            <span role="alert" className="text-xs text-danger">
              {error}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">글자 그대로 보여요(마크다운은 쓰지 않아요).</span>
          )}
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {body.trim().length.toLocaleString()} / {COMMENT_MAX.toLocaleString()}
          </span>
          <Button type="submit" size="sm" disabled={pending || !body.trim()}>
            {pending && <Loader2 className="animate-spin" />}
            댓글 남기기
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title="댓글을 지울까요?"
        description="지운 댓글은 되돌릴 수 없어요."
        confirmLabel="댓글 지우기"
        destructive
        pending={deleting}
        onConfirm={() => void onDelete()}
      />
    </section>
  );
}
