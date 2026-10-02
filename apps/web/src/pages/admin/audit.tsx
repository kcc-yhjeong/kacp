import { ChevronDown, ChevronRight, History, X } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { EmptyState, ListState, PageContainer, PageHeader } from '@/components/admin/page';
import { UserChip, UserPicker } from '@/components/admin/user-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAdminTeams, useAuditEvents, type AuditFilters } from '@/lib/admin/api';
import { dateInputToIso } from '@/lib/admin/format';
import { AUDIT_ACTION_LABEL, AUDIT_TARGET_LABEL, auditActionLabel, auditTargetLabel } from '@/lib/admin/labels';
import type { AuditEvent, UserRef } from '@/lib/admin/types';
import { formatTime } from '@/lib/format';

function todayMinus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A-11 audit log. */
export function AuditPage() {
  const [from, setFrom] = useState(todayMinus(7));
  const [to, setTo] = useState('');
  const [actor, setActor] = useState<UserRef | null>(null);
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [team, setTeam] = useState('');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const teams = useAdminTeams();

  const filters: AuditFilters = useMemo(
    () => ({
      from: dateInputToIso(from),
      to: dateInputToIso(to, true),
      actor: actor?.id,
      action: action || undefined,
      targetType: targetType || undefined,
      team: team || undefined,
    }),
    [from, to, actor, action, targetType, team],
  );
  const events = useAuditEvents(filters);
  const items = events.data?.pages.flatMap((p) => p.items) ?? [];
  const teamName = (n: string | null) => (n ? (teams.data?.find((t) => t.name === n)?.displayName ?? n) : '—');
  const filtered = !!(to || actor || action || targetType || team) || from !== todayMinus(7);
  const reset = () => {
    setFrom(todayMinus(7));
    setTo('');
    setActor(null);
    setAction('');
    setTargetType('');
    setTeam('');
  };
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sel = '[&_select]:h-8 [&_select]:text-[13px]';
  return (
    <PageContainer>
      <PageHeader title="활동 기록" description="관리 작업과 중요한 변경이 모두 남아요." />
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-[13px]">
          <Input type="date" aria-label="시작일" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-[150px] text-[13px]" />
          <span className="text-muted-foreground">~</span>
          <Input type="date" aria-label="종료일" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-[150px] text-[13px]" />
        </span>
        {actor ? (
          <UserChip user={actor} onRemove={() => setActor(null)} />
        ) : (
          <UserPicker
            onPick={setActor}
            trigger={
              <Button variant="outline" size="sm" className="border-dashed">
                행위자
              </Button>
            }
          />
        )}
        <NativeSelect aria-label="행위" value={action} onChange={(e) => setAction(e.target.value)} className={sel}>
          <option value="">행위 전체</option>
          {Object.entries(AUDIT_ACTION_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v} ({k})
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="대상 종류" value={targetType} onChange={(e) => setTargetType(e.target.value)} className={sel}>
          <option value="">대상 전체</option>
          {Object.entries(AUDIT_TARGET_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="팀" value={team} onChange={(e) => setTeam(e.target.value)} className={sel}>
          <option value="">팀 전체</option>
          {(teams.data ?? []).map((t) => (
            <option key={t.name} value={t.name}>
              {t.displayName}
            </option>
          ))}
        </NativeSelect>
        {filtered && (
          <Button variant="ghost" size="sm" onClick={reset}>
            <X strokeWidth={1.75} />
            필터 초기화
          </Button>
        )}
      </div>
      <div className="overflow-hidden rounded-xl border">
        <ListState
          isPending={events.isPending}
          error={events.error}
          isEmpty={items.length === 0}
          errorTitle="활동 기록을 불러오지 못했어요"
          onRetry={() => void events.refetch()}
          empty={
            <EmptyState
              icon={History}
              title="이 기간에 기록이 없어요"
              description="기간을 늘리거나 필터를 풀어 보세요"
              action={
                filtered ? (
                  <Button variant="outline" size="sm" onClick={reset}>
                    필터 초기화
                  </Button>
                ) : undefined
              }
            />
          }
        />
        {items.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>시각</TableHead>
                <TableHead>행위자</TableHead>
                <TableHead>행위</TableHead>
                <TableHead>대상</TableHead>
                <TableHead>팀</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((e) => {
                const isOpen = open.has(e.id);
                const hasDetail = !!e.detail && Object.keys(e.detail).length > 0;
                return (
                  <Fragment key={e.id}>
                    <TableRow className={hasDetail ? 'cursor-pointer hover:bg-muted/50' : ''} onClick={() => hasDetail && toggle(e.id)}>
                      <TableCell>
                        {hasDetail &&
                          (isOpen ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />)}
                      </TableCell>
                      <TableCell className="text-[13px] whitespace-nowrap tabular-nums">{formatTime(e.at)}</TableCell>
                      <TableCell>{e.actor ? e.actor.name : <span className="text-muted-foreground">시스템</span>}</TableCell>
                      <TableCell className="font-medium">{auditActionLabel(e.action)}</TableCell>
                      <TableCell className="max-w-[320px] truncate">
                        <span className="text-muted-foreground">{auditTargetLabel(e.targetType)} · </span>
                        {e.targetLabel || e.targetId}
                      </TableCell>
                      <TableCell>{teamName(e.team)}</TableCell>
                    </TableRow>
                    {isOpen && e.detail && (
                      <TableRow className="bg-sidebar hover:bg-sidebar">
                        <TableCell />
                        <TableCell colSpan={5} className="py-3">
                          <DetailView event={e} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
      {events.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>
            더 보기
          </Button>
        </div>
      )}
    </PageContainer>
  );
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/** Before/after summary when the detail has them, otherwise key: value lines. */
function DetailView({ event }: { event: AuditEvent }) {
  const d = event.detail ?? {};
  const before = d.before as Record<string, unknown> | undefined;
  const after = d.after as Record<string, unknown> | undefined;
  const rest = Object.entries(d).filter(([k]) => k !== 'before' && k !== 'after');

  return (
    <div className="flex flex-col gap-2 text-[13px]">
      {(before || after) && (
        <div className="grid max-w-3xl grid-cols-[140px_1fr_1fr] gap-x-4 gap-y-1">
          <span />
          <span className="text-xs text-muted-foreground">변경 전</span>
          <span className="text-xs text-muted-foreground">변경 후</span>
          {[...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].map((k) => (
            <Fragment key={k}>
              <span className="font-mono text-xs text-muted-foreground">{k}</span>
              <span className="truncate text-muted-foreground line-through decoration-muted-foreground/60">{show(before?.[k])}</span>
              <span className="truncate">{show(after?.[k])}</span>
            </Fragment>
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <div className="grid max-w-3xl grid-cols-[140px_1fr] gap-x-4 gap-y-1">
          {rest.map(([k, v]) => (
            <Fragment key={k}>
              <span className="font-mono text-xs text-muted-foreground">{k}</span>
              <span className="font-mono text-xs break-all">{show(v)}</span>
            </Fragment>
          ))}
        </div>
      )}
      {event.ip && <span className="text-xs text-muted-foreground">IP {event.ip}</span>}
    </div>
  );
}
