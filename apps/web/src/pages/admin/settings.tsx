import { NAME_PATTERN } from '@kacp/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Globe, Lock } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ErrorState, PageContainer, PageHeader, SectionCard, TagInput } from '@/components/admin/page';
import { PageLoader } from '@/components/page-loader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { adminApi, adminKeys, useAdminSettings } from '@/lib/admin/api';
import type { CapacityResource, PlatformSettings, ResourceLimits } from '@/lib/admin/types';
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
            <Button disabled={!dirty || saving} onClick={() => void save()}>
              저장
            </Button>
          </>
        }
      />

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
    limits: s.limits,
    ops: s.ops,
    names: { reservedExtra: s.names.reservedExtra },
  };
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
