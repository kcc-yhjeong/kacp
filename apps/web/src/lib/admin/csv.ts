import type { ImportKind } from './types';

// CSV templates for A-13 (01-screens.md A-13) and Blob downloads.

export const IMPORT_COLUMNS: Record<ImportKind, readonly string[]> = {
  departments: ['code', 'name', 'parent_code', 'head_email', 'sort_order'],
  users: ['email', 'name', 'department_code', 'title', 'employee_no', 'platform_role'],
};

export const IMPORT_TEMPLATE_FILE: Record<ImportKind, string> = {
  departments: 'kacp-departments-template.csv',
  users: 'kacp-users-template.csv',
};

/** Quote a cell when it holds a comma, quote or line break (RFC 4180). */
export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Header-only template. A UTF-8 BOM keeps Korean readable when opened in Excel. */
export function buildImportTemplate(kind: ImportKind): string {
  return `﻿${toCsv([IMPORT_COLUMNS[kind]])}`;
}

/** Save text as a file through a temporary object URL. */
export function downloadText(fileName: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Prefix a BOM unless the server already did. */
export function withBom(text: string): string {
  return text.startsWith('﻿') ? text : `﻿${text}`;
}
