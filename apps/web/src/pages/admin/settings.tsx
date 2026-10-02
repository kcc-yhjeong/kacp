import { NAME_PATTERN } from '@kacp/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Eye, EyeOff, Globe, KeyRound, Lock, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ErrorState, Field, PageContainer, PageHeader, SectionCard, TagInput } from '@/components/admin/page';
import { PageLoader } from '@/components/page-loader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { adminApi, adminKeys, useAdminSettings } from '@/lib/admin/api';
import type { AllowedModel, CapacityResource, PlatformSettings, ResourceLimits } from '@/lib/admin/types';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

/** A-10 platform settings. */
export function SettingsPage() {
  const settings = useAdminSettings();
  if (settings.isPending) return <PageLoader />;
  if (settings.isError)
    return (
      <PageContainer>
        <ErrorState title="설정을 불러오지 못했어요" error={settings.error} onRetry={() => void settings.refetch()} />
      </PageContainer>
    );
  return <SettingsForm initial={settings.data} />;
}

function SettingsForm({ initial }: { initial: PlatformSettings }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<PlatformSettings>(() => structuredClone(initial));
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(structuredClone(initial)), [initial]);

  const dirty = JSON.stringify(strip(draft)) !== JSON.stringify(strip(initial));
  const models = draft.models.allowed;
  const valid = models.every((m) => m.id.trim() && m.label.trim() && m.provider.trim());

  const setModels = (allowed: AllowedModel[]) => setDraft((d) => ({ ...d, models: { ...d.models, allowed } }));
  const setLimit = (key: keyof PlatformSettings['limits'], v: ResourceLimits) =>
    setDraft((d) => ({ ...d, limits: { ...d.limits, [key]: v } }));
  const setOps = (patch: Partial<PlatformSettings['ops']>) => setDraft((d) => ({ ...d, ops: { ...d.ops, ...patch } }));

  const save = async () => {
    setSaving(true);
    try {
      const saved = await adminApi.saveSettings(strip(draft));
      queryClient.setQueryData(adminKeys.settings, saved);
      toast.success('설정을 저장했어요');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const providers = [
    ...new Set([...models.map((m) => m.provider).filter(Boolean), ...Object.keys(initial.models.apiKeysConfigured ?? {})]),
  ];

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader
        title="플랫폼 설정"
        description="모든 팀에 적용되는 기본값이에요."
        actions={
          <>
            {dirty && (
              <Button variant="outline" onClick={() => setDraft(structuredClone(initial))}>
                되돌리기
              </Button>
            )}
            <Button disabled={!dirty || !valid || saving} onClick={() => void save()}>
              저장
            </Button>
          </>
        }
      />

      <SectionCard title="모델" bodyClassName="flex flex-col">
        <ModelsEditor models={models} onChange={setModels} />
      </SectionCard>

      <SectionCard icon={KeyRound} title="공용 API 키" actions={<span className="text-xs text-muted-foreground">입력 후 가려져요. 바꾸기만 할 수 있어요</span>}>
        {providers.length === 0 && <div className="px-5 py-4 text-[13px] text-muted-foreground">모델을 추가하면 제공자별 키를 넣을 수 있어요</div>}
        {providers.map((p) => (
          <ApiKeyRow key={p} provider={p} configured={!!initial.models.apiKeysConfigured?.[p]} />
        ))}
        <div className="px-5 py-2.5 text-xs text-muted-foreground">키를 바꾸면 실행 중인 팀은 재시작해야 반영돼요.</div>
      </SectionCard>

      <SectionCard title="기본 리소스 한도" bodyClassName="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
        <LimitGroup label="팀" value={draft.limits.teamDefault} onChange={(v) => setLimit('teamDefault', v)} disk />
        <LimitGroup label="앱" value={draft.limits.appDefault} onChange={(v) => setLimit('appDefault', v)} />
        <LimitGroup label="MCP 컨테이너" value={draft.limits.mcpDefault} onChange={(v) => setLimit('mcpDefault', v)} />
      </SectionCard>

      <SectionCard title="운영" bodyClassName="flex flex-col">
        <OpsRow label="팀 에이전트 유휴 정지" hint="heartbeat가 끊긴 뒤">
          <NumInput value={draft.ops.idleStopMinutes} onChange={(v) => setOps({ idleStopMinutes: v })} unit="분" />
        </OpsRow>
        <OpsRow label="앱 유휴 정지 시간" hint="접속이 없으면 잠들어요. 접속하면 자동으로 깨어나요.">
          <span className="flex items-center gap-1.5 text-[13px]">
            <Lock className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
            작업본
          </span>
          <NumInput
            value={draft.ops.appIdleStopMinutes.work}
            onChange={(v) => setOps({ appIdleStopMinutes: { ...draft.ops.appIdleStopMinutes, work: v } })}
            unit="분"
          />
          <span className="ml-3 flex items-center gap-1.5 text-[13px]">
            <Globe className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
            공개본
          </span>
          <NumInput
            value={draft.ops.appIdleStopMinutes.public}
            onChange={(v) => setOps({ appIdleStopMinutes: { ...draft.ops.appIdleStopMinutes, public: v } })}
            unit="분"
          />
        </OpsRow>
        <OpsRow label="팀당 동시 실행 작업본 수" hint="넘으면 가장 오래 안 쓴 작업본부터 잠들어요">
          <NumInput value={draft.ops.maxRunningWorkAppsPerTeam} onChange={(v) => setOps({ maxRunningWorkAppsPerTeam: v })} unit="개" />
        </OpsRow>
        <OpsRow label="용량 경고 기준" hint="대시보드 경고 띠 · 주의(노랑) / 위험(빨강)">
          <CapacityGrid
            value={draft.ops.capacityWarn}
            onChange={(capacityWarn) => setOps({ capacityWarn })}
          />
        </OpsRow>
        <OpsRow label="휴지통 보관">
          <NumInput value={draft.ops.trashRetentionDays} onChange={(v) => setOps({ trashRetentionDays: v })} unit="일" />
        </OpsRow>
      </SectionCard>

      <SectionCard
        title="예약어"
        actions={<span className="text-xs text-muted-foreground">회색 = 기본 · 테두리 = 추가한 것</span>}
        bodyClassName="flex flex-col gap-3 p-5"
      >
        <div className="flex flex-wrap gap-1.5">
          {(initial.names.reserved ?? []).map((r) => (
            <Badge key={r} variant="secondary" className="font-mono text-[11.5px]">
              {r}
            </Badge>
          ))}
        </div>
        <TagInput
          ariaLabel="추가 예약어"
          value={draft.names.reservedExtra}
          onChange={(reservedExtra) => setDraft((d) => ({ ...d, names: { ...d.names, reservedExtra } }))}
          placeholder="예약어 추가 후 Enter"
          validate={(t) =>
            !NAME_PATTERN.test(t)
              ? '소문자·숫자·하이픈만, 3~30자로 입력하세요.'
              : (initial.names.reserved ?? []).includes(t)
                ? '이미 기본 예약어예요.'
                : null
          }
        />
      </SectionCard>
    </PageContainer>
  );
}

