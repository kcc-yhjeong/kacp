import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { AppWindow, ChevronRight, Loader2, Plug, Plus, Search, X } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ErrorState, PageContainer, PageHeader } from '@/components/admin/page';
import { useDebounced } from '@/components/admin/user-picker';
import { PublicBadge } from '@/components/apps/badges';
import { FormAlert } from '@/components/form-alert';
import { McpIcon } from '@/components/mcp/badges';
import { MarkdownView } from '@/components/mcp/markdown-view';
import { PageLoader } from '@/components/page-loader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { postApi, postKeys, usePost, usePublicApps } from '@/lib/community/api';
import {
  BODY_MAX,
  createBody,
  hasErrors,
  isPostCategory,
  patchBody,
  POST_CATEGORY_LABEL,
  postSaveError,
  selectableCategories,
  TITLE_MAX,
  validatePostForm,
  type PostCategory,
  type PostForm,
  type PostFormErrors,
} from '@/lib/community/logic';
import type { AttachedApp, PostDetail, PublicAppRef } from '@/lib/community/types';
import { hostOf } from '@/lib/host';
import { useMcpPackages } from '@/lib/mcp/api';
import type { McpPackageSummary } from '@/lib/mcp/types';
import { cn } from '@/lib/utils';
import { CommunityLayout, type CommunityContext } from './community-layout';

/** U-13 글쓰기 — `/community/new`. */
export function PostNewPage({ category }: { category?: PostCategory }) {
  return (
    <CommunityLayout>
      {(ctx) => (
        <PostEditor
          ctx={ctx}
          initial={{
            category: category && (category !== 'notice' || ctx.isAdmin) ? category : '',
            title: '',
            bodyMd: '',
            attachedPackage: null,
            attachedAppId: null,
          }}
        />
      )}
    </CommunityLayout>
  );
}

/** U-13 글 수정 — `/community/{id}/edit`. */
export function PostEditPage({ postId }: { postId: string }) {
  return <CommunityLayout>{(ctx) => <EditLoader postId={postId} ctx={ctx} />}</CommunityLayout>;
}

function EditLoader({ postId, ctx }: { postId: string; ctx: CommunityContext }) {
  const post = usePost(postId, ctx.team?.name);
  if (post.isPending) return <PageLoader />;
  if (post.isError || !post.data.canEdit) {
    const notFound = post.error instanceof ApiError && post.error.status === 404;
    return (
      <PageContainer className="max-w-4xl">
        <div className="rounded-xl border">
          <ErrorState
            title={post.isError ? (notFound ? '찾을 수 없는 글이에요' : '글을 불러오지 못했어요') : '이 글을 고칠 권한이 없어요'}
            error={post.isError && !notFound ? post.error : undefined}
            onRetry={post.isError && !notFound ? () => void post.refetch() : undefined}
          />
        </div>
      </PageContainer>
    );
  }
  const p = post.data;
  return (
    <PostEditor
      ctx={ctx}
      post={p}
      initial={{
        category: p.category,
        title: p.title,
        bodyMd: p.bodyMd,
        attachedPackage: p.attachedPackage?.name ?? null,
        attachedAppId: p.attachedApp?.id ?? null,
      }}
    />
  );
}

