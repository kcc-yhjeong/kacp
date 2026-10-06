import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { ChevronRight, Copy, Info, Plug, ShieldCheck, Sparkles, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApplyStatusBadge } from '@/components/admin/badges';
import { ErrorState, Field, PageContainer, PageHeader, SectionCard, TagInput } from '@/components/admin/page';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PageLoader } from '@/components/page-loader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SegmentList, SegmentTrigger, Tabs } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { adminApi, adminKeys, useAdminSettings } from '@/lib/admin/api';
import { REASONING_LABEL } from '@/lib/admin/labels';
import { DefaultMcpPicker } from '@/components/mcp/default-mcp-picker';
import type { AgentSkill, AgentTemplate, AgentTemplateInput, Reasoning } from '@/lib/admin/types';
import { errorMessage } from '@/lib/api';
import { formatTime } from '@/lib/format';

const newRoute = getRouteApi('/admin/agents/new');
const editRoute = getRouteApi('/admin/agents/$templateId');

const EMOJIS = ['🤖', '📊', '📝', '📈', '🧾', '📅', '💡', '🔍', '📚', '🧠', '✉️', '💬', '🛠️', '📦', '🎯', '🧪', '🗂️', '📣', '🧮', '🌐', '🔒', '🎨', '⚙️', '🚀'];
/** Bundled skill / tool names: lowercase letters, digits, `.`, `_`, `-`. */
const IDENT = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const identProblem = (t: string) => (IDENT.test(t) ? null : '소문자·숫자·. _ -만 쓸 수 있어요.');

/** A-06 new template (optionally duplicated from `?from=`). */
export function AgentNewPage() {
  const { from } = newRoute.useSearch();
  const source = useQuery({
    queryKey: adminKeys.template(from ?? ''),
    queryFn: () => adminApi.template(from ?? ''),
    enabled: !!from,
  });
  if (from && source.isPending) return <PageLoader />;
  if (from && source.isError)
    return (
      <PageContainer>
        <ErrorState title="복제할 템플릿을 불러오지 못했어요" error={source.error} onRetry={() => void source.refetch()} />
      </PageContainer>
    );
  const s = source.data;
  return (
    <AgentEditor
      key={from ?? 'new'}
      initial={
        s
          ? { name: `${s.name} 복사본`, icon: s.icon, description: s.description, spec: structuredClone(s.spec) }
          : { name: '', icon: '🤖', description: '', spec: { model: { reasoning: 'medium' }, instructions: '', skills: [], tools: { allow: [], deny: [] } } }
      }
    />
  );
}

/** A-06 edit template. */
export function AgentEditPage() {
  const { templateId } = editRoute.useParams();
  const t = useQuery({ queryKey: adminKeys.template(templateId), queryFn: () => adminApi.template(templateId) });
  if (t.isPending) return <PageLoader />;
  if (t.isError)
    return (
      <PageContainer>
        <ErrorState title="템플릿을 불러오지 못했어요" error={t.error} onRetry={() => void t.refetch()} />
      </PageContainer>
    );
  return (
    <AgentEditor
      key={`${t.data.id}-${t.data.version}`}
      template={t.data}
      initial={{ name: t.data.name, icon: t.data.icon, description: t.data.description, spec: structuredClone(t.data.spec) }}
    />
  );
}

