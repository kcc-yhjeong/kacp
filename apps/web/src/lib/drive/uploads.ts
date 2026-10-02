import { useSyncExternalStore } from 'react';
import { errorMessage } from '@/lib/api';
import { MAX_UPLOAD_BYTES, TOO_LARGE_MESSAGE, UploadAborted, uploadFile, type UploadHandle } from './api';
import type { UploadSource } from './dnd';
import type { DriveRef } from './types';

// Upload queue behind the U-04 tray (bottom right). Lives at module level so it survives folder changes.

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error' | 'canceled';

export interface UploadItem {
  id: number;
  team: string;
  dest: DriveRef;
  name: string;
  relativePath: string | null;
  size: number;
  loaded: number;
  status: UploadStatus;
  error: string | null;
}

const CONCURRENCY = 2;

let items: UploadItem[] = [];
let nextId = 1;
const files = new Map<number, File>();
const handles = new Map<number, UploadHandle>();
const listeners = new Set<() => void>();
let onFinished: ((team: string) => void) | null = null;

function emit(): void {
  for (const l of listeners) l();
}

function patch(id: number, change: Partial<UploadItem>): void {
  items = items.map((it) => (it.id === id ? { ...it, ...change } : it));
  emit();
}

function pump(): void {
  let running = items.filter((i) => i.status === 'uploading').length;
  for (const item of items) {
    if (running >= CONCURRENCY) break;
    if (item.status !== 'queued') continue;
    const file = files.get(item.id);
    if (!file) continue;
    running++;
    start(item, file);
  }
}

function start(item: UploadItem, file: File): void {
  patch(item.id, { status: 'uploading', loaded: 0 });
  const handle = uploadFile(item.team, item.dest, file, item.relativePath, (loaded) => patch(item.id, { loaded }));
  handles.set(item.id, handle);
  handle.promise.then(
    () => {
      patch(item.id, { status: 'done', loaded: item.size });
      onFinished?.(item.team);
    },
    (err: unknown) => {
      if (err instanceof UploadAborted) patch(item.id, { status: 'canceled' });
      else patch(item.id, { status: 'error', error: errorMessage(err) });
    },
  ).finally(() => {
    handles.delete(item.id);
    files.delete(item.id);
    pump();
  });
}

export const uploads = {
  enqueue(team: string, dest: DriveRef, sources: UploadSource[]): void {
    const added: UploadItem[] = sources.map(({ file, relativePath }) => {
      const id = nextId++;
      const tooLarge = file.size > MAX_UPLOAD_BYTES;
      if (!tooLarge) files.set(id, file);
      return {
        id,
        team,
        dest,
        name: file.name,
        relativePath,
        size: file.size,
        loaded: 0,
        status: tooLarge ? 'error' : 'queued',
        error: tooLarge ? TOO_LARGE_MESSAGE : null,
      };
    });
    items = [...items, ...added];
    emit();
    pump();
  },
  cancel(id: number): void {
    const handle = handles.get(id);
    if (handle) {
      handle.abort();
      return;
    }
    files.delete(id);
    patch(id, { status: 'canceled' });
  },
  cancelAll(): void {
    for (const it of items) if (it.status === 'queued' || it.status === 'uploading') uploads.cancel(it.id);
  },
  /** Drop finished rows; closes the tray when nothing is left. */
  clearFinished(): void {
    items = items.filter((i) => i.status === 'queued' || i.status === 'uploading');
    emit();
  },
  setOnFinished(fn: ((team: string) => void) | null): void {
    onFinished = fn;
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  snapshot: (): UploadItem[] => items,
};

export function useUploads(): UploadItem[] {
  return useSyncExternalStore(uploads.subscribe, uploads.snapshot, uploads.snapshot);
}

export function isActive(item: UploadItem): boolean {
  return item.status === 'queued' || item.status === 'uploading';
}
