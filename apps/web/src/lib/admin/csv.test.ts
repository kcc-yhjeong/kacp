import { describe, expect, it } from 'vitest';
import { buildImportTemplate, csvCell, IMPORT_COLUMNS, toCsv, withBom } from './csv';

describe('buildImportTemplate', () => {
  it('writes the department header with a BOM', () => {
    expect(buildImportTemplate('departments')).toBe('﻿code,name,parent_code,head_email,sort_order\r\n');
  });
  it('writes the user header', () => {
    expect(buildImportTemplate('users')).toBe('﻿email,name,department_code,title,employee_no,platform_role\r\n');
    expect(IMPORT_COLUMNS.users).toHaveLength(6);
  });
});

describe('csv cells', () => {
  it('quotes only when needed', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
    expect(csvCell(3)).toBe('3');
  });
  it('joins rows with CRLF', () => {
    expect(toCsv([['a', 'b'], ['c', 'd,e']])).toBe('a,b\r\nc,"d,e"\r\n');
  });
  it('adds a BOM once', () => {
    expect(withBom('x')).toBe('﻿x');
    expect(withBom('﻿x')).toBe('﻿x');
  });
});
