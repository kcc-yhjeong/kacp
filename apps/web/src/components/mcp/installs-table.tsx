import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Info, KeyRound, Loader2, MoreHorizontal, Plug, Store, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/admin/page';
import { MemBar, Requester } from '@/components/apps/common';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormAlert } from '@/components/form-alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { errorMessage } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { mcpApi, mcpKeys } from '@/lib/mcp/api';
import { canReenterSecrets, canRemoveInstall, secretPayload } from '@/lib/mcp/status';
import type { McpInstall } from '@/lib/mcp/types';
import { InstallStatusBadge, ScopeBadge } from './badges';
import { SecretInput } from './parts';

/** Refresh every list that shows a team's installs. */
export function useRefreshInstalls() {
  const qc = useQueryClient();
  return (team: string) => {
    void qc.invalidateQueries({ queryKey: mcpKeys.installs(team) });
    void qc.invalidateQueries({ queryKey: mcpKeys.packagesAll });
    void qc.invalidateQueries({ queryKey: ['mcp', 'package'] });
    void qc.invalidateQueries({ queryKey: mcpKeys.adminAll });
  };
}

/** "팀 에이전트가 꺼져 있어 …" / "아직 확인한 적 없음 …" (U-11). */
export function SyncBanner({ teamRunning, lastSyncedAt }: { teamRunning: boolean; lastSyncedAt: string | null }) {
  if (teamRunning && lastSyncedAt) return null;
  const text = !lastSyncedAt
    ? '아직 확인한 적 없음 · 팀 에이전트가 처음 켜지면 설치 상태를 확인해요'
    : `팀 에이전트가 꺼져 있어 마지막으로 확인한 목록을 보여줘요 · ${formatTime(lastSyncedAt)} 확인`;
  return (
    <div role="status" className="flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px]">
      <Info className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      {text}
    </div>
  );
}

/**
 * U-11 / U-15 installs table. `mode=team`: row menu for team admins (비밀값 다시 입력 / 제거 / 정식 등록 안내).
 * `mode=admin` (A-05): read-only + 강제 제거.
 */