function PostEditor({ ctx, initial, post }: { ctx: CommunityContext; initial: PostForm; post?: PostDetail }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<PostForm>(initial);
  const [pkg, setPkg] = useState<McpPackageSummary | null>(post?.attachedPackage ?? null);
  const [app, setApp] = useState<AttachedApp | PublicAppRef | null>(post?.attachedApp ?? null);
  const [errors, setErrors] = useState<PostFormErrors>({});
  const [pending, setPending] = useState(false);
  const role = ctx.me.platformRole;
  const categories = selectableCategories(role);

  const set = <K extends keyof PostForm>(k: K, v: PostForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => {
      if (!e[k] && !e.form) return e;
      const { [k]: _drop, form: _form, ...rest } = e;
      return rest;
    });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validatePostForm(form, role);
    setErrors(v);
    if (hasErrors(v)) return;
    setPending(true);
    try {
      let saved: PostDetail;
      if (post) {
        const body = patchBody(initial, form);
        saved = Object.keys(body).length > 0 ? await postApi.update(post.id, body) : post;
      } else {
        saved = await postApi.create(createBody(form));
      }
      void qc.invalidateQueries({ queryKey: postKeys.all });
      toast.success(post ? '글을 고쳤어요' : '글을 올렸어요');
      void navigate({ to: '/community/$postId', params: { postId: saved.id }, replace: !!post });
    } catch (err) {
      setErrors(postSaveError(err, form.category));
    } finally {
      setPending(false);
    }
  };

  const cancelTo = post ? (
    <Link to="/community/$postId" params={{ postId: post.id }}>
      취소
    </Link>
  ) : (
    <Link to="/community">취소</Link>
  );

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        breadcrumb={
          <>
            <Link to="/community" className="hover:text-foreground">
              커뮤니티
            </Link>
            <ChevronRight className="size-3.5" />
            <span className="text-foreground">{post ? '글 수정' : '글쓰기'}</span>
          </>
        }
        title={post ? '글 수정' : '글쓰기'}
      />
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-5 rounded-xl border p-6">
        {errors.form && <FormAlert message={errors.form} />}
        <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
          <FieldBlock id="post-category" label="분류" error={errors.category} hint={ctx.isAdmin ? undefined : '공지 분류는 플랫폼 관리자만 쓸 수 있어요'}>
            <NativeSelect
              id="post-category"
              value={form.category}
              aria-invalid={!!errors.category}
              onChange={(e) => set('category', isPostCategory(e.target.value) ? e.target.value : '')}
            >
              <option value="">분류 선택</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {POST_CATEGORY_LABEL[c]}
                </option>
              ))}
            </NativeSelect>
          </FieldBlock>
          <FieldBlock id="post-title" label="제목" error={errors.title}>
            <Input
              id="post-title"
              value={form.title}
              maxLength={TITLE_MAX + 20}
              aria-invalid={!!errors.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="제목을 입력하세요"
            />
          </FieldBlock>
        </div>

        <FieldBlock label="본문" error={errors.bodyMd} hint="마크다운으로 써요. HTML은 글자 그대로 보여요.">
          <Tabs defaultValue="write">
            <TabsList>
              <TabsTrigger value="write">작성</TabsTrigger>
              <TabsTrigger value="preview">미리보기</TabsTrigger>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {form.bodyMd.length.toLocaleString()} / {BODY_MAX.toLocaleString()}
              </span>
            </TabsList>
            <TabsContent value="write" className="pt-3">
              <Textarea
                aria-label="본문"
                value={form.bodyMd}
                aria-invalid={!!errors.bodyMd}
                onChange={(e) => set('bodyMd', e.target.value)}
                className="min-h-[320px] font-mono text-[13px] leading-relaxed"
                placeholder={'## 제목\n\n내용을 마크다운으로 쓰세요.'}
              />
            </TabsContent>
            <TabsContent value="preview" className="pt-3">
              <div className="min-h-[320px] rounded-md border px-4 py-3">
                {form.bodyMd.trim() ? <MarkdownView source={form.bodyMd} className="text-sm" /> : <span className="text-[13px] text-muted-foreground">미리 볼 내용이 없어요</span>}
              </div>
            </TabsContent>
          </Tabs>
        </FieldBlock>

        <div className="grid gap-4 md:grid-cols-2">
          <FieldBlock label="MCP 첨부 (선택)" error={errors.attachedPackage}>
            {pkg && form.attachedPackage ? (
              <AttachmentChip
                icon={<McpIcon icon={pkg.icon} name={pkg.displayName || pkg.name} size="sm" />}
                title={pkg.displayName || pkg.name}
                sub={`${pkg.name}${pkg.latestVersion ? ` · v${pkg.latestVersion}` : ''}`}
                onRemove={() => {
                  setPkg(null);
                  set('attachedPackage', null);
                }}
              />
            ) : (
              <PackagePicker
                onPick={(p) => {
                  setPkg(p);
                  set('attachedPackage', p.name);
                }}
              />
            )}
          </FieldBlock>
          <FieldBlock label="Public 앱 첨부 (선택)" error={errors.attachedAppId} hint="작업본(Private)은 첨부할 수 없어요">
            {app && form.attachedAppId ? (
              'available' in app && !app.available ? (
                <AttachmentChip
                  icon={<AppIcon />}
                  title="공개가 중지된 앱이에요"
                  sub="빼거나 다른 앱을 고르세요"
                  onRemove={() => {
                    setApp(null);
                    set('attachedAppId', null);
                  }}
                />
              ) : (
                <AttachmentChip
                  icon={<AppIcon />}
                  title={app.name ?? '앱'}
                  sub={`${app.url ? hostOf(app.url) : ''}${app.team ? ` · ${app.team}` : ''}`}
                  badge={<PublicBadge version={app.version} small />}
                  onRemove={() => {
                    setApp(null);
                    set('attachedAppId', null);
                  }}
                />
              )
            ) : (
              <AppPicker
                onPick={(a) => {
                  setApp(a);
                  set('attachedAppId', a.id);
                }}
              />
            )}
          </FieldBlock>
        </div>

        <div className="flex justify-end gap-2 border-t pt-5">
          <Button type="button" variant="outline" asChild>
            {cancelTo}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            저장
          </Button>
        </div>
      </form>
    </PageContainer>
  );
}

