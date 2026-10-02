import { describe, expect, it } from 'vitest';
import { csvCell, parseCsv } from './csv.js';

describe('parseCsv', () => {
  it('handles BOM, CRLF, quotes and blank lines', () => {
    const text = '﻿code,Name,parent_code\r\nD1,"경영지원본부",\r\n\r\nD2,"인사팀, ""HR""",D1\nD3,"여러\n줄",D1\n';
    const { header, rows } = parseCsv(text);
    expect(header).toEqual(['code', 'name', 'parent_code']);
    expect(rows).toEqual([
      { line: 2, values: { code: 'D1', name: '경영지원본부', parent_code: '' } },
      { line: 4, values: { code: 'D2', name: '인사팀, "HR"', parent_code: 'D1' } },
      { line: 5, values: { code: 'D3', name: '여러\n줄', parent_code: 'D1' } },
    ]);
  });

  it('fills missing trailing fields with empty strings', () => {
    expect(parseCsv('a,b,c\n1').rows[0]?.values).toEqual({ a: '1', b: '', c: '' });
  });

  it('quotes cells that need it', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });
});
