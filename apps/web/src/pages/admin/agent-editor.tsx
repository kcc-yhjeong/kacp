import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { ChevronRight, Copy, Info, KeyRound, Plug, ShieldCheck, Sparkles, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ApplyStatusBadge } from '@/components/admin/badges';
import { ErrorState, Field, PageContainer, PageHeader, SectionCard, TagInput } from '@/components/admin/page';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PageLoader } from '@/components/page-loader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { joinDeny, joinSkills, SKILL_GROUPS, splitDeny, splitSkills, TOOL_BLOCKS, TOOL_IDS } from '@/lib/admin/agent-catalog';
import { adminApi, adminKeys } from '@/lib/admin/api';
import { REASONING_LABEL } from '@/lib/admin/labels';
import { DefaultMcpPicker } from '@/components/mcp/default-mcp-picker';
import { buildModelPayload, groupModels, keyEnvName, refProblem, refProvider, type KeyAction } from '@/lib/admin/template-model';
import type { AgentTemplate, AgentTemplateInput, ModelCatalog, Reasoning } from '@/lib/admin/types';
import { errorMessage } from '@/lib/api';
import { formatTime } from '@/lib/format';

const newRoute = getRouteApi('/admin/agents/new');
const editRoute = getRouteApi('/admin/agents/$templateId');

