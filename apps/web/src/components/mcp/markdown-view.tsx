import { Fragment, useMemo, type ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from '@/lib/mcp/markdown';
import { cn } from '@/lib/utils';

/** README renderer: React text nodes only (see lib/mcp/markdown.ts), so nothing in the file becomes HTML. */
export function MarkdownView({ source, className }: { source: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return <div className={cn('flex flex-col gap-3 text-[13.5px] leading-relaxed text-pretty', className)}>{blocks.map(renderBlock)}</div>;
}

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.t) {
    case 'h': {
      const cls = b.level === 1 ? 'text-lg font-semibold' : b.level === 2 ? 'text-base font-semibold' : 'text-sm font-semibold';
      const Tag = (`h${Math.min(b.level + 1, 6)}` as 'h2' | 'h3' | 'h4' | 'h5');
      return (
        <Tag key={i} className={cn(cls, i > 0 && 'mt-2')}>
          {renderInline(b.c)}
        </Tag>
      );
    }
    case 'p':
      return <p key={i}>{renderInline(b.c)}</p>;
    case 'code':
      return (
        <pre key={i} className="overflow-x-auto rounded-lg bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed">
          {b.v}
        </pre>
      );
    case 'ul':
    case 'ol': {
      const List = b.t;
      return (
        <List key={i} className={cn('flex flex-col gap-1 pl-5', b.t === 'ul' ? 'list-disc' : 'list-decimal')}>
          {b.items.map((it, j) => (
            <li key={j}>{renderInline(it)}</li>
          ))}
        </List>
      );
    }
    case 'quote':
      return (
        <blockquote key={i} className="border-l-2 pl-3 text-muted-foreground">
          {renderInline(b.c)}
        </blockquote>
      );
    case 'hr':
      return <hr key={i} className="border-border" />;
  }
}

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return <Fragment key={i}>{n.v}</Fragment>;
      case 'code':
        return (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
            {n.v}
          </code>
        );
      case 'strong':
        return <strong key={i}>{renderInline(n.c)}</strong>;
      case 'em':
        return <em key={i}>{renderInline(n.c)}</em>;
      case 'link':
        return (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">
            {renderInline(n.c)}
          </a>
        );
    }
  });
}
