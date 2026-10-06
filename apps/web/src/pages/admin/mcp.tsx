import { useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { Grid3x3, Loader2, Package, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, ListSkeleton, PageContainer, PageHeader } from '@/components/admin/page';
import { Dot } from '@/components/apps/badges';
import { Requester } from '@/components/apps/common';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormAlert } from '@/components/form-alert';
import { InstallStatusBadge, McpIcon, PackageStatusBadge } from '@/components/mcp/badges';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { errorMessage } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { adminMcpApi, mcpApi, mcpKeys, useAdminMcpInstalls, useAdminMcpPackages } from '@/lib/mcp/api';
import { buildInstallMatrix, INSTALL_STATUS, latestInColumn } from '@/lib/mcp/status';
import type { AdminMcpInstall, McpPackageSummary } from '@/lib/mcp/types';
import { cn } from '@/lib/utils';

const route = getRouteApi('/admin/mcp');

export type McpAdminTab = 'packages' | 'installs' | 'manual';

export function isMcpAdminTab(v: unknown): v is McpAdminTab {
  return v === 'packages' || v === 'installs' || v === 'manual';
}

/** A-08 MCP 관리 — `/admin/mcp`. */
export function McpAdminPage() {
  const { tab = 'packages' } = route.useSearch();
  const navigate = useNavigate();
  const manual = useAdminMcpInstalls({ source: 'manual' });
  return (
    <PageContainer>
      <PageHeader title="MCP 관리" description="게시된 패키지와 팀별 설치 현황이에요." />
      <Tabs
        value={tab}
        onValueChange={(v) => void navigate({ to: '/admin/mcp', search: isMcpAdminTab(v) && v !== 'packages' ? { tab: v } : {} })}
        className="flex flex-col gap-4"
      >
        <TabsList>
          <TabsTrigger value="packages">패키지</TabsTrigger>
          <TabsTrigger value="installs">팀별 설치 현황</TabsTrigger>
          <TabsTrigger value="manual">직접 추가된 MCP {manual.data ? manual.data.length : ''}</TabsTrigger>
        </TabsList>
        <TabsContent value="packages">
          <PackagesTab />
        </TabsContent>
        <TabsContent value="installs">
          <MatrixTab />
        </TabsContent>
        <TabsContent value="manual">
          <ManualTab query={manual} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function useRefreshAdminMcp() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: mcpKeys.adminAll });
    void qc.invalidateQueries({ queryKey: mcpKeys.packagesAll });
  };
}

// ── 패키지

