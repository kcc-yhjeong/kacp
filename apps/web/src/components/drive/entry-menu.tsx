import { Copy, Download, Eye, FolderInput, FolderOpen, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { DriveEntry } from '@/lib/drive/types';

export interface EntryActions {
  open: (e: DriveEntry) => void;
  download: (e: DriveEntry) => void;
  rename: (e: DriveEntry) => void;
  move: (e: DriveEntry[]) => void;
  copy: (e: DriveEntry[]) => void;
  trash: (e: DriveEntry[]) => void;
}

/** Row menu (U-04): 열기/미리보기, 다운로드, 이름 변경, 이동, 복사, 휴지통으로. */
export function EntryMenu({ entry, actions, align = 'end' }: { entry: DriveEntry; actions: EntryActions; align?: 'start' | 'end' }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`${entry.name} 메뉴`}
          className="text-muted-foreground data-[state=open]:bg-accent"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal strokeWidth={1.75} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-44" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => actions.open(entry)}>
          {entry.isDir ? (
            <FolderOpen className="text-muted-foreground" strokeWidth={1.75} />
          ) : (
            <Eye className="text-muted-foreground" strokeWidth={1.75} />
          )}
          {entry.isDir ? '열기' : '미리보기'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.download(entry)}>
          <Download className="text-muted-foreground" strokeWidth={1.75} />
          다운로드
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => actions.rename(entry)}>
          <Pencil className="text-muted-foreground" strokeWidth={1.75} />
          이름 변경
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.move([entry])}>
          <FolderInput className="text-muted-foreground" strokeWidth={1.75} />
          이동
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.copy([entry])}>
          <Copy className="text-muted-foreground" strokeWidth={1.75} />
          복사
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => actions.trash([entry])}>
          <Trash2 className="text-muted-foreground" strokeWidth={1.75} />
          휴지통으로
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
