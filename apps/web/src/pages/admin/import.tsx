import { useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { Check, ChevronRight, Download, FileText, FileUp, Loader2, TriangleAlert } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { toast } from 'sonner';
import { ImportActionBadge } from '@/components/admin/badges';
import { PageContainer, PageHeader } from '@/components/admin/page';
import { Stepper, type Step } from '@/components/stepper';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { adminApi, adminKeys } from '@/lib/admin/api';
import { buildImportTemplate, downloadText, IMPORT_COLUMNS, IMPORT_TEMPLATE_FILE, withBom } from '@/lib/admin/csv';
import { formatNumber } from '@/lib/admin/format';
import type { ImportApplyResult, ImportJob, ImportKind, ImportRow } from '@/lib/admin/types';
import { ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

const route = getRouteApi('/admin/import');

type Phase = 'select' | 'previewing' | 'preview' | 'applying' | 'result';

const KIND_LABEL: Record<ImportKind, string> = { departments: '부서', users: '사용자' };
const MAX_ROWS_SHOWN = 500;

/** A-13 CSV import. */
export function ImportPage() {
  const { kind = 'departments' } = route.useSearch();
  const navigate = useNavigate();
  return (
    <PageContainer>
      <PageHeader
        breadcrumb={
          <>
            {kind === 'users' ? (
              <Link to="/admin/users" className="hover:text-foreground">
                사용자
              </Link>
            ) : (
              <Link to="/admin/org" className="hover:text-foreground">
                조직
              </Link>
            )}
            <ChevronRight className="size-3.5" />
            <span className="text-foreground">가져오기(CSV)</span>
          </>
        }
        title="가져오기(CSV)"
        description="미리보기로 확인한 뒤 적용해요. 적용 전에는 아무것도 바뀌지 않아요."
      />
      <Tabs value={kind} onValueChange={(v) => void navigate({ to: '/admin/import', search: { kind: v as ImportKind } })}>
        <TabsList>
          <TabsTrigger value="departments">부서</TabsTrigger>
          <TabsTrigger value="users">사용자</TabsTrigger>
        </TabsList>
      </Tabs>
      <ImportFlow key={kind} kind={kind} />
    </PageContainer>
  );
}

function ImportFlow({ kind }: { kind: ImportKind }) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>('select');
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [result, setResult] = useState<ImportApplyResult | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  const preview = async (f: File) => {
    setFile(f);
    setPhase('previewing');
    try {
      const j = await adminApi.importPreview(kind, f);
      setJob(j);
      setPhase('preview');
    } catch (err) {
      toast.error(errorMessage(err));
      setPhase(job ? 'preview' : 'select');
    }
  };

  const apply = async () => {
    if (!job) return;
    setPhase('applying');
    try {
      const r = await adminApi.importApply(kind, job.id, job.summary.errors > 0);
      setResult(r);
      setPhase('result');
      void queryClient.invalidateQueries({ queryKey: adminKeys.departmentsAll });
      void queryClient.invalidateQueries({ queryKey: adminKeys.usersAll });
      void queryClient.invalidateQueries({ queryKey: adminKeys.deptMembersAll });
    } catch (err) {
      toast.error(errorMessage(err));
      // 409: data changed since the preview → preview the same file again.
      if (err instanceof ApiError && err.status === 409 && file) void preview(file);
      else setPhase('preview');
    }
  };

  const restart = () => {
    setPhase('select');
    setFile(null);
    setJob(null);
    setResult(null);
    setDownloaded(false);
  };

  const idx = { select: 0, previewing: 0, preview: 1, applying: 2, result: 3 }[phase];
  const steps: Step[] = ['파일 선택', '미리보기', '적용', '결과'].map((label, i) => ({
    label,
    state: i < idx || phase === 'result' ? 'done' : i === idx ? 'current' : 'todo',
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border px-6 py-4">
        <Stepper steps={steps} />
      </div>
      {(phase === 'select' || phase === 'previewing') && (
        <FileDrop kind={kind} busy={phase === 'previewing'} fileName={file?.name} onFile={(f) => void preview(f)} />
      )}
      {(phase === 'preview' || phase === 'applying') && job && (
        <Preview kind={kind} job={job} applying={phase === 'applying'} onApply={() => void apply()} onCancel={restart} />
      )}
      {phase === 'result' && result && (
        <Result kind={kind} result={result} downloaded={downloaded} onDownloaded={() => setDownloaded(true)} onAgain={restart} />
      )}
    </div>
  );
}

function FileDrop({ kind, busy, fileName, onFile }: { kind: ImportKind; busy: boolean; fileName?: string; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) {
      toast.error('CSV 파일만 올릴 수 있어요.');
      return;
    }
    onFile(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    pick(e.dataTransfer.files[0]);
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn('flex flex-col items-center gap-3 rounded-xl border-[1.5px] border-dashed px-6 py-14 text-center', over && 'border-primary bg-muted/40')}
    >
      <span className="grid size-14 place-items-center rounded-full bg-muted">
        {busy ? <Loader2 className="size-7 animate-spin text-muted-foreground" /> : <FileUp className="size-7 text-muted-foreground" strokeWidth={1.75} />}
      </span>
      <div className="flex flex-col gap-1">
        <span className="text-[15px] font-semibold">{busy ? `${fileName ?? ''} 확인하는 중이에요` : 'CSV 파일을 끌어다 놓으세요'}</span>
        <span className="text-[13px] text-muted-foreground">
          머리 줄: <span className="font-mono text-xs">{IMPORT_COLUMNS[kind].join(', ')}</span> · UTF-8
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
          파일 선택
        </Button>
        <Button variant="ghost" onClick={() => downloadText(IMPORT_TEMPLATE_FILE[kind], buildImportTemplate(kind))}>
          <Download strokeWidth={1.75} />
          양식 내려받기
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <span className="text-xs text-muted-foreground">
        {kind === 'departments' ? '부서는 code' : '사용자는 email'} 기준으로 있으면 변경, 없으면 추가해요. CSV에 없는 기존 데이터는 건드리지 않아요.
      </span>
    </div>
  );
}

function SummaryCards({ items }: { items: { label: string; n: number; dot?: string }[] }) {
  return (
    <div className="grid grid-cols-2 rounded-xl border md:grid-cols-4 [&>*:not(:last-child)]:md:border-r">
      {items.map((k) => (
        <div key={k.label} className="flex flex-col gap-1.5 p-5">
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {k.dot && <span className={cn('size-1.5 rounded-full', k.dot)} />}
            {k.label}
          </span>
          <span className="text-2xl font-semibold tabular-nums">{formatNumber(k.n)}</span>
        </div>
      ))}
    </div>
  );
}

function Preview({
  kind,
  job,
  applying,
  onApply,
  onCancel,
}: {
  kind: ImportKind;
  job: ImportJob;
  applying: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  const s = job.summary;
  const total = s.added + s.updated + s.unchanged + s.errors;
  const applicable = total - s.errors;
  const rows = job.rows.slice(0, MAX_ROWS_SHOWN);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-[13.5px]">
        <FileText className="size-4 text-muted-foreground" strokeWidth={1.75} />
        <span className="font-medium">{job.fileName}</span>
        <span className="text-muted-foreground">· {formatNumber(total)}행</span>
      </div>
      <SummaryCards
        items={[
          { label: '새로 추가', n: s.added, dot: 'bg-success' },
          { label: '변경', n: s.updated, dot: 'bg-warning' },
          { label: '변경 없음', n: s.unchanged, dot: 'bg-muted-foreground' },
          { label: '오류', n: s.errors, dot: 'bg-danger' },
        ]}
      />
      <div className="overflow-hidden rounded-xl border">
        <ImportPreviewTable kind={kind} rows={rows} />
        {job.rows.length > MAX_ROWS_SHOWN && (
          <div className="border-t px-5 py-2.5 text-xs text-muted-foreground">
            앞 {MAX_ROWS_SHOWN}행만 보여요. 적용은 전체 {formatNumber(job.rows.length)}행에 해요.
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-3">
        <span className="text-[13px] text-muted-foreground">
          {s.errors > 0
            ? `${formatNumber(total)}행 중 오류 ${formatNumber(s.errors)}행은 빼고 ${formatNumber(applicable)}행을 적용해요`
            : `${formatNumber(total)}행을 적용해요`}
        </span>
        <Button variant="outline" onClick={onCancel} disabled={applying}>
          취소
        </Button>
        <Button onClick={onApply} disabled={applying || applicable === 0}>
          {applying && <Loader2 className="animate-spin" />}
          {applying ? '적용 중' : s.errors > 0 ? '오류 행 빼고 적용' : '적용'}
        </Button>
      </div>
    </div>
  );
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : String(v);
}

/** ImportPreviewTable (02 §5): action badge, changed cells `bg-muted` with the old value struck through, error reason. */
function ImportPreviewTable({ kind, rows }: { kind: ImportKind; rows: ImportRow[] }) {
  const keyCol = IMPORT_COLUMNS[kind][0] ?? 'key';
  const cols = IMPORT_COLUMNS[kind].slice(1);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-14">행</TableHead>
          <TableHead>동작</TableHead>
          <TableHead className="font-mono">{keyCol}</TableHead>
          {cols.map((c) => (
            <TableHead key={c} className="font-mono">
              {c}
            </TableHead>
          ))}
          <TableHead>사유</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.line}>
            <TableCell className="text-xs text-muted-foreground tabular-nums">{r.line}</TableCell>
            <TableCell>
              <ImportActionBadge action={r.action} />
            </TableCell>
            <TableCell className="font-mono text-xs">{r.key}</TableCell>
            {cols.map((c) => {
              const ch = r.changes?.[c];
              if (!ch) return <TableCell key={c} />;
              const [before, after] = ch;
              const changed = r.action === 'update' && cellText(before) !== '';
              return (
                <TableCell key={c} className={cn('text-[13px]', changed && 'bg-muted')}>
                  {changed && <span className="mr-1.5 text-muted-foreground line-through">{cellText(before)}</span>}
                  {cellText(after)}
                </TableCell>
              );
            })}
            <TableCell className="text-[13px]">{r.error && <span className="text-danger">{r.error}</span>}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Result({
  kind,
  result,
  downloaded,
  onDownloaded,
  onAgain,
}: {
  kind: ImportKind;
  result: ImportApplyResult;
  downloaded: boolean;
  onDownloaded: () => void;
  onAgain: () => void;
}) {
  const s = result.summary;
  const csv = result.initialPasswordsCsv;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-[15px] font-semibold">
        <Check className="size-4 text-success" strokeWidth={2.25} />
        {KIND_LABEL[kind]} 가져오기를 적용했어요
      </div>
      <SummaryCards
        items={[
          { label: '추가', n: s.added },
          { label: '변경', n: s.updated },
          { label: '그대로', n: s.unchanged },
          { label: '건너뛴 오류 행', n: s.errors },
        ]}
      />
      {kind === 'users' && csv && (
        <div className="flex items-center gap-4 rounded-xl border p-5">
          <TriangleAlert className="size-5 shrink-0 text-warning" strokeWidth={1.75} />
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium">새 사용자 {formatNumber(s.added)}명의 초기 비밀번호</span>
            <span className="text-[13px] text-muted-foreground">이 화면을 닫으면 다시 받을 수 없어요. 안전한 경로로 전달한 뒤 파일을 지우세요.</span>
          </div>
          <Button
            onClick={() => {
              downloadText(`kacp-initial-passwords-${new Date().toISOString().slice(0, 10)}.csv`, withBom(csv));
              onDownloaded();
            }}
          >
            <Download strokeWidth={1.75} />
            {downloaded ? '다시 내려받기' : '초기 비밀번호 CSV 내려받기'}
          </Button>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onAgain}>
          다른 파일 가져오기
        </Button>
        <Button asChild>
          {kind === 'users' ? <Link to="/admin/users">사용자 목록으로</Link> : <Link to="/admin/org">조직으로</Link>}
        </Button>
      </div>
    </div>
  );
}