function PackagesTab() {
  const pkgs = useAdminMcpPackages();
  const refresh = useRefreshAdminMcp();
  const [suspending, setSuspending] = useState<McpPackageSummary | null>(null);
  const [resuming, setResuming] = useState<McpPackageSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const toggleDefault = async (p: McpPackageSummary, isDefault: boolean) => {
    setBusy(p.name);
    try {
      await adminMcpApi.setDefault(p.name, isDefault);
      toast.success(isDefault ? `${p.name}을(를) 새 팀에 자동 설치해요` : `${p.name} 자동 설치를 껐어요`);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const resume = async () => {
    if (!resuming) return;
    setBusy(resuming.name);
    try {
      await adminMcpApi.resume(resuming.name);
      toast.success(`${resuming.name} 게시를 다시 시작했어요`);
      setResuming(null);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const items = pkgs.data ?? [];
  return (
    <div className="overflow-hidden rounded-xl border">
      {pkgs.isPending ? (
        <ListSkeleton />
      ) : pkgs.isError ? (
        <ErrorState title="패키지를 불러오지 못했어요" error={pkgs.error} onRetry={() => void pkgs.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={Package} title="아직 패키지가 없어요" description="심사를 거쳐 게시된 MCP가 여기에 보여요" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>패키지</TableHead>
              <TableHead>최신</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="text-right">설치 팀</TableHead>
              <TableHead>전사 기본</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((p) => (
              <TableRow key={p.name}>
                <TableCell>
                  <Link to="/market/$pkg" params={{ pkg: p.name }} search={{}} className="flex items-center gap-2.5 hover:underline">
                    <McpIcon icon={p.icon} name={p.displayName || p.name} size="sm" />
                    <span className="flex flex-col">
                      <span className="font-medium">{p.displayName || p.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {p.name}
                        {p.owner && !p.isPlatform ? ` · ${p.owner.name}` : ''}
                      </span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">{p.latestVersion ?? '—'}</TableCell>
                <TableCell>
                  <PackageStatusBadge status={p.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{p.installCount.toLocaleString()}</TableCell>
                <TableCell>
                  {p.isPlatform ? (
                    <span className="text-xs text-muted-foreground">모든 팀 · 항상</span>
                  ) : (
                    <label className="flex items-center gap-2 text-xs">
                      <Switch
                        checked={p.isDefault}
                        disabled={busy === p.name || p.status === 'suspended' || !p.latestVersion}
                        onCheckedChange={(c) => void toggleDefault(p, c)}
                        aria-label={`${p.name} 전사 기본`}
                      />
                      <span className={p.isDefault ? '' : 'text-muted-foreground'}>{p.isDefault ? '새 팀에 자동 설치' : '끔'}</span>
                    </label>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {p.isPlatform ? null : p.status === 'active' ? (
                    <Button variant="ghost" size="sm" disabled={busy === p.name} onClick={() => setSuspending(p)}>
                      게시 중단
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" disabled={busy === p.name} onClick={() => setResuming(p)}>
                      게시 재개
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <SuspendDialog pkg={suspending} onOpenChange={(v) => !v && setSuspending(null)} onDone={refresh} />
      <ConfirmDialog
        open={resuming !== null}
        onOpenChange={(v) => !v && setResuming(null)}
        title={`${resuming?.name ?? ''} 게시를 다시 시작할까요?`}
        description="마켓에 다시 보이고 팀 관리자가 새로 설치할 수 있어요."
        confirmLabel="게시 재개"
        pending={busy !== null}
        onConfirm={() => void resume()}
      />
    </div>
  );
}

function SuspendDialog({ pkg, onOpenChange, onDone }: { pkg: McpPackageSummary | null; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [removeInstalls, setRemoveInstalls] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setRemoveInstalls(false);
    setError(null);
    onOpenChange(false);
  };
  const submit = async () => {
    if (!pkg) return;
    setPending(true);
    setError(null);
    try {
      await adminMcpApi.suspend(pkg.name, removeInstalls);
      toast.success(removeInstalls ? `${pkg.name} 게시를 중단하고 모든 팀에서 제거하고 있어요` : `${pkg.name} 게시를 중단했어요`);
      close();
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };
  const n = pkg?.installCount ?? 0;
  const options: { value: boolean; title: string; desc: string }[] = [
    { value: false, title: '기존 설치 유지', desc: '설치한 팀은 지금 버전을 계속 써요.' },
    { value: true, title: '모든 팀에서 제거', desc: `${n}개 팀의 에이전트 설정에서 빠지고 이 도구를 더 쓸 수 없어요.` },
  ];
  return (
    <Dialog open={pkg !== null} onOpenChange={(v) => (v ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{pkg?.name} 게시를 중단할까요?</DialogTitle>
          <DialogDescription>마켓에서 내려가 새로 설치할 수 없어요. 지금 {n}개 팀에 설치돼 있어요.</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="기존 설치" className="flex flex-col gap-2">
          {options.map((o) => (
            <label
              key={String(o.value)}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3',
                removeInstalls === o.value && 'border-primary',
              )}
            >
              <input
                type="radio"
                name="suspend-installs"
                className="mt-1 accent-primary"
                checked={removeInstalls === o.value}
                onChange={() => setRemoveInstalls(o.value)}
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-[13.5px] font-medium">{o.title}</span>
                <span className="text-[13px] text-muted-foreground">{o.desc}</span>
              </span>
            </label>
          ))}
        </div>
        {error && <FormAlert message={error} />}
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={pending}>
            취소
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            게시 중단
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 팀별 설치 현황 (A8e)

function MatrixTab() {
  const installs = useAdminMcpInstalls({});
  if (installs.isPending)
    return (
      <div className="rounded-xl border">
        <ListSkeleton />
      </div>
    );
  if (installs.isError)
    return (
      <div className="rounded-xl border">
        <ErrorState title="설치 현황을 불러오지 못했어요" error={installs.error} onRetry={() => void installs.refetch()} />
      </div>
    );
  const m = buildInstallMatrix(installs.data);
  if (m.rows.length === 0)
    return (
      <div className="rounded-xl border">
        <EmptyState icon={Grid3x3} title="아직 설치된 MCP가 없어요" description="팀이 마켓에서 설치하면 팀 × MCP 표로 보여요" />
      </div>
    );
  const latest = Object.fromEntries(m.packages.map((p) => [p, latestInColumn(m, p)]));
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-background">팀</TableHead>
              {m.packages.map((p) => (
                <TableHead key={p} className="font-mono text-xs whitespace-nowrap">
                  {p}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {m.rows.map((r) => (
              <TableRow key={r.team}>
                <TableCell className="sticky left-0 bg-background">
                  <Link to="/admin/teams/$team" params={{ team: r.team }} className="font-mono text-[13px] hover:underline">
                    {r.team}
                  </Link>
                </TableCell>
                {m.packages.map((p) => {
                  const c = r.cells[p];
                  if (!c) return <TableCell key={p} className="text-muted-foreground">—</TableCell>;
                  const s = INSTALL_STATUS[c.status];
                  const old = !!latest[p] && c.version !== latest[p];
                  return (
                    <TableCell key={p}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className={cn('inline-flex items-center gap-1.5 font-mono text-xs tabular-nums', old && 'text-muted-foreground')}>
                            <Dot dot={s.dot} blink={s.blink} />
                            {c.version ?? '—'}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {s.label}
                          {old ? ` · 최신 ${latest[p]}` : ''}
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <span className="text-xs text-muted-foreground">칸에는 설치된 버전이 보여요. 흐린 버전은 최신이 아니에요. 직접 추가된 MCP는 다음 탭에 있어요.</span>
    </div>
  );
}

// ── 직접 추가된 MCP

function ManualTab({ query }: { query: ReturnType<typeof useAdminMcpInstalls> }) {
  const refresh = useRefreshAdminMcp();
  const [removing, setRemoving] = useState<AdminMcpInstall | null>(null);
  const [pending, setPending] = useState(false);
  const remove = async () => {
    if (!removing) return;
    setPending(true);
    try {
      await mcpApi.remove(removing.team, removing.id);
      toast.success(`${removing.team}의 ${removing.name}을(를) 제거하고 있어요`);
      setRemoving(null);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  };
  const items = query.data ?? [];
  return (
    <div className="overflow-hidden rounded-xl border">
      {query.isPending ? (
        <ListSkeleton />
      ) : query.isError ? (
        <ErrorState title="직접 추가된 MCP를 불러오지 못했어요" error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={ShieldAlert} title="직접 추가된 MCP가 없어요" description="팀 관리자가 마켓을 거치지 않고 연결한 MCP가 여기에 보여요" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>팀</TableHead>
              <TableHead>이름</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>추가한 사람</TableHead>
              <TableHead>추가 시각</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.id}>
                <TableCell>
                  <Link to="/admin/teams/$team" params={{ team: i.team }} className="font-mono text-[13px] hover:underline">
                    {i.team}
                  </Link>
                </TableCell>
                <TableCell className="font-medium">{i.name}</TableCell>
                <TableCell className="max-w-[280px] truncate font-mono text-xs text-muted-foreground" title={i.manualUrl ?? undefined}>
                  {i.manualUrl ?? '—'}
                </TableCell>
                <TableCell>
                  <InstallStatusBadge status={i.status} />
                </TableCell>
                <TableCell className="text-[13px]">{i.installedBy ? <Requester user={i.installedBy} /> : '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground tabular-nums">{i.installedAt ? formatTime(i.installedAt) : '—'}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" disabled={i.status === 'removing'} onClick={() => setRemoving(i)}>
                    강제 제거
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={`${removing?.team ?? ''}의 ${removing?.name ?? ''}을(를) 강제로 제거할까요?`}
        description="그 팀 에이전트가 이 MCP를 더 쓸 수 없어요. 팀 관리자에게 알려 주세요."
        confirmLabel="강제 제거"
        destructive
        pending={pending}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