function AgentEditor({ template, initial }: { template?: AgentTemplate; initial: AgentTemplateInput }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settings = useAdminSettings();
  const models = settings.data?.models.allowed ?? [];
  const defaultModel = models.find((m) => m.default)?.id ?? models[0]?.id ?? '';

  const [name, setName] = useState(initial.name);
  const [icon, setIcon] = useState(initial.icon || '🤖');
  const [description, setDescription] = useState(initial.description ?? '');
  const [modelId, setModelId] = useState(initial.spec.model?.id ?? '');
  const [reasoning, setReasoning] = useState<Reasoning>(initial.spec.model?.reasoning ?? 'medium');
  const [instructions, setInstructions] = useState(initial.spec.instructions ?? '');
  const [skills, setSkills] = useState<AgentSkill[]>(initial.spec.skills ?? []);
  const [allow, setAllow] = useState<string[]>(initial.spec.tools?.allow ?? []);
  const [deny, setDeny] = useState<string[]>(initial.spec.tools?.deny ?? []);
  const [defaultMcp, setDefaultMcp] = useState<string[]>(initial.spec.defaultMcp ?? []);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const effectiveModel = modelId || defaultModel;
  const assigned = template?.assignedTeams ?? [];
  const canSave = name.trim().length > 0 && !!effectiveModel && !saving;

  const body = (): AgentTemplateInput => ({
    name: name.trim(),
    icon,
    description: description.trim(),
    spec: {
      ...initial.spec,
      model: { id: effectiveModel, reasoning },
      instructions,
      skills,
      defaultMcp,
      tools: { allow, deny },
    },
  });

  const save = async () => {
    setSaving(true);
    try {
      if (template) {
        const saved = await adminApi.updateTemplate(template.id, body());
        toast.success(
          saved.assignedTeams.length > 0
            ? `v${saved.version}로 저장했어요. ${saved.assignedTeams.length}개 팀에 반영 대기로 표시돼요.`
            : `v${saved.version}로 저장했어요`,
        );
        await queryClient.invalidateQueries({ queryKey: adminKeys.templates });
        void queryClient.invalidateQueries({ queryKey: adminKeys.teamsAll });
      } else {
        const created = await adminApi.createTemplate(body());
        toast.success('템플릿을 만들었어요');
        await queryClient.invalidateQueries({ queryKey: adminKeys.templates });
        void navigate({ to: '/admin/agents/$templateId', params: { templateId: created.id } });
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!template) return;
    setSaving(true);
    try {
      await adminApi.deleteTemplate(template.id);
      toast.success('템플릿을 삭제했어요');
      setDeleteOpen(false);
      void queryClient.invalidateQueries({ queryKey: adminKeys.templates });
      void navigate({ to: '/admin/agents' });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const bundled = skills.filter((s) => s.source === 'bundled').map((s) => s.name);
  const uploaded = skills.filter((s) => s.source !== 'bundled');

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={
          <>
            <Link to="/admin/agents" className="hover:text-foreground">
              에이전트 템플릿
            </Link>
            <ChevronRight className="size-3.5" />
            <span className="text-foreground">{template ? template.name : '새 템플릿'}</span>
          </>
        }
        title={
          <span className="flex items-center gap-2">
            {template ? template.name : '새 템플릿'}
            {template && <Badge variant="outline">v{template.version} 편집 중</Badge>}
          </span>
        }
        description={template ? `${formatTime(template.updatedAt)} 수정${template.updatedBy ? ` · ${template.updatedBy.name}` : ''}` : undefined}
        actions={
          <>
            {template && (
              <Button variant="outline" asChild>
                <Link to="/admin/agents/new" search={{ from: template.id }}>
                  <Copy strokeWidth={1.75} />
                  복제
                </Link>
              </Button>
            )}
            <Button disabled={!canSave} onClick={() => void save()}>
              {template ? `v${template.version + 1}로 저장` : '만들기'}
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-4">
          <section className="grid grid-cols-[auto_1fr] gap-4 rounded-xl border p-6">
            <Field label="아이콘">
              <EmojiPicker value={icon} onChange={setIcon} />
            </Field>
            <Field id="a-name" label="이름">
              <Input id="a-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field id="a-desc" label="설명" className="col-span-2">
              <Input id="a-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field id="a-model" label="기본 모델" className="col-span-2 sm:col-span-1">
              <NativeSelect id="a-model" value={effectiveModel} onChange={(e) => setModelId(e.target.value)} className="w-full">
                {models.length === 0 && <option value="">플랫폼 설정에서 모델을 먼저 추가하세요</option>}
                {modelId && !models.some((m) => m.id === modelId) && <option value={modelId}>{modelId} (허용 목록에 없음)</option>}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} — {m.id}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="추론 수준" className="col-span-2 sm:col-span-1">
              <Tabs value={reasoning} onValueChange={(v) => setReasoning(v as Reasoning)}>
                <SegmentList>
                  {(['low', 'medium', 'high'] as const).map((r) => (
                    <SegmentTrigger key={r} value={r}>
                      {REASONING_LABEL[r]}
                    </SegmentTrigger>
                  ))}
                </SegmentList>
              </Tabs>
            </Field>
          </section>

          <SectionCard
            title="지시문"
            actions={<span className="text-xs text-muted-foreground">팀 에이전트 작업 공간의 AGENTS.md로 저장돼요</span>}
            bodyClassName="flex flex-col gap-2 p-5"
          >
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="size-3.5" strokeWidth={1.75} />
              플랫폼 기본 지시문이 앞에 자동으로 붙어요
            </span>
            <Textarea
              aria-label="지시문"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="min-h-56 font-mono text-[13px] leading-relaxed"
              placeholder={'## 역할\n너는 …\n\n## 규칙\n- …'}
            />
          </SectionCard>

          <SectionCard
            icon={Sparkles}
            title="스킬"
            actions={
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button variant="outline" size="sm" disabled>
                      <Upload strokeWidth={1.75} />
                      업로드
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>준비 중</TooltipContent>
              </Tooltip>
            }
            bodyClassName="flex flex-col gap-2 p-5"
          >
            <TagInput
              ariaLabel="번들 스킬"
              value={bundled}
              validate={identProblem}
              placeholder="번들 스킬 이름 입력 후 Enter"
              onChange={(names) => setSkills([...names.map((n) => ({ name: n, source: 'bundled' as const })), ...uploaded])}
            />
            {uploaded.length > 0 && (
              <span className="text-xs text-muted-foreground">업로드 스킬: {uploaded.map((s) => s.name).join(', ')}</span>
            )}
            <span className="text-xs text-muted-foreground">OpenClaw 번들 스킬 중 허용된 이름만 저장돼요.</span>
          </SectionCard>

          <SectionCard icon={Plug} title="기본 MCP" bodyClassName="flex flex-col gap-2 p-5">
            <DefaultMcpPicker value={defaultMcp} onChange={setDefaultMcp} />
            <span className="text-xs text-muted-foreground">할당하면 팀에 함께 설치돼요. platform-mcp는 모든 팀에 항상 들어 있어요</span>
          </SectionCard>

          <SectionCard icon={ShieldCheck} title="도구 권한" bodyClassName="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
            <Field label="허용">
              <TagInput ariaLabel="허용 도구" value={allow} onChange={setAllow} validate={identProblem} placeholder="예: drive.read" />
            </Field>
            <Field label="차단">
              <TagInput ariaLabel="차단 도구" value={deny} onChange={setDeny} validate={identProblem} placeholder="예: shell.exec" />
            </Field>
          </SectionCard>
        </div>

        <div className="flex flex-col gap-4">
          <SectionCard title={`이 템플릿을 쓰는 팀 · ${assigned.length}`}>
            {assigned.length === 0 && <div className="px-5 py-4 text-[13px] text-muted-foreground">아직 할당한 팀이 없어요</div>}
            {assigned.map((a) => (
              <Link
                key={a.name}
                to="/admin/teams/$team"
                params={{ team: a.name }}
                className="flex items-center gap-2 border-b px-5 py-2.5 text-[13px] last:border-b-0 hover:bg-muted/50"
              >
                <span className="flex-1 font-mono">{a.name}</span>
                <ApplyStatusBadge status={a.applyStatus} />
              </Link>
            ))}
          </SectionCard>
          {template && assigned.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-xl border px-4 py-3 text-[13px]">
              <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              저장하면 {assigned.length}개 팀에 반영 대기로 표시돼요. 실행 중인 팀은 잠깐 재시작돼요.
            </p>
          )}
          {template && (
            <div className="flex flex-col gap-2 rounded-xl border p-4">
              <span className="text-sm font-medium">템플릿 삭제</span>
              <span className="text-xs text-muted-foreground">
                {assigned.length > 0 ? '할당된 팀이 있어 삭제할 수 없어요. 먼저 할당을 해제하세요.' : '되돌릴 수 없어요.'}
              </span>
              <div>
                <Button variant="destructive" size="sm" disabled={assigned.length > 0} onClick={() => setDeleteOpen(true)}>
                  <Trash2 strokeWidth={1.75} />
                  템플릿 삭제
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`${template?.name ?? ''} 템플릿을 삭제할까요?`}
        description="되돌릴 수 없어요."
        confirmLabel="템플릿 삭제"
        destructive
        pending={saving}
        onConfirm={() => void remove()}
      />
    </PageContainer>
  );
}

function EmojiPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="아이콘 선택"
          className="grid size-9 place-items-center rounded-md border text-lg outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {value}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2">
        <div className="grid grid-cols-8 gap-1">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onChange(e);
                setOpen(false);
              }}
              className="grid size-7 place-items-center rounded-md text-base hover:bg-accent aria-pressed:bg-accent"
              aria-pressed={value === e}
            >
              {e}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-1.5 border-t pt-2">
          <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="직접 입력" className="h-8" maxLength={8} />
          <Button
            size="sm"
            variant="outline"
            disabled={!custom.trim()}
            onClick={() => {
              onChange(custom.trim());
              setCustom('');
              setOpen(false);
            }}
          >
            적용
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
