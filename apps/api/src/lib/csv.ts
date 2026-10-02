// Minimal RFC 4180 CSV parser for A-13 imports: quotes, escaped quotes, CRLF, UTF-8 BOM.

export interface CsvRow {
  /** 1-based line number of the record in the file (header = 1). */
  line: number;
  values: Record<string, string>;
}

export function parseCsv(text: string): { header: string[]; rows: CsvRow[] } {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: { line: number; fields: string[] }[] = [];
  let field = '';
  let fields: string[] = [];
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  const endRecord = () => {
    fields.push(field);
    if (fields.length > 1 || fields[0] !== '') records.push({ line: recordLine, fields });
    fields = [];
    field = '';
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      fields.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      endRecord();
      line++;
      recordLine = line;
    } else field += ch;
  }
  if (field !== '' || fields.length > 0) endRecord();

  const [head, ...body] = records;
  const header = (head?.fields ?? []).map((h) => h.trim().toLowerCase());
  const rows = body.map((r) => ({
    line: r.line,
    values: Object.fromEntries(header.map((h, idx) => [h, (r.fields[idx] ?? '').trim()])),
  }));
  return { header, rows };
}

/** Quotes a value for CSV output when needed. */
export const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