const EMOJIS = ['🤖', '📊', '📝', '📈', '🧾', '📅', '💡', '🔍', '📚', '🧠', '✉️', '💬', '🛠️', '📦', '🎯', '🧪', '🗂️', '📣', '🧮', '🌐', '🔒', '🎨', '⚙️', '🚀'];
/** Bundled skill names: lowercase letters, digits, `.`, `_`, `-`. */
const IDENT = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const identProblem = (t: string) => (IDENT.test(t) ? null : '소문자·숫자·. _ -만 쓸 수 있어요.');
/** Tool names also allow `:` (`group:web`) and `*` (wildcards). */
const TOOL_IDENT = /^[a-z0-9][a-z0-9._:*-]{0,63}$/;
const toolProblem = (t: string) => (TOOL_IDENT.test(t) ? null : '소문자·숫자·. _ - : *만 쓸 수 있어요.');
/** Model select value for "직접 입력". */
const CUSTOM = '__custom__';

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
          : { name: '', icon: '🤖', description: '', spec: { instructions: '', skills: [], tools: { allow: [], deny: [] } } }
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

  const [name, setName] = useState(initial.name);
  const [icon, setIcon] = useState(initial.icon || '🤖');
  const [description, setDescription] = useState(initial.description ?? '');
  const initialModelId = initial.spec.model?.id ?? '';
  /** '' = team default, a catalog ref, or CUSTOM. A ref missing from the catalog shows as CUSTOM. */
  const [picked, setPicked] = useState(initialModelId);
  const [customRef, setCustomRef] = useState(initialModelId);
  const keySet = template?.modelKeySet ?? false;
  const [keyAction, setKeyAction] = useState<KeyAction>({ kind: 'keep' });
  const [reasoning, setReasoning] = useState<Reasoning | ''>(initial.spec.model?.reasoning ?? '');
  const [instructions, setInstructions] = useState(initial.spec.instructions ?? '');
  const [initialSkills] = useState(() => splitSkills(initial.spec.skills ?? []));
  const [knownSkills, setKnownSkills] = useState<string[]>(initialSkills.known);
  const [customSkills, setCustomSkills] = useState<string[]>(initialSkills.custom);
  const uploadedSkills = initialSkills.uploaded;
  const [initialDeny] = useState(() => splitDeny(initial.spec.tools?.deny ?? []));
  const [blocked, setBlocked] = useState<string[]>(initialDeny.checked);
  const [denyRest, setDenyRest] = useState<string[]>(initialDeny.rest);
  const [allow, setAllow] = useState<string[]>(initial.spec.tools?.allow ?? []);
  const [defaultMcp, setDefaultMcp] = useState<string[]>(initial.spec.defaultMcp ?? []);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const models = useQuery({ queryKey: adminKeys.models, queryFn: adminApi.models, staleTime: 60_000 });
  const catalogRefs = new Set((models.data?.items ?? []).map((m) => m.ref));
  const selectValue = picked === '' || picked === CUSTOM || catalogRefs.has(picked) ? picked : CUSTOM;
  const modelId = selectValue === CUSTOM ? customRef.trim() : selectValue;
  const customError = selectValue === CUSTOM ? refProblem(customRef) : null;
  const provider = refProvider(modelId);

  const assigned = template?.assignedTeams ?? [];
  const canSave = name.trim().length > 0 && !saving && !models.isPending && !customError;

  const body = (): AgentTemplateInput => {
    const { model: _model, ...rest } = initial.spec;
    const { model, modelKey } = buildModelPayload({ modelId, reasoning, key: keyAction, keySet });
    return {
      name: name.trim(),
      icon,
      description: description.trim(),
      ...(modelKey !== undefined ? { modelKey } : {}),
      spec: {
        ...rest,
        ...(model ? { model } : {}),
        instructions,
        skills: joinSkills(knownSkills, customSkills, uploadedSkills),
        defaultMcp,
        tools: { allow, deny: joinDeny(blocked, denyRest) },
      },
    };
  };
  const toggle = (list: string[], item: string, on: boolean) => (on ? [...list, item] : list.filter((x) => x !== item));

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
            <ModelField
              selectValue={selectValue}
              onSelect={setPicked}
              customRef={customRef}
              onCustomRef={setCustomRef}
              customError={customError}
              models={models}
              keyWillClear={keySet && !models.isPending && !provider}
            />
            {provider && <KeyField provider={provider} keySet={keySet} action={keyAction} onAction={setKeyAction} />}
            <Field id="a-reasoning" label="추론 수준 (선택)" className="col-span-2 max-w-sm" hint="추론 수준이 높을수록 더 꼼꼼하지만 느려요.">
              <NativeSelect id="a-reasoning" value={reasoning} onChange={(e) => setReasoning(e.target.value as Reasoning | '')} className="w-full">
                <option value="">기본값(팀 설정)</option>
                {(['low', 'medium', 'high'] as const).map((r) => (
                  <option key={r} value={r}>
                    {REASONING_LABEL[r]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </section>

          <SectionCard
            title="지시문"
            actions={<span className="text-xs text-muted-foreground">팀 에이전트 작업 공간의 AGENTS.md로 저장돼요</span>}
            bodyClassName="flex flex-col gap-2 p-5"
          >
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="size-3.5 shrink-0" strokeWidth={1.75} />
              모든 에이전트에는 플랫폼 기본 지시문(팀 드라이브·웹 앱 사용법)이 앞에 자동으로 붙어요. 여기에는 이 에이전트의 역할과 규칙만 적어요.
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
            <span className="text-xs text-muted-foreground">아무것도 고르지 않으면 기본 스킬을 모두 쓸 수 있어요. 고르면 고른 것만 써요.</span>
            {SKILL_GROUPS.map((g) => (
              <fieldset key={g.title} className="flex flex-col gap-1">
                <legend className="mb-1 text-[13px] font-medium">{g.title}</legend>
                <div className="grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2">
                  {g.skills.map((sk) => (
                    <CheckRow
                      key={sk.name}
                      id={`skill-${sk.name}`}
                      checked={knownSkills.includes(sk.name)}
                      onChange={(on) => setKnownSkills((l) => toggle(l, sk.name, on))}
                      label={sk.label}
                      sub={sk.name}
                    >
                      {sk.description}
                      {sk.needs && <span className="mt-0.5 block text-[11.5px]">필요: {sk.needs}</span>}
                    </CheckRow>
                  ))}
                </div>
              </fieldset>
            ))}
            <Disclosure title="직접 입력" count={customSkills.length} defaultOpen={customSkills.length > 0}>
              <TagInput
                ariaLabel="직접 입력한 스킬"
                value={customSkills}
                validate={identProblem}
                placeholder="스킬 이름 입력 후 Enter"
                onChange={setCustomSkills}
              />
              <span className="text-xs text-muted-foreground">목록에 없는 OpenClaw 기본 스킬을 이름으로 추가해요. 이름이 틀리면 무시돼요.</span>
            </Disclosure>
            {uploadedSkills.length > 0 && (
              <span className="text-xs text-muted-foreground">업로드 스킬(그대로 유지돼요): {uploadedSkills.map((sk) => sk.name).join(', ')}</span>
            )}
          </SectionCard>

          <SectionCard icon={Plug} title="기본 MCP" bodyClassName="flex flex-col gap-2 p-5">
            <DefaultMcpPicker value={defaultMcp} onChange={setDefaultMcp} />
            <span className="text-xs text-muted-foreground">
              이 에이전트를 팀에 할당할 때 팀에 자동으로 설치돼요. 비밀값이 필요한 MCP는 팀 관리자가 나중에 입력해요. platform-mcp는 모든 팀에 항상 들어 있어요.
            </span>
          </SectionCard>

          <SectionCard icon={ShieldCheck} title="도구 권한" bodyClassName="flex flex-col gap-3 p-5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] font-medium">막을 기능</span>
              <span className="text-xs text-muted-foreground">체크하지 않은 기능은 모두 쓸 수 있어요. 막으면 이 에이전트는 그 기능을 쓰지 못해요.</span>
            </div>
            <div className="flex flex-col gap-1">
              {TOOL_BLOCKS.map((b) => (
                <CheckRow
                  key={b.label}
                  id={`block-${b.deny.join('-')}`}
                  checked={blocked.includes(b.label)}
                  onChange={(on) => setBlocked((l) => toggle(l, b.label, on))}
                  label={b.label}
                >
                  {b.description}
                  <span className="mt-0.5 block text-[11.5px] text-muted-foreground/80">{b.impact}</span>
                </CheckRow>
              ))}
            </div>
            <Disclosure title="고급" count={denyRest.length + allow.length} defaultOpen={denyRest.length + allow.length > 0}>
              <Field label="추가로 막을 도구" hint="OpenClaw 도구 이름이나 그룹(group:…)을 적어요. 위에서 체크한 기능과 함께 막혀요.">
                <TagInput ariaLabel="추가 차단 도구" value={denyRest} onChange={setDenyRest} validate={toolProblem} suggestions={TOOL_IDS} placeholder="예: group:memory" />
              </Field>
              <Field label="허용 목록" hint="비워 두면 막지 않은 도구를 모두 쓸 수 있어요.">
                <p className="flex items-start gap-1.5 rounded-md border px-3 py-2 text-xs">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" strokeWidth={1.75} />
                  허용 목록을 쓰면 여기 적은 도구만 쓸 수 있어요(MCP 도구는 플랫폼이 자동으로 열어 둬요). 잘 모르면 비워 두세요.
                </p>
                <TagInput ariaLabel="허용 도구" value={allow} onChange={setAllow} validate={toolProblem} suggestions={TOOL_IDS} placeholder="예: group:fs" />
              </Field>
            </Disclosure>
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

/** Template model: team default, a model from running teams' catalogs, or a typed `provider/model`. */
function ModelField({
  selectValue,
  onSelect,
  customRef,
  onCustomRef,
  customError,
  models,
  keyWillClear,
}: {
  selectValue: string;
  onSelect: (v: string) => void;
  customRef: string;
  onCustomRef: (v: string) => void;
  customError: string | null;
  models: UseQueryResult<ModelCatalog>;
  keyWillClear: boolean;
}) {
  const groups = groupModels(models.data?.items ?? []);
  const selected = models.data?.items.find((m) => m.ref === selectValue);
  return (
    <Field id="a-model" label="모델 (선택)" className="col-span-2" hint="고르지 않으면 각 팀이 에이전트 화면에서 정한 기본 모델을 써요.">
      <div className="flex max-w-xl flex-col gap-1.5">
        <NativeSelect
          id="a-model"
          value={models.isPending ? '' : selectValue}
          disabled={models.isPending}
          onChange={(e) => onSelect(e.target.value)}
          className="w-full"
        >
          {models.isPending ? (
            <option value="">모델 목록을 불러오는 중…</option>
          ) : (
            <>
              <option value="">팀 기본 모델(지정 안 함)</option>
              {groups.map((g) => (
                <optgroup key={g.provider} label={g.provider}>
                  {g.items.map((m) => (
                    <option key={m.ref} value={m.ref}>
                      {m.name ? `${m.name} · ${m.ref}` : m.ref}
                    </option>
                  ))}
                </optgroup>
              ))}
              <option value={CUSTOM}>직접 입력</option>
            </>
          )}
        </NativeSelect>
        {selected?.name && <span className="font-mono text-xs text-muted-foreground">{selected.ref}</span>}
        {!models.isPending && selectValue === CUSTOM && (
          <div className="flex flex-col gap-1">
            <Input
              aria-label="모델 직접 입력"
              aria-invalid={!!customError}
              value={customRef}
              onChange={(e) => onCustomRef(e.target.value)}
              placeholder="openai/gpt-5.4-mini"
              className="font-mono text-[13px]"
            />
            {customError && <span className="text-xs text-destructive">{customError}</span>}
          </div>
        )}
        {models.isError && <span className="text-xs text-muted-foreground">모델 목록을 불러오지 못했어요. 직접 입력해도 돼요.</span>}
        {models.isSuccess && (
          <span className="text-xs text-muted-foreground">
            {models.data.items.length === 0
              ? '켜져 있는 팀이 없어 목록을 못 불러왔어요. 팀을 하나 켜면 그 팀이 쓸 수 있는 모델이 보여요. 직접 입력해도 돼요.'
              : `켜져 있는 팀(${models.data.teams.join(', ')})에서 쓸 수 있는 모델이에요.`}
          </span>
        )}
        {keyWillClear && (
          <p className="flex items-start gap-1.5 rounded-md border px-3 py-2 text-xs">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" strokeWidth={1.75} />
            모델을 지정하지 않으면 저장할 때 키도 지워져요.
          </p>
        )}
      </div>
    </Field>
  );
}

/** Optional provider key for the chosen model. The stored key is never shown. */
function KeyField({
  provider,
  keySet,
  action,
  onAction,
}: {
  provider: string;
  keySet: boolean;
  action: KeyAction;
  onAction: (a: KeyAction) => void;
}) {
  const env = keyEnvName(provider);
  const [editing, setEditing] = useState(!keySet);
  const [confirming, setConfirming] = useState(false);
  return (
    <Field
      id="a-model-key"
      label="API 키 (선택)"
      className="col-span-2"
      hint={
        <>
          <span className="block">
            넣으면 이 템플릿이 할당된 팀에 {env}처럼 들어가요. 실행 중인 팀은 저장할 때 자동으로 다시 시작돼요(약 1분). 같은 팀의 다른 에이전트도 이 키를 같이 써요.
          </span>
          <span className="block">비워 두면 각 팀 관리자가 에이전트 화면에서 넣은 키를 써요.</span>
        </>
      }
    >
      <div className="flex max-w-xl flex-col gap-1.5">
        {keySet && (
          <div className="flex flex-wrap items-center gap-2">
            {action.kind === 'clear' ? (
              <>
                <span className="text-[13px] text-muted-foreground">저장하면 키가 지워져요.</span>
                <Button variant="ghost" size="sm" onClick={() => onAction({ kind: 'keep' })}>
                  되돌리기
                </Button>
              </>
            ) : confirming ? (
              <>
                <span className="text-[13px]">저장할 때 키를 지울까요?</span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    onAction({ kind: 'clear' });
                    setConfirming(false);
                    setEditing(false);
                  }}
                >
                  지우기
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  취소
                </Button>
              </>
            ) : (
              <>
                <Badge variant="secondary">
                  <KeyRound strokeWidth={1.75} />
                  입력됨
                </Badge>
                {!editing && (
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                    변경
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirming(true)}>
                  지우기
                </Button>
              </>
            )}
          </div>
        )}
        {editing && action.kind !== 'clear' && (
          <Input
            id="a-model-key"
            type="password"
            autoComplete="new-password"
            value={action.kind === 'set' ? action.value : ''}
            onChange={(e) => onAction(e.target.value ? { kind: 'set', value: e.target.value } : { kind: 'keep' })}
            placeholder={`${env} 값`}
            className="font-mono text-[13px]"
          />
        )}
      </div>
    </Field>
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

/** Checkbox with a label, optional mono id, and a muted description. */
function CheckRow({
  id,
  checked,
  onChange,
  label,
  sub,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  sub?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer flex-col">
        <span className="flex items-baseline gap-1.5 text-[13.5px]">
          {label}
          {sub && <span className="font-mono text-[11px] text-muted-foreground">{sub}</span>}
        </span>
        {children && <span className="text-xs text-muted-foreground">{children}</span>}
      </label>
    </div>
  );
}

/** Collapsed section (native details), open by default when it already holds values. */
function Disclosure({ title, count, defaultOpen, children }: { title: string; count: number; defaultOpen: boolean; children: ReactNode }) {
  return (
    <details open={defaultOpen} className="group rounded-md border">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[13px] select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" strokeWidth={1.75} />
        {title}
        {count > 0 && <span className="text-xs text-muted-foreground tabular-nums">· {count}</span>}
      </summary>
      <div className="flex flex-col gap-3 border-t px-3 py-3">{children}</div>
    </details>
  );
}