/** Drop read-only fields before comparing / sending. */
function strip(s: PlatformSettings): PlatformSettings {
  return {
    models: { allowed: s.models.allowed },
    limits: s.limits,
    ops: s.ops,
    names: { reservedExtra: s.names.reservedExtra },
  };
}

function ModelsEditor({ models, onChange }: { models: AllowedModel[]; onChange: (m: AllowedModel[]) => void }) {
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const provider = id.includes('/') ? (id.split('/')[0] ?? '') : '';

  const move = (i: number, d: -1 | 1) => {
    const next = [...models];
    const j = i + d;
    const a = next[i];
    const b = next[j];
    if (!a || !b) return;
    next[i] = b;
    next[j] = a;
    onChange(next);
  };
  const add = () => {
    const mid = id.trim();
    if (!mid.includes('/')) {
      toast.error('모델 ID는 제공자 접두사를 포함해야 해요. 예: anthropic/claude-sonnet-4-5');
      return;
    }
    if (models.some((m) => m.id === mid)) {
      toast.error('이미 있는 모델이에요.');
      return;
    }
    onChange([...models, { id: mid, label: label.trim() || mid, provider, default: models.length === 0 }]);
    setId('');
    setLabel('');
  };

  return (
    <>
      {models.length === 0 && <div className="px-5 py-4 text-[13px] text-muted-foreground">허용된 모델이 없어요. 아래에서 추가하세요.</div>}
      {models.map((m, i) => (
        <div key={m.id} className="flex items-center gap-3 border-b px-5 py-2.5 text-[13.5px]">
          <span className="flex flex-col">
            <button type="button" aria-label="위로" disabled={i === 0} onClick={() => move(i, -1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30">
              <ArrowUp className="size-3.5" />
            </button>
            <button type="button" aria-label="아래로" disabled={i === models.length - 1} onClick={() => move(i, 1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30">
              <ArrowDown className="size-3.5" />
            </button>
          </span>
          <Input
            aria-label="표시 이름"
            value={m.label}
            onChange={(e) => onChange(models.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))}
            className="h-8 w-56"
          />
          <span className="text-[13px] text-muted-foreground">{m.provider}</span>
          <span className="flex-1 truncate font-mono text-xs text-muted-foreground">{m.id}</span>
          <label className="flex cursor-pointer items-center gap-1.5 text-[13px]">
            <input
              type="radio"
              name="default-model"
              checked={m.default}
              onChange={() => onChange(models.map((x, k) => ({ ...x, default: k === i })))}
              className="accent-[var(--primary)]"
            />
            기본
          </label>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`${m.label} 빼기`}
            onClick={() => {
              const next = models.filter((_, k) => k !== i);
              if (m.default && next[0]) next[0] = { ...next[0], default: true };
              onChange(next);
            }}
          >
            <Trash2 strokeWidth={1.75} />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-2 px-5 py-3">
        <Field id="m-id" label="모델 ID">
          <Input id="m-id" value={id} onChange={(e) => setId(e.target.value)} placeholder="anthropic/claude-sonnet-4-5" className="h-8 w-72 font-mono text-xs" />
        </Field>
        <Field id="m-label" label="표시 이름">
          <Input id="m-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Claude Sonnet 4.5" className="h-8 w-56" />
        </Field>
        <Button size="sm" variant="outline" disabled={!id.trim()} onClick={add}>
          <Plus strokeWidth={1.75} />
          추가
        </Button>
      </div>
    </>
  );
}

function ApiKeyRow({ provider, configured }: { provider: string; configured: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);
  const save = async () => {
    setPending(true);
    try {
      await adminApi.setApiKey(provider, key.trim());
      toast.success(`${provider} 키를 저장했어요`);
      setEditing(false);
      setKey('');
      void queryClient.invalidateQueries({ queryKey: adminKeys.settings });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex items-center gap-3 border-b px-5 py-2.5 text-[13.5px]">
      <span className="w-28 font-medium">{provider}</span>
      {editing ? (
        <>
          <div className="relative flex-1">
            <Input
              autoFocus
              type={show ? 'text' : 'password'}
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="h-8 pr-9 font-mono text-xs"
              aria-label={`${provider} API 키`}
            />
            <button
              type="button"
              aria-label={show ? '가리기' : '보기'}
              onClick={() => setShow((s) => !s)}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"
            >
              {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>
          <Button size="sm" disabled={!key.trim() || pending} onClick={() => void save()}>
            저장
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            취소
          </Button>
        </>
      ) : (
        <>
          <span className={cn('flex-1 font-mono text-xs', !configured && 'text-muted-foreground')}>{configured ? '••••••••••••' : '설정 안 됨'}</span>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            {configured ? '변경' : '입력'}
          </Button>
        </>
      )}
    </div>
  );
}

function LimitGroup({ label, value, onChange, disk = false }: { label: string; value: ResourceLimits; onChange: (v: ResourceLimits) => void; disk?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      <NumField label="CPU" unit="코어" step={0.25} value={value.cpu} onChange={(cpu) => onChange({ ...value, cpu })} />
      <NumField label="메모리" unit="MB" step={128} value={value.memoryMb} onChange={(memoryMb) => onChange({ ...value, memoryMb: Math.round(memoryMb) })} />
      {disk && <NumField label="디스크" unit="GB" step={1} value={value.diskGb} onChange={(diskGb) => onChange({ ...value, diskGb: Math.round(diskGb) })} />}
    </div>
  );
}

function NumField({ label, unit, step, value, onChange }: { label: string; unit: string; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <span className="w-14 text-muted-foreground">{label}</span>
      <Input type="number" min={0} step={step} value={value} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} className="h-8 w-24" />
      <span className="text-muted-foreground">{unit}</span>
    </label>
  );
}

function OpsRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3 last:border-b-0">
      <span className="flex min-w-[240px] flex-1 flex-col">
        <span className="text-[13.5px]">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span className="flex flex-wrap items-center gap-2">{children}</span>
    </div>
  );
}

function NumInput({ value, onChange, unit }: { value: number; onChange: (v: number) => void; unit: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[13px]">
      <Input type="number" min={0} step={1} value={value} onChange={(e) => onChange(e.target.value === '' ? 0 : Math.round(Number(e.target.value)))} className="h-8 w-20" />
      <span className="text-muted-foreground">{unit}</span>
    </span>
  );
}

const RESOURCES: { key: CapacityResource; label: string }[] = [
  { key: 'cpu', label: 'CPU' },
  { key: 'memory', label: '메모리' },
  { key: 'disk', label: '디스크' },
];

function CapacityGrid({
  value,
  onChange,
}: {
  value: PlatformSettings['ops']['capacityWarn'];
  onChange: (v: PlatformSettings['ops']['capacityWarn']) => void;
}) {
  return (
    <span className="grid grid-cols-[auto_repeat(3,auto)] items-center gap-x-3 gap-y-1.5 text-[13px]">
      <span />
      {RESOURCES.map((r) => (
        <span key={r.key} className="text-xs text-muted-foreground">
          {r.label}
        </span>
      ))}
      {(['warn', 'danger'] as const).map((level) => (
        <span key={level} className="contents">
          <span className="flex items-center gap-1.5">
            <span className={cn('size-1.5 rounded-full', level === 'warn' ? 'bg-warning' : 'bg-danger')} />
            {level === 'warn' ? '주의' : '위험'}
          </span>
          {RESOURCES.map((r) => (
            <span key={r.key} className="flex items-center gap-1">
              <Input
                type="number"
                min={1}
                max={100}
                aria-label={`${level === 'warn' ? '주의' : '위험'} ${r.label}`}
                value={value[level][r.key]}
                onChange={(e) => onChange({ ...value, [level]: { ...value[level], [r.key]: Math.round(Number(e.target.value) || 0) } })}
                className="h-8 w-16"
              />
              %
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}
