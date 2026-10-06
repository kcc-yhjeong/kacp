import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormAlert } from '@/components/form-alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { postApi, postKeys } from '@/lib/community/api';
import { CATEGORY_LABEL_MAX, categoryKeyProblem, categoryListProblem, type PostCategoryInfo } from '@/lib/community/logic';

interface Row {
  /** Stable React key (the category key is editable on new rows). */
  uid: string;
  key: string;
  label: string;
  adminOnly: boolean;
  hidden: boolean;
  isNew: boolean;
}

let seq = 0;
const toRows = (items: PostCategoryInfo[]): Row[] =>
  items.map((c) => ({ uid: `r${++seq}`, key: c.key, label: c.label, adminOnly: c.adminOnly, hidden: c.hidden, isNew: false }));

/** U-13 분류 관리 (platform admins): edit the whole list, saved at once with `PUT /admin/post-categories`. */
export function CategoryDialog({
  open,
  onOpenChange,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: PostCategoryInfo[];
}) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[]>(() => toRows(categories));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Start from the latest list every time the dialog opens.
  useEffect(() => {
    if (open) {
      setRows(toRows(categories));
      setError(null);
    }
  }, [open, categories]);

  const patch = (uid: string, p: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...p } : r)));
    setError(null);
  };
  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      const next = [...rs];
      const a = next[i];
      const b = next[i + d];
      if (!a || !b) return rs;
      next[i] = b;
      next[i + d] = a;
      return next;
    });

  const save = async () => {
    const items = rows.map((r) => ({ key: r.key.trim(), label: r.label.trim(), adminOnly: r.adminOnly, hidden: r.hidden }));
    const problem = categoryListProblem(items);
    if (problem) {
      setError(problem);
      return;
    }
    setPending(true);
    try {
      const saved = await postApi.saveCategories(items);
      qc.setQueryData(postKeys.categories, saved.items);
      void qc.invalidateQueries({ queryKey: postKeys.categories });
      void qc.invalidateQueries({ queryKey: postKeys.all });
      toast.success('분류를 저장했어요');
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>분류 관리</DialogTitle>
          <DialogDescription>
            위에서부터 탭 순서대로 보여요. 글이 있는 분류는 지울 수 없으니 숨기기를 쓰세요. 숨긴 분류는 목록 탭과 글쓰기에서 빠지지만 이미 쓴 글은 그대로 보여요.
          </DialogDescription>
        </DialogHeader>
        {error && <FormAlert message={error} />}
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-[13px]">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th className="w-10 px-2 py-2 font-normal" />
                <th className="px-2 py-2 text-left font-normal">이름</th>
                <th className="px-2 py-2 text-left font-normal">코드</th>
                <th className="px-2 py-2 font-normal">관리자만 쓰기</th>
                <th className="px-2 py-2 font-normal">숨기기</th>
                <th className="w-10 px-2 py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const keyProblem = r.isNew && r.key ? categoryKeyProblem(r.key) : null;
                return (
                  <tr key={r.uid} className="border-b align-top last:border-b-0">
                    <td className="px-2 py-2">
                      <span className="flex flex-col items-center">
                        <button
                          type="button"
                          aria-label={`${r.label || '분류'} 위로`}
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                        >
                          <ArrowUp className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`${r.label || '분류'} 아래로`}
                          disabled={i === rows.length - 1}
                          onClick={() => move(i, 1)}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                        >
                          <ArrowDown className="size-3.5" />
                        </button>
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        aria-label="분류 이름"
                        value={r.label}
                        maxLength={CATEGORY_LABEL_MAX}
                        placeholder="예: 자유게시판"
                        onChange={(e) => patch(r.uid, { label: e.target.value })}
                        className="h-8 min-w-[140px]"
                      />
                    </td>
                    <td className="px-2 py-2">
                      {r.isNew ? (
                        <div className="flex flex-col gap-1">
                          <Input
                            aria-label="분류 코드"
                            aria-invalid={!!keyProblem}
                            value={r.key}
                            maxLength={30}
                            placeholder="예: free"
                            onChange={(e) => patch(r.uid, { key: e.target.value.toLowerCase() })}
                            className="h-8 min-w-[120px] font-mono text-xs"
                          />
                          {keyProblem && <span className="text-[11.5px] text-danger">{keyProblem}</span>}
                        </div>
                      ) : (
                        <span className="inline-flex h-8 items-center font-mono text-xs text-muted-foreground">{r.key}</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <Checkbox
                        aria-label={`${r.label || r.key} 관리자만 쓰기`}
                        checked={r.adminOnly}
                        onCheckedChange={(v) => patch(r.uid, { adminOnly: v === true })}
                        className="mt-2 inline-grid"
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <Checkbox
                        aria-label={`${r.label || r.key} 숨기기`}
                        checked={r.hidden}
                        onCheckedChange={(v) => patch(r.uid, { hidden: v === true })}
                        className="mt-2 inline-grid"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`${r.label || r.key || '분류'} 지우기`}
                        onClick={() => {
                          setRows((rs) => rs.filter((x) => x.uid !== r.uid));
                          setError(null);
                        }}
                      >
                        <Trash2 strokeWidth={1.75} />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRows((rs) => [...rs, { uid: `r${++seq}`, key: '', label: '', adminOnly: false, hidden: false, isNew: true }])}
          >
            <Plus strokeWidth={1.75} />
            분류 추가
          </Button>
          <div className="flex max-w-md flex-col gap-0.5 text-xs text-muted-foreground">
            <span>코드는 주소와 저장에 쓰여요. 만든 뒤에는 바꿀 수 없어요. 영문 소문자로 시작하고 소문자·숫자·밑줄(_) 2~30자예요.</span>
            <span>관리자만 쓰기: 플랫폼 관리자만 글을 쓸 수 있어요(예: 공지). 읽기는 누구나 해요.</span>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button type="button" disabled={pending} onClick={() => void save()}>
            {pending && <Loader2 className="animate-spin" />}
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

