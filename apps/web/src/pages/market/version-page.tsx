import { Link } from '@tanstack/react-router';
import { ChevronRight, FileText, ScanSearch, ShieldCheck, TriangleAlert, Wrench } from 'lucide-react';
import { ErrorState, PageContainer, SectionCard } from '@/components/admin/page';
import { ScanCounts, VersionStatusBadge } from '@/components/mcp/badges';
import { FindingsTable, LogPanel, PermissionList, Section, ToolList } from '@/components/mcp/parts';
import { PageLoader } from '@/components/page-loader';
import { Stepper } from '@/components/stepper';
import { ApiError } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { useMcpVersion } from '@/lib/mcp/api';
import { activeLogStage, stopTitle, versionSteps } from '@/lib/mcp/status';
import type { McpLogStage, McpVersionDetail } from '@/lib/mcp/types';
import { MarketLayout } from './market-layout';

/** U-12 버전 상세 — `/market/mine/{pkg}/{ver}`. */
export function VersionPage({ pkg, ver }: { pkg: string; ver: string }) {
  return <MarketLayout tab={null}>{() => <VersionDetail pkg={pkg} ver={ver} />}</MarketLayout>;
}

function VersionDetail({ pkg, ver }: { pkg: string; ver: string }) {
  const q = useMcpVersion(pkg, ver);
  const crumbs = (
    <nav className="flex items-center gap-1 text-[13px] text-muted-foreground">
      <Link to="/market/mine" search={{}} className="hover:text-foreground">
        내 배포
      </Link>
      <ChevronRight className="size-3.5" />
      <span className="font-mono">{pkg}</span>
      <ChevronRight className="size-3.5" />
      <span className="font-mono text-foreground">{ver}</span>
    </nav>
  );
  if (q.isPending) return <PageLoader />;
  if (q.isError) {
    const nf = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403);
    return (
      <PageContainer>
        {crumbs}
        <ErrorState title={nf ? '볼 수 없는 버전이에요' : '버전을 불러오지 못했어요'} error={nf ? undefined : q.error} onRetry={nf ? undefined : () => void q.refetch()} />
      </PageContainer>
    );
  }
  return (
    <PageContainer>
      {crumbs}
      <VersionBody v={q.data} />
    </PageContainer>
  );
}

export function VersionBody({ v }: { v: McpVersionDetail }) {
  const stop = stopTitle(v);
  const live = activeLogStage(v.status);
  const failedLog: McpLogStage | null = v.status === 'failed' && v.failedStage && v.failedStage !== 'validate' ? v.failedStage : null;
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <span className="font-mono">{v.packageName}</span>
            <span className="font-mono text-muted-foreground">{v.version}</span>
            <VersionStatusBadge status={v.status} />
          </h1>
          <span className="text-[13px] text-muted-foreground">
            {v.manifest?.displayName ?? v.packageName} · {formatTime(v.uploadedAt)} 올림
          </span>
        </div>
      </div>

      <section className="rounded-xl border px-5 py-6">
        <Stepper steps={versionSteps(v.status, v.failedStage)} />
      </section>

      {stop && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border px-4 py-3 text-[13px]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" strokeWidth={1.75} />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-medium">{stop}</span>
            {v.status === 'rejected' ? (
              <>
                <span className="whitespace-pre-wrap">반려 사유 {v.reviewNote ?? '—'}</span>
                <span className="text-xs text-muted-foreground">
                  처리 플랫폼 관리자{v.reviewedAt ? ` · ${formatTime(v.reviewedAt)}` : ''} · 설치한 팀은 이전 버전을 계속 써요.
                </span>
              </>
            ) : (
              <span className="whitespace-pre-wrap text-muted-foreground">
                {v.statusDetail ?? (v.failedStage === 'scan' ? '보안 스캔에서 심각한 문제가 나왔어요. 의존성 버전을 올리고 다시 올려 주세요.' : '아래 로그에서 원인을 확인하고 고친 뒤 새 버전으로 다시 올려 주세요.')}
              </span>
            )}
          </div>
        </div>
      )}
      {v.status === 'in_review' && (
        <div role="status" className="rounded-xl border px-4 py-3 text-[13px] text-muted-foreground">
          검사를 모두 통과했어요. 플랫폼 관리자가 심사하면 마켓에 게시돼요.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard icon={FileText} title="단계별 로그" bodyClassName="flex flex-col gap-2 p-5">
            {(['build', 'scan', 'test'] as const).map((s) => (
              <LogPanel key={s} pkg={v.packageName} ver={v.version} stage={s} live={live === s} defaultOpen={failedLog === s || live === s} />
            ))}
          </SectionCard>
          <SectionCard icon={ScanSearch} title="보안 스캔" actions={<ScanCounts summary={v.scanSummary} />} bodyClassName="p-5">
            {v.scanSummary ? <FindingsTable findings={v.findings} /> : <span className="text-[13px] text-muted-foreground">아직 스캔하지 않았어요</span>}
          </SectionCard>
          <SectionCard icon={Wrench} title={`도구 · ${v.tools.length}개`} bodyClassName="p-5">
            <ToolList tools={v.tools} empty="테스트를 통과하면 도구 목록이 보여요" />
          </SectionCard>
        </div>
        <SectionCard icon={ShieldCheck} title="매니페스트" bodyClassName="flex flex-col gap-3 p-4">
          {v.manifest && (
            <Section title="설명">
              <span className="text-[13px]">{v.manifest.summary}</span>
            </Section>
          )}
          <PermissionList manifest={v.manifest} />
        </SectionCard>
      </div>
    </>
  );
}
