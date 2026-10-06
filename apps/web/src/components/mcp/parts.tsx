import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Eye, EyeOff, Globe, KeyRound, Loader2, Server, Wrench } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Dot } from '@/components/apps/badges';
import { CopyField } from '@/components/admin/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorMessage } from '@/lib/api';
import { mcpApi, mcpKeys } from '@/lib/mcp/api';
import { networkKind, severityDot, sortFindings } from '@/lib/mcp/status';
import type { Finding, McpLogStage, McpManifest, McpTool } from '@/lib/mcp/types';
import { currentHost } from '@/lib/host';
import { cn } from '@/lib/utils';

// Pieces shared by U-10, U-12 and A-07.

/** Small labelled block inside a detail card. */
export function Section({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="flex-1">{title}</span>
        {aside}
      </span>
      {children}
    </div>
  );
}

/** Argument names from a JSON schema: `name`, optional ones as `name?`. */
export function toolArgs(tool: McpTool): string[] {
  const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: unknown } | undefined;
  const props = schema?.properties ? Object.keys(schema.properties) : [];
  const required = Array.isArray(schema?.required) ? (schema.required as unknown[]) : [];
  return props.map((p) => (required.includes(p) ? p : `${p}?`));
}

/** Tools extracted by the build test (`tools/list`). */
export function ToolList({ tools, empty = '추출한 도구가 없어요' }: { tools: McpTool[]; empty?: string }) {
  if (tools.length === 0) return <span className="text-[13px] text-muted-foreground">{empty}</span>;
  return (
    <ul className="overflow-hidden rounded-lg border">
      {tools.map((t) => {
        const args = toolArgs(t);
        return (
          <li key={t.name} className="flex flex-col gap-0.5 border-b px-3.5 py-2.5 last:border-b-0">
            <span className="flex items-center gap-2">
              <Wrench className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              <span className="font-mono text-[13px] font-medium">{t.name}</span>
              {args.length > 0 && <span className="truncate font-mono text-xs text-muted-foreground">({args.join(', ')})</span>}
            </span>
            {t.description && <span className="pl-5.5 text-[13px] text-muted-foreground">{t.description}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Declared permissions: secrets (team scope), network targets (사내/외부), resources. */
export function PermissionList({ manifest, highlight }: { manifest: McpManifest | null; highlight?: { secrets?: string[]; network?: string[] } }) {
  if (!manifest) return <span className="text-[13px] text-muted-foreground">매니페스트를 읽지 못했어요</span>;
  const base = currentHost.base;
  const isNewSecret = (n: string) => highlight?.secrets?.includes(n) ?? false;
  const isNewNet = (n: string) => highlight?.network?.includes(n) ?? false;
  return (
    <div className="flex flex-col divide-y rounded-lg border text-[13px]">
      <Row icon={KeyRound} label="비밀값">
        {manifest.secrets.length === 0 ? (
          <span className="text-muted-foreground">없음</span>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {manifest.secrets.map((s) => (
              <li key={s.name} className="flex flex-wrap items-center gap-1.5">
                <span className={cn('font-mono text-xs', isNewSecret(s.name) && 'rounded bg-muted px-1 font-semibold')}>{s.name}</span>
                <Badge variant="secondary" className="h-[18px] px-1.5 text-[11px]">
                  팀
                </Badge>
                {s.required === false && <span className="text-xs text-muted-foreground">선택</span>}
                {isNewSecret(s.name) && <NewMark />}
                {s.description && <span className="w-full text-xs text-muted-foreground">{s.description}</span>}
              </li>
            ))}
          </ul>
        )}
      </Row>
      <Row icon={Globe} label="접속하는 곳">
        {manifest.network.length === 0 ? (
          <span className="text-muted-foreground">인터넷에 접속하지 않아요</span>
        ) : (
          <ul className="flex flex-col gap-1">
            {manifest.network.map((d) => (
              <li key={d} className="flex items-center gap-1.5">
                <span className={cn('font-mono text-xs', isNewNet(d) && 'rounded bg-muted px-1 font-semibold')}>{d}</span>
                <Badge variant="outline" className="h-[18px] px-1.5 text-[11px]">
                  {networkKind(d, base) === 'internal' ? '사내' : '외부'}
                </Badge>
                {isNewNet(d) && <NewMark />}
              </li>
            ))}
          </ul>
        )}
      </Row>
      <Row icon={Server} label="리소스">
        <span className="tabular-nums">
          CPU {manifest.resources.cpu} · 메모리 {manifest.resources.memoryMb} MB
        </span>
      </Row>
    </div>
  );
}

function NewMark() {
  return (
    <Badge variant="outline" className="h-[18px] px-1.5 text-[11px]">
      <Dot dot="warning" />
      새로 생김
    </Badge>
  );
}

function Row({ icon: Icon, label, children }: { icon: typeof Globe; label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 px-3.5 py-2.5">
      <span className="flex items-center gap-1.5 self-start text-muted-foreground">
        <Icon className="size-3.5" strokeWidth={1.75} />
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const LOG_LABEL: Record<McpLogStage, string> = { build: '빌드 로그', scan: '보안 스캔 로그', test: '테스트 로그' };

/** Collapsible stage log; fetched only when opened. `live` refreshes it every 3 s while the stage runs. */
export function LogPanel({
  pkg,
  ver,
  stage,
  live = false,
  defaultOpen = false,
}: {
  pkg: string;
  ver: string;
  stage: McpLogStage;
  live?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const log = useQuery({
    queryKey: mcpKeys.logs(pkg, ver, stage),
    queryFn: () => mcpApi.logs(pkg, ver, stage),
    enabled: open,
    refetchInterval: open && live ? 3_000 : false,
  });
  return (
    <div className="overflow-hidden rounded-lg border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center gap-2 px-3 text-left text-[13px] outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <span className="flex-1">{LOG_LABEL[stage]}</span>
        {live && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t bg-muted">
          {log.isPending ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">불러오는 중이에요</div>
          ) : log.isError ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">{errorMessage(log.error)}</div>
          ) : (
            <pre className="max-h-80 overflow-auto px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {log.data.text || '아직 기록이 없어요'}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/** Scan findings, Critical/High first with a danger dot. */
export function FindingsTable({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return <span className="text-[13px] text-muted-foreground">발견된 문제가 없어요</span>;
  return (
    <div className="max-h-80 overflow-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">심각도</TableHead>
            <TableHead>패키지</TableHead>
            <TableHead>ID</TableHead>
            <TableHead>내용</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortFindings(findings).map((f, i) => {
            const strong = severityDot(f.severity) === 'danger';
            return (
              <TableRow key={`${f.id}-${f.pkg}-${i}`}>
                <TableCell>
                  <Badge variant="outline" className={cn(strong && 'font-semibold')}>
                    <Dot dot={severityDot(f.severity)} />
                    {f.severity.charAt(0).toUpperCase() + f.severity.slice(1).toLowerCase()}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{f.pkg}</TableCell>
                <TableCell className="font-mono text-xs whitespace-nowrap">{f.id}</TableCell>
                <TableCell className="max-w-[360px] truncate text-[13px]" title={f.title}>
                  {f.title}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** SecretInput (02 §5): password input + show toggle. */
export function SecretInput({
  id,
  value,
  onChange,
  placeholder,
  invalid,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={shown ? 'text' : 'password'}
        autoComplete="new-password"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        className="pr-9 font-mono"
      />
      <button
        type="button"
        aria-label={shown ? '가리기' : '보기'}
        onClick={() => setShown((s) => !s)}
        className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground"
      >
        {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  );
}

/** Where this platform serves the scaffolding tool (apps/web nginx /tools/, built with the web image). */
export const toolUrl = (origin: string) => `${origin}/tools/create-platform-mcp.tgz`;

/** "만드는 방법" (U-12): create-platform-mcp usage. */
export function HowToDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const tool = toolUrl(window.location.origin);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>MCP 만드는 방법</DialogTitle>
          <DialogDescription>스캐폴딩으로 만들고, 검증하고, zip으로 묶어 여기에 올려요.</DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-4 text-[13px]">
          <li className="flex flex-col gap-1.5">
            <span className="font-medium">1. 새 프로젝트 만들기</span>
            <span className="text-xs text-muted-foreground">Node.js 22와 npm만 있으면 돼요. 도구는 이 플랫폼에서 바로 받아요(npm 계정 필요 없음).</span>
            <CopyField value={`npx ${tool} create my-mcp`} />
            <CopyField value="cd my-mcp && npm install && npm run dev" />
            <span className="text-xs text-muted-foreground">
              도구는 <span className="font-mono">src/tools/</span>에 파일 하나씩 추가해요. <span className="font-mono">src/platform/</span>은 고치지 않아요.
              비밀값은 <span className="font-mono">getSecret()</span>으로만 읽어요(서버 하나를 여러 팀이 같이 써요).
            </span>
          </li>
          <li className="flex flex-col gap-1.5">
            <span className="font-medium">2. 매니페스트 확인</span>
            <span className="text-muted-foreground">
              <span className="font-mono">platform-plugin.yaml</span>에 이름·버전·비밀값·접속하는 곳(도메인)을 적어요. 비밀값은 팀 범위만 쓸 수 있어요.
            </span>
            <CopyField value="npx create-platform-mcp validate" />
          </li>
          <li className="flex flex-col gap-1.5">
            <span className="font-medium">3. zip 만들기</span>
            <CopyField value="npx create-platform-mcp pack" />
            <span className="text-xs text-muted-foreground">만든 zip(50MB 이하)을 이 화면에 끌어다 놓으면 검증 → 빌드 → 보안 스캔 → 테스트 후 심사를 기다려요.</span>
          </li>
        </ol>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