function FieldBlock({
  id,
  label,
  hint,
  error,
  children,
}: {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-[13px]">
        {label}
      </Label>
      {children}
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : (
        hint && <span className="text-xs text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}

function AppIcon() {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
      <AppWindow className="size-4" strokeWidth={1.75} />
    </span>
  );
}

function AttachmentChip({
  icon,
  title,
  sub,
  badge,
  onRemove,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  badge?: ReactNode;
  onRemove: () => void;
}) {
  return (
    <div className="flex h-12 items-center gap-2.5 rounded-md border px-2.5">
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5 text-[13px] font-medium">
          <span className="truncate">{title}</span>
          {badge}
        </span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{sub}</span>
      </span>
      <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="첨부 빼기" onClick={onRemove}>
        <X strokeWidth={1.75} />
      </Button>
    </div>
  );
}

/** Search box in a popover; results come from `items`. */
function PickerShell({
  label,
  icon,
  placeholder,
  q,
  setQ,
  open,
  setOpen,
  children,
}: {
  label: string;
  icon: ReactNode;
  placeholder: string;
  q: string;
  setQ: (v: string) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-12 justify-start text-muted-foreground">
          {icon}
          {label}
          <Plus className="ml-auto" strokeWidth={1.75} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[320px]">
        <div className="relative border-b p-2">
          <Search className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="pl-8" />
        </div>
        <div className="max-h-[280px] overflow-y-auto py-1">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

function PickerMessage({ children }: { children: ReactNode }) {
  return <div className="px-3 py-6 text-center text-[13px] text-muted-foreground">{children}</div>;
}

const optionClass = 'flex w-full items-center gap-2.5 px-3 py-2 text-left outline-none hover:bg-muted/60 focus-visible:bg-muted/60';

function PackagePicker({ onPick }: { onPick: (p: McpPackageSummary) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const list = useMcpPackages({ q: dq });
  // Platform MCP is on every team already; it is not something to share.
  const items = (list.data ?? []).filter((p) => !p.isPlatform && p.status === 'active');

  return (
    <PickerShell
      label="게시된 MCP 검색"
      icon={<Plug strokeWidth={1.75} />}
      placeholder="MCP 이름 검색"
      q={q}
      setQ={setQ}
      open={open}
      setOpen={setOpen}
    >
      {list.isPending ? (
        <PickerMessage>불러오는 중…</PickerMessage>
      ) : list.isError ? (
        <PickerMessage>목록을 불러오지 못했어요</PickerMessage>
      ) : items.length === 0 ? (
        <PickerMessage>{dq ? '조건에 맞는 MCP가 없어요' : '게시된 MCP가 없어요'}</PickerMessage>
      ) : (
        items.map((p) => (
          <button
            key={p.name}
            type="button"
            className={optionClass}
            onClick={() => {
              onPick(p);
              setOpen(false);
            }}
          >
            <McpIcon icon={p.icon} name={p.displayName || p.name} size="sm" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-medium">{p.displayName || p.name}</span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {p.name}
                {p.latestVersion ? ` · v${p.latestVersion}` : ''}
              </span>
            </span>
          </button>
        ))
      )}
    </PickerShell>
  );
}

function AppPicker({ onPick }: { onPick: (a: PublicAppRef) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const list = usePublicApps(dq, open);
  const items = list.data ?? [];

  return (
    <PickerShell
      label="공개 중인 앱 검색"
      icon={<AppWindow strokeWidth={1.75} />}
      placeholder="공개 중인 앱 검색"
      q={q}
      setQ={setQ}
      open={open}
      setOpen={setOpen}
    >
      {list.isPending ? (
        <PickerMessage>불러오는 중…</PickerMessage>
      ) : list.isError ? (
        <PickerMessage>목록을 불러오지 못했어요</PickerMessage>
      ) : items.length === 0 ? (
        <PickerMessage>{dq ? '조건에 맞는 앱이 없어요' : '공개 중인 앱이 없어요'}</PickerMessage>
      ) : (
        items.map((a) => (
          <button
            key={a.id}
            type="button"
            className={cn(optionClass)}
            onClick={() => {
              onPick(a);
              setOpen(false);
            }}
          >
            <AppIcon />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-medium">{a.name}</span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {hostOf(a.url)} · {a.team}
              </span>
            </span>
            <PublicBadge version={a.version} small />
          </button>
        ))
      )}
    </PickerShell>
  );
}