export function InstallsTable({
  team,
  items,
  canManage,
  mode = 'team',
  onFindMarket,
}: {
  team: string;
  items: McpInstall[];
  canManage: boolean;
  mode?: 'team' | 'admin';
  onFindMarket?: () => void;
}) {
  const refresh = useRefreshInstalls();
  const [secretsFor, setSecretsFor] = useState<McpInstall | null>(null);
  const [removing, setRemoving] = useState<McpInstall | null>(null);
  const [pending, setPending] = useState(false);

  const remove = async () => {
    if (!removing) return;
    setPending(true);
    try {
      await mcpApi.remove(team, removing.id);
      toast.success(`${removing.name}을(를) 제거하고 있어요`);
      setRemoving(null);
      refresh(team);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="rounded-xl border">
        <EmptyState
          icon={Plug}
          title="아직 설치된 MCP가 없어요"
          description="MCP 마켓에서 팀에 필요한 도구를 찾아 설치하세요"
          action={
            onFindMarket && (
              <Button size="sm" variant="outline" onClick={onFindMarket}>
                마켓에서 찾기
              </Button>
            )
          }
        />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>이름</TableHead>
            <TableHead>출처</TableHead>
            <TableHead>버전</TableHead>
            <TableHead>상태</TableHead>
            <TableHead>CPU · 메모리</TableHead>
            <TableHead>설치한 사람</TableHead>
            <TableHead>마지막 확인</TableHead>
            {canManage && <TableHead className="w-12" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((i) => (
            <TableRow key={i.id} className={i.status === 'removing' ? 'text-muted-foreground' : undefined}>
              <TableCell>
                <span className="flex flex-col">
                  {i.packageName ? (
                    <Link to="/market/$pkg" params={{ pkg: i.packageName }} className="font-medium hover:underline">
                      {i.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{i.name}</span>
                  )}
                  {i.source === 'manual' && i.manualUrl && (
                    <span className="max-w-[260px] truncate font-mono text-xs text-muted-foreground">{i.manualUrl}</span>
                  )}
                </span>
              </TableCell>
              <TableCell>
                <ScopeBadge source={i.source} />
              </TableCell>
              <TableCell className="font-mono text-xs tabular-nums">{i.version ?? '—'}</TableCell>
              <TableCell>
                <span className="flex flex-col gap-0.5">
                  <InstallStatusBadge status={i.status} />
                  {i.status === 'error' && i.statusDetail && (
                    <span className="max-w-[240px] truncate text-xs text-muted-foreground" title={i.statusDetail}>
                      {i.statusDetail}
                    </span>
                  )}
                </span>
              </TableCell>
              <TableCell>
                {i.source === 'manual' || !i.usage ? (
                  <span className="text-xs text-muted-foreground">—</span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="w-12 text-xs whitespace-nowrap text-muted-foreground tabular-nums" title="CPU 1코어 = 100%">
                      {(i.usage.cpuPct ?? 0).toFixed(1)}%
                    </span>
                    <MemBar usage={i.usage} />
                  </span>
                )}
              </TableCell>
              <TableCell className="text-[13px]">
                {i.installedBy ? <Requester user={i.installedBy} /> : <span className="text-muted-foreground">시스템</span>}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground tabular-nums">
                {i.lastCheckedAt ? formatTime(i.lastCheckedAt) : '아직 확인한 적 없음'}
              </TableCell>
              {canManage && (
                <TableCell className="text-right">
                  {mode === 'admin' ? (
                    canRemoveInstall(i) ? (
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(i)}>
                        강제 제거
                      </Button>
                    ) : (
                      <FixedNote />
                    )
                  ) : (
                    <RowMenu install={i} onSecrets={() => setSecretsFor(i)} onRemove={() => setRemoving(i)} />
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <SecretsDialog team={team} install={secretsFor} onOpenChange={(v) => !v && setSecretsFor(null)} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={`${removing?.name ?? ''}을(를) ${mode === 'admin' ? '강제로 ' : ''}제거할까요?`}
        description="팀 에이전트가 이 도구를 더 쓸 수 없어요. 실행 중이면 팀 에이전트 설정에 바로 반영돼요. 팀 비밀값도 함께 지워요."
        confirmLabel={mode === 'admin' ? '강제 제거' : '제거'}
        destructive
        pending={pending}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

function FixedNote() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="text-xs text-muted-foreground">
          제거 불가
        </span>
      </TooltipTrigger>
      <TooltipContent>platform-mcp는 모든 팀에 항상 있어요</TooltipContent>
    </Tooltip>
  );
}

function RowMenu({ install, onSecrets, onRemove }: { install: McpInstall; onSecrets: () => void; onRemove: () => void }) {
  const secrets = canReenterSecrets(install);
  const removable = canRemoveInstall(install);
  const manual = install.source === 'manual';
  if (!secrets && !removable && !manual) return <FixedNote />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label={`${install.name} 메뉴`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[220px]">
        {secrets && (
          <DropdownMenuItem onSelect={onSecrets}>
            <KeyRound className="text-muted-foreground" strokeWidth={1.75} />
            비밀값 다시 입력
          </DropdownMenuItem>
        )}
        {manual && (
          <DropdownMenuItem asChild>
            <Link to="/market/mine">
              <Store className="text-muted-foreground" strokeWidth={1.75} />
              마켓에 정식 등록하기
            </Link>
          </DropdownMenuItem>
        )}
        {removable && (
          <>
            {(secrets || manual) && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={onRemove} className="text-danger focus:text-danger">
              <Trash2 strokeWidth={1.75} />
              제거
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 비밀값 다시 입력: values are never shown again; only filled fields are sent. */
function SecretsDialog({ team, install, onOpenChange }: { team: string; install: McpInstall | null; onOpenChange: (v: boolean) => void }) {
  const refresh = useRefreshInstalls();
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const payload = secretPayload(values);
  const filled = Object.keys(payload).length;

  const close = () => {
    setValues({});
    setError(null);
    onOpenChange(false);
  };

  const submit = async () => {
    if (!install || filled === 0) return;
    setPending(true);
    setError(null);
    try {
      await mcpApi.putSecrets(team, install.id, payload);
      toast.success('비밀값을 바꿨어요. MCP가 새 값으로 다시 시작해요');
      close();
      refresh(team);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={install !== null} onOpenChange={(v) => (v ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{install?.name} 비밀값 다시 입력</DialogTitle>
          <DialogDescription>저장한 값은 다시 보여주지 않아요. 바꿀 값만 새로 입력하세요.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {install?.secretNames.map((n) => (
            <div key={n} className="flex flex-col gap-1.5">
              <Label htmlFor={`secret-${n}`} className="flex items-center gap-1.5 font-mono text-[13px]">
                {n}
                <span className="font-sans text-xs font-normal text-muted-foreground">팀</span>
              </Label>
              <SecretInput id={`secret-${n}`} value={values[n] ?? ''} onChange={(v) => setValues((p) => ({ ...p, [n]: v }))} placeholder="••••••••" />
            </div>
          ))}
        </div>
        {error && <FormAlert message={error} />}
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={pending}>
            취소
          </Button>
          <Button onClick={() => void submit()} disabled={filled === 0 || pending}>
            {pending && <Loader2 className="animate-spin" />}
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
