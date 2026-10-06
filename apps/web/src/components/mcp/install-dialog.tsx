import type { MyTeam } from '@kacp/shared';
import { Link } from '@tanstack/react-router';
import { CircleCheck, Globe, KeyRound, Loader2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { FormAlert } from '@/components/form-alert';
import { Stepper, type Step } from '@/components/stepper';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { ApiError, errorMessage } from '@/lib/api';
import { mcpApi, useTeamInstalls } from '@/lib/mcp/api';
import { consentComplete, consentItems, missingSecrets, secretPayload } from '@/lib/mcp/status';
import type { McpInstall, McpPackageDetail } from '@/lib/mcp/types';
import { cn } from '@/lib/utils';
import { InstallStatusBadge } from './badges';
import { SecretInput } from './parts';
import { useRefreshInstalls } from './installs-table';

const STEP_LABELS = ['대상 팀', '권한 확인', '비밀값 입력', '설치'] as const;

/** U-10 install modal: 대상 팀 → 권한 확인 → 비밀값 입력 → 설치 진행/완료. */
export function InstallDialog({
  pkg,
  open,
  onOpenChange,
  teams,
  preferredTeam,
}: {
  pkg: McpPackageDetail;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** The caller's teams (display names); install targets come from `pkg.canInstallTeams`. */
  teams: MyTeam[];
  preferredTeam?: string;
}) {
  // Remount on every open so the steps start over.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        {open && <InstallFlow pkg={pkg} teams={teams} preferredTeam={preferredTeam} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function InstallFlow({
  pkg,
  teams,
  preferredTeam,
  onClose,
}: {
  pkg: McpPackageDetail;
  teams: MyTeam[];
  preferredTeam?: string;
  onClose: () => void;
}) {
  const refresh = useRefreshInstalls();
  const targets = pkg.canInstallTeams;
  const labelOf = (name: string) => teams.find((t) => t.name === name)?.displayName ?? name;
  const [step, setStep] = useState(0);
  const [team, setTeam] = useState(() => (preferredTeam && targets.includes(preferredTeam) ? preferredTeam : (targets[0] ?? '')));
  const items = consentItems(pkg.manifest);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const secrets = pkg.manifest?.secrets ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<McpInstall | null>(null);

  const missing = missingSecrets(secrets, values);
  const consentOk = consentComplete(items, checked);
  const version = pkg.latestVersion;

  const steps: Step[] = STEP_LABELS.map((label, i) => ({
    label,
    state: i < step || (i === 3 && installed) ? 'done' : i === step ? 'current' : 'todo',
  }));

  const submit = async () => {
    setTouched(true);
    if (missing.length > 0) return;
    setPending(true);
    setError(null);
    try {
      const res = await mcpApi.install(team, { packageName: pkg.name, version: version ?? undefined, secrets: secretPayload(values) });
      setInstalled(res);
      setValues({});
      setStep(3);
      refresh(team);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION_FAILED' && Array.isArray(err.details?.missing)) {
        setError(`필수 비밀값을 입력하세요: ${(err.details.missing as unknown[]).join(', ')}`);
      } else if (err instanceof ApiError && err.code === 'MCP_ALREADY_INSTALLED') {
        setError(`${labelOf(team)}에는 이미 설치돼 있어요.`);
      } else if (err instanceof ApiError && err.code === 'MCP_SUSPENDED') {
        setError('게시가 중단된 MCP라 설치할 수 없어요.');
      } else setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{pkg.displayName} 설치</DialogTitle>
        <DialogDescription>
          {team ? `${labelOf(team)} · ` : ''}
          {version ? `v${version}` : ''}
        </DialogDescription>
      </DialogHeader>
      <Stepper steps={steps} className="py-1" />

      {step === 0 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="install-team" className="text-[13px]">
            대상 팀
          </Label>
          <NativeSelect id="install-team" value={team} onChange={(e) => setTeam(e.target.value)}>
            {targets.map((t) => (
              <option key={t} value={t}>
                {labelOf(t)}
                {t === preferredTeam && pkg.installedInTeam ? ' · 설치됨' : ''}
              </option>
            ))}
          </NativeSelect>
          <span className="text-xs text-muted-foreground">내가 팀 관리자인 팀(플랫폼 관리자는 모든 팀)</span>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">이 도구가 하는 일에 동의해 주세요</span>
          {items.length === 0 ? (
            <span className="rounded-lg border px-3 py-2.5 text-[13px] text-muted-foreground">인터넷에 접속하지 않고 비밀값도 쓰지 않아요.</span>
          ) : (
            <ul className="overflow-hidden rounded-lg border">
              {items.map((it) => (
                <li key={it.key}>
                  <label className="flex cursor-pointer items-start gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-muted/50">
                    <Checkbox
                      className="mt-0.5"
                      checked={checked.has(it.key)}
                      onCheckedChange={(c) =>
                        setChecked((prev) => {
                          const next = new Set(prev);
                          if (c === true) next.add(it.key);
                          else next.delete(it.key);
                          return next;
                        })
                      }
                    />
                    {it.kind === 'network' ? (
                      <Globe className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                    ) : (
                      <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                    )}
                    <span className="flex min-w-0 flex-col">
                      <span className="font-mono text-[13px]">{it.label}</span>
                      <span className="text-xs text-muted-foreground">{it.kind === 'network' ? '이 주소로 접속해요' : `팀 비밀값 · ${it.detail}`}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {pkg.manifest && (
            <span className="text-xs text-muted-foreground tabular-nums">
              리소스 CPU {pkg.manifest.resources.cpu} · 메모리 {pkg.manifest.resources.memoryMb} MB · 목록에 없는 곳으로는 접속할 수 없어요
            </span>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          {secrets.length === 0 ? (
            <span className="rounded-lg border px-3 py-2.5 text-[13px] text-muted-foreground">입력할 비밀값이 없어요. 바로 설치할 수 있어요.</span>
          ) : (
            secrets.map((s) => {
              const bad = touched && missing.includes(s.name);
              return (
                <div key={s.name} className="flex flex-col gap-1.5">
                  <Label htmlFor={`install-secret-${s.name}`} className="flex items-center gap-1.5 font-mono text-[13px]">
                    {s.name}
                    {s.required !== false && <span className="text-danger">*</span>}
                    <span className="font-sans text-xs font-normal text-muted-foreground">팀</span>
                  </Label>
                  <SecretInput
                    id={`install-secret-${s.name}`}
                    value={values[s.name] ?? ''}
                    onChange={(v) => setValues((p) => ({ ...p, [s.name]: v }))}
                    invalid={bad}
                    placeholder={s.required === false ? '선택' : undefined}
                  />
                  {s.description && <span className="text-xs text-muted-foreground">{s.description}</span>}
                  {bad && <span className="text-xs text-danger">입력하세요</span>}
                </div>
              );
            })
          )}
          <span className="text-xs text-muted-foreground">팀 비밀값은 팀 에이전트가 함께 써요. 저장하면 다시 보여주지 않고, 바꿀 때는 새로 입력해요.</span>
        </div>
      )}

      {step === 3 && installed && <Progress team={team} teamLabel={labelOf(team)} installId={installed.id} fallback={installed} onClose={onClose} />}

      {error && <FormAlert message={error} />}

      {step < 3 && (
        <DialogFooter>
          {step === 0 ? (
            <Button variant="outline" onClick={onClose}>
              취소
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={pending}>
              이전
            </Button>
          )}
          {step < 2 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={step === 0 ? !team : !consentOk}>
              다음
            </Button>
          ) : (
            <Button onClick={() => void submit()} disabled={pending || (touched && missing.length > 0)}>
              {pending && <Loader2 className="animate-spin" />}
              설치
            </Button>
          )}
        </DialogFooter>
      )}
    </>
  );
}

/** Step 4: follow the new install until it is installed or fails (polls every 3 s via useTeamInstalls). */
function Progress({
  team,
  teamLabel,
  installId,
  fallback,
  onClose,
}: {
  team: string;
  teamLabel: string;
  installId: string;
  fallback: McpInstall;
  onClose: () => void;
}) {
  const installs = useTeamInstalls(team);
  const row = installs.data?.items.find((i) => i.id === installId) ?? fallback;
  const done = row.status === 'installed';
  const failed = row.status === 'error';
  return (
    <div className="flex flex-col gap-4">
      <div className={cn('flex items-start gap-3 rounded-lg border px-4 py-3')}>
        {done ? (
          <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" strokeWidth={1.75} />
        ) : failed ? (
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" strokeWidth={1.75} />
        ) : (
          <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-muted-foreground" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-[13px]">
          <span className="font-medium">
            {done
              ? `${teamLabel}에 설치했어요`
              : failed
                ? '설치하지 못했어요'
                : installs.data && !installs.data.teamRunning
                  ? '설치를 접수했어요. 팀 에이전트가 켜지면 반영돼요'
                  : 'MCP를 띄우고 팀 에이전트에 연결하고 있어요'}
          </span>
          <span className="text-muted-foreground">
            {failed
              ? (row.statusDetail ?? '설치 목록에서 상태를 확인하고 다시 시도하세요.')
              : done
                ? '이제 팀 에이전트에게 이 도구로 할 일을 말해 보세요.'
                : '창을 닫아도 설치는 계속돼요.'}
          </span>
        </div>
        <InstallStatusBadge status={row.status} />
      </div>
      <DialogFooter>
        <Button variant="outline" asChild>
          <Link to="/market/installed" search={{ team }} onClick={onClose}>
            설치 목록 보기
          </Link>
        </Button>
        <Button onClick={onClose}>{done ? '완료' : '닫기'}</Button>
      </DialogFooter>
    </div>
  );
}
