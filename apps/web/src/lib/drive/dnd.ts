// Drag-and-drop and folder-picker inputs → flat upload list with relative paths.
// The browser entry API sits behind `DropEntry` so the flattening is testable without a DOM.

export interface UploadSource {
  file: File;
  /** `photos/2026/a.jpg` for files inside a dropped/picked folder; null for a loose file. */
  relativePath: string | null;
}

export type DropEntry =
  | { kind: 'file'; name: string; getFile: () => Promise<File> }
  | { kind: 'dir'; name: string; readChildren: () => Promise<DropEntry[]> };

/** Depth-first flatten. Entries that fail to read are skipped (unreadable files, permission errors). */
export async function flattenEntries(entries: DropEntry[], prefix = ''): Promise<UploadSource[]> {
  const out: UploadSource[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'file') {
      try {
        const file = await entry.getFile();
        out.push({ file, relativePath: prefix ? rel : null });
      } catch {
        // skip
      }
    } else {
      let children: DropEntry[] = [];
      try {
        children = await entry.readChildren();
      } catch {
        children = [];
      }
      out.push(...(await flattenEntries(children, rel)));
    }
  }
  return out;
}

// ── Browser adapters (not unit tested; thin wrappers over the WebKit entry API).

interface WebkitEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}
interface WebkitFileEntry extends WebkitEntry {
  file: (ok: (f: File) => void, fail?: (e: unknown) => void) => void;
}
interface WebkitDirEntry extends WebkitEntry {
  createReader: () => { readEntries: (ok: (es: WebkitEntry[]) => void, fail?: (e: unknown) => void) => void };
}

export function fromWebkitEntry(entry: WebkitEntry): DropEntry {
  if (entry.isDirectory) {
    const dir = entry as WebkitDirEntry;
    return {
      kind: 'dir',
      name: dir.name,
      readChildren: async () => {
        const reader = dir.createReader();
        const all: WebkitEntry[] = [];
        // readEntries returns batches (Chrome: 100) until an empty batch.
        for (;;) {
          const batch = await new Promise<WebkitEntry[]>((ok, fail) => reader.readEntries(ok, fail));
          if (batch.length === 0) break;
          all.push(...batch);
        }
        return all.map(fromWebkitEntry);
      },
    };
  }
  const fileEntry = entry as WebkitFileEntry;
  return {
    kind: 'file',
    name: fileEntry.name,
    getFile: () => new Promise<File>((ok, fail) => fileEntry.file(ok, fail)),
  };
}

/** DataTransfer from a drop event → upload list. Falls back to `files` when the entry API is missing. */
export async function sourcesFromDataTransfer(dt: DataTransfer): Promise<UploadSource[]> {
  const items = Array.from(dt.items ?? []).filter((i) => i.kind === 'file');
  const entries: DropEntry[] = [];
  let usable = items.length > 0;
  for (const item of items) {
    const getEntry = (item as DataTransferItem & { webkitGetAsEntry?: () => WebkitEntry | null }).webkitGetAsEntry;
    const entry = typeof getEntry === 'function' ? getEntry.call(item) : null;
    if (!entry) {
      usable = false;
      break;
    }
    entries.push(fromWebkitEntry(entry));
  }
  if (usable) return flattenEntries(entries);
  return Array.from(dt.files).map((file) => ({ file, relativePath: null }));
}

/** `<input type=file webkitdirectory>` → upload list (`webkitRelativePath` already includes the folder). */
export function sourcesFromInput(files: FileList | File[]): UploadSource[] {
  return Array.from(files).map((file) => {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    return { file, relativePath: rel ? rel : null };
  });
}
