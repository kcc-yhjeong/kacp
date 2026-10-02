import { Link, useNavigate } from '@tanstack/react-router';
import { Copy, MoreHorizontal, Plus, Sparkles } from 'lucide-react';
import { EmptyState, ListState, PageContainer, PageHeader } from '@/components/admin/page';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAdminSettings, useTemplates } from '@/lib/admin/api';
import { formatTime } from '@/lib/format';

/** A-06 agent templates. */
export function AgentsPage() {
  const navigate = useNavigate();
  const templates = useTemplates();
  const settings = useAdminSettings();
  const items = templates.data ?? [];
  const modelLabel = (id: string | undefined) => settings.data?.models.allowed.find((m) => m.id === id)?.label;

  return (
    <PageContainer>
      <PageHeader
        title="에이전트 템플릿"
        description="팀에 할당할 에이전트의 모델·지시문·도구를 정해요."
        actions={
          <Button asChild>
            <Link to="/admin/agents/new" search={{}}>
              <Plus strokeWidth={1.75} />새 템플릿
            </Link>
          </Button>
        }
      />
      <div className="overflow-hidden rounded-xl border">
        <ListState
          isPending={templates.isPending}
          error={templates.error}
          isEmpty={items.length === 0}
          errorTitle="템플릿 목록을 불러오지 못했어요"
          onRetry={() => void templates.refetch()}
          empty={
            <EmptyState
              icon={Sparkles}
              title="아직 템플릿이 없어요"
              description="첫 템플릿을 만들어 팀에 할당해 보세요"
              action={
                <Button size="sm" asChild>
                  <Link to="/admin/agents/new" search={{}}>
                    새 템플릿
                  </Link>
                </Button>
              }
            />
          }
        />
        {items.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>설명</TableHead>
                <TableHead>기본 모델</TableHead>
                <TableHead>할당 팀</TableHead>
                <TableHead>수정</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((t) => (
                <TableRow
                  key={t.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => void navigate({ to: '/admin/agents/$templateId', params: { templateId: t.id } })}
                >
                  <TableCell>
                    <span className="flex items-center gap-2.5">
                      <span className="grid size-8 place-items-center rounded-md border text-base">{t.icon || '🤖'}</span>
                      <span className="font-medium">{t.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">v{t.version}</span>
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[320px] truncate text-muted-foreground">{t.description || '—'}</TableCell>
                  <TableCell>
                    <span className="flex flex-col">
                      <span className="text-[13px]">{modelLabel(t.spec.model?.id) ?? t.spec.model?.id ?? '—'}</span>
                      {modelLabel(t.spec.model?.id) && <span className="font-mono text-[11px] text-muted-foreground">{t.spec.model?.id}</span>}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums">{t.assignedTeams.length}팀</TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">{formatTime(t.updatedAt)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger aria-label="더 보기" className="grid size-8 place-items-center rounded-md outline-none hover:bg-accent">
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => void navigate({ to: '/admin/agents/new', search: { from: t.id } })}>
                          <Copy strokeWidth={1.75} />
                          복제
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </PageContainer>
  );
}
