import { splitExt } from './path';

// File type → icon, preview kind and Korean type label (U-04 icons, U-05 종류, preview modal).

export type PreviewKind = 'image' | 'pdf' | 'text' | 'none';
export type FileIconKind = 'folder' | 'image' | 'text' | 'code' | 'file';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif']);
const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.log', '.rst']);
const CODE_EXT = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cpp', '.hpp',
  '.cs', '.php', '.swift', '.sh', '.bash', '.ps1', '.sql', '.json', '.yaml', '.yml', '.toml', '.ini', '.xml',
  '.html', '.htm', '.css', '.scss', '.vue', '.svelte', '.env', '.dockerfile',
]);
const CODE_NAMES = new Set(['dockerfile', 'makefile', '.gitignore', '.dockerignore', '.env']);

/** Preview limit for text kinds (fetched and shown in a `<pre>`). */
export const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;

function extOf(name: string): string {
  return splitExt(name)[1].toLowerCase();
}

function isCodeName(name: string): boolean {
  return CODE_EXT.has(extOf(name)) || CODE_NAMES.has(name.toLowerCase());
}

export function previewKind(name: string, mimeType = ''): PreviewKind {
  const mime = mimeType.toLowerCase();
  const ext = extOf(name);
  if (mime.startsWith('image/') || IMAGE_EXT.has(ext)) return 'image';
  if (mime === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (TEXT_EXT.has(ext) || isCodeName(name)) return 'text';
  if (mime.startsWith('text/') || mime === 'application/json' || mime.endsWith('+json') || mime.endsWith('+xml')) {
    return 'text';
  }
  return 'none';
}

export function fileIconKind(entry: { name: string; isDir: boolean; mimeType?: string }): FileIconKind {
  if (entry.isDir) return 'folder';
  const kind = previewKind(entry.name, entry.mimeType);
  if (kind === 'image') return 'image';
  if (isCodeName(entry.name)) return 'code';
  if (kind === 'text' || kind === 'pdf') return 'text';
  return 'file';
}

const LABEL_BY_EXT: Record<string, string> = {
  '.md': '마크다운',
  '.markdown': '마크다운',
  '.txt': '텍스트',
  '.csv': 'CSV',
  '.pdf': 'PDF',
  '.zip': 'ZIP 압축 파일',
  '.docx': 'Word 문서',
  '.doc': 'Word 문서',
  '.xlsx': 'Excel 문서',
  '.xls': 'Excel 문서',
  '.pptx': 'PowerPoint 문서',
  '.ppt': 'PowerPoint 문서',
  '.hwp': '한글 문서',
  '.hwpx': '한글 문서',
  '.json': 'JSON',
};

/** U-05 종류. */
export function typeLabel(entry: { name: string; isDir: boolean; mimeType?: string }): string {
  if (entry.isDir) return '폴더';
  const ext = extOf(entry.name);
  const known = LABEL_BY_EXT[ext];
  if (known) return known;
  const kind = previewKind(entry.name, entry.mimeType);
  if (kind === 'image') return ext ? `${ext.slice(1).toUpperCase()} 이미지` : '이미지';
  if (isCodeName(entry.name)) return '코드';
  if (kind === 'text') return '텍스트';
  if (entry.mimeType?.startsWith('video/')) return '동영상';
  if (entry.mimeType?.startsWith('audio/')) return '오디오';
  return ext ? `${ext.slice(1).toUpperCase()} 파일` : '파일';
}
