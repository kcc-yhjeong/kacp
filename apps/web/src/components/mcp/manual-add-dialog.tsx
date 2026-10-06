import { Loader2, Plus, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormAlert } from '@/components/form-alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/api';
import { mcpApi } from '@/lib/mcp/api';
import { HEADER_NAME, headerObject, manualUrlProblem } from '@/lib/mcp/status';
import { useRefreshInstalls } from './installs-table';
import { SecretInput } from './parts';

/** U-15 "MCP 직접 추가": name + URL + headers (masked), with the "검토되지 않은 MCP예요" acknowledgement. */
export function ManualAddDialog({ team, open, onOpenChange }: { team: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">{open && <ManualForm team={team} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function ManualForm({ team, onClose }: { team: string; onClose: () => void }) {
  const refresh = useRefreshInstalls();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState<{ name: string; value: string }[]>([{ name: 'Authorization', value: '' }]);
  const [ack, setAck] = useState(false);
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameProblem = !name.trim() ? '이름을 입력하세요.' : name.trim().length > 60 ? '60자 이내로 입력하세요.' : null;
  const urlProblem = manualUrlProblem(url);
  const badHeader = headers.find((h) => h.name.trim() && !HEADER_NAME.test(h.name.trim()));
  const valid = !nameProblem && !urlProblem && !badHeader && ack;

  const submit = async () => {
    setTouched(true);
    if (!valid) return;
    setPending(true);
    setError(null);
    try {
      // Only rows with a value are sent: an empty Authorization row means "no header".
      const h = headerObject(headers.filter((r) => r.value.trim()));
      await mcpApi.addManual(team, { name: name.trim(), url: url.trim(), headers: h });
      toast.success(`${name.trim()}을(를) 추가했어요. 검토되지 않음으로 표시돼요`);
      refresh(team);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>MCP 직접 추가</DialogTitle>
        <DialogDescription>마켓에 없는 MCP 서버를 주소로 연결해요.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="manual-name" className="text-[13px]">
            이름
          </Label>
          <Input id="manual-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="figma-bridge" aria-invalid={(touched && !!nameProblem) || undefined} />
          {touched && nameProblem && <span className="text-xs text-danger">{nameProblem}</span>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="manual-url" className="text-[13px]">
            연결 주소
          </Label>
          <Input
            id="manual-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://mcp.example.internal/mcp"
            className="font-mono"
            aria-invalid={(touched && !!urlProblem) || undefined}
          />
          {touched && urlProblem && <span className="text-xs text-danger">{urlProblem}</span>}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">헤더 · 비밀값</span>
          {headers.map((h, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-2">
              <Input
                aria-label="헤더 이름"
                value={h.name}
                onChange={(e) => setHeaders((rows) => rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                placeholder="헤더 이름"
                className="font-mono"
              />
              <SecretInput value={h.value} onChange={(v) => setHeaders((rows) => rows.map((r, j) => (j === i ? { ...r, value: v } : r)))} placeholder="값" />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9"
                aria-label="헤더 빼기"
                onClick={() => setHeaders((rows) => rows.filter((_, j) => j !== i))}
              >
                <X />
              </Button>
            </div>
          ))}
          {touched && badHeader && <span className="text-xs text-danger">헤더 이름에는 영문·숫자·하이픈만 써요.</span>}
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setHeaders((rows) => [...rows, { name: '', value: '' }])}>
            <Plus />
            헤더 추가
          </Button>
          <span className="text-xs text-muted-foreground">값은 팀 Secret Store로 바로 가고 다시 보여주지 않아요.</span>
        </div>
        <div className="flex flex-col gap-2.5 rounded-lg border px-3.5 py-3">
          <span className="flex items-start gap-2 text-[13px]">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" strokeWidth={1.75} />
            검토되지 않은 MCP예요. 보안 스캔과 심사를 거치지 않아 팀 데이터가 밖으로 나갈 수 있어요.
          </span>
          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <Checkbox checked={ack} onCheckedChange={(c) => setAck(c === true)} />
            위험을 이해했고 팀 관리자로서 추가해요
          </label>
        </div>
      </div>
      {error && <FormAlert message={error} />}
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pending}>
          취소
        </Button>
        <Button onClick={() => void submit()} disabled={!ack || pending}>
          {pending && <Loader2 className="animate-spin" />}
          추가
        </Button>
      </DialogFooter>
    </>
  );
}
