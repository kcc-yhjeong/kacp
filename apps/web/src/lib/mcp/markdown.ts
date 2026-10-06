// Tiny Markdown subset for package READMEs (U-10). It produces a plain tree that React renders as
// text nodes, so nothing in the README can inject HTML. Raw HTML in the source shows as text.
// Supported: headings, paragraphs, fenced code, lists (- * 1.), blockquotes, rules, tables (as text rows),
// inline code, **bold**, *em*, [links](https://…).

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] };

export type Block =
  | { t: 'h'; level: 1 | 2 | 3 | 4; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'ul' | 'ol'; items: Inline[][] }
  | { t: 'quote'; c: Inline[] }
  | { t: 'hr' };

/** Only these link targets become anchors; anything else (javascript:, data:, relative) stays text. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  return /^(https?:\/\/|mailto:)/i.test(h) ? h : null;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const rest = src.slice(i);
    if (ch === '\\' && i + 1 < src.length) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i) {
        flush();
        out.push({ t: 'code', v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (rest.startsWith('**') || rest.startsWith('__')) {
      const mark = rest.slice(0, 2);
      const end = src.indexOf(mark, i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: 'strong', c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && src[i + 1] !== ' ') {
      const end = src.indexOf(ch, i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: 'em', c: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const m = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest);
      if (m) {
        flush();
        const href = safeHref(m[2] ?? '');
        const label = parseInline(m[1] ?? '');
        if (href) out.push({ t: 'link', href, c: label });
        else out.push(...label);
        i += m[0].length;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join(' ')) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fence = /^\s*(```|~~~)\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      flushPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith(fence[1] ?? '```')) {
        body.push(lines[i] ?? '');
        i++;
      }
      blocks.push({ t: 'code', lang: fence[2] ?? '', v: body.join('\n') });
      continue;
    }
    if (!line.trim()) {
      flushPara();
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flushPara();
      const level = Math.min(4, (h[1] ?? '#').length) as 1 | 2 | 3 | 4;
      blocks.push({ t: 'h', level, c: parseInline(h[2] ?? '') });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara();
      blocks.push({ t: 'hr' });
      continue;
    }
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const ordered = /\d/.test(li[1] ?? '');
      const items: Inline[][] = [parseInline(li[2] ?? '')];
      while (i + 1 < lines.length) {
        const next = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i + 1] ?? '');
        if (!next || /\d/.test(next[1] ?? '') !== ordered) break;
        items.push(parseInline(next[2] ?? ''));
        i++;
      }
      blocks.push({ t: ordered ? 'ol' : 'ul', items });
      continue;
    }
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) {
      flushPara();
      const body = [q[1] ?? ''];
      while (i + 1 < lines.length) {
        const nq = /^\s*>\s?(.*)$/.exec(lines[i + 1] ?? '');
        if (!nq) break;
        body.push(nq[1] ?? '');
        i++;
      }
      blocks.push({ t: 'quote', c: parseInline(body.join(' ')) });
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  return blocks;
}
