import { baseName, parentPath } from './path';
import type { DriveHistoryItem } from './types';

// U-05 변경 기록 wording: who (ActorBadge) · what (this) · when.

export function historyLabel(h: Pick<DriveHistoryItem, 'action' | 'actor' | 'path' | 'prevPath'>): string {
  const agent = h.actor.kind === 'agent';
  switch (h.action) {
    case 'create':
      return agent ? '에이전트가 새로 저장' : '업로드';
    case 'update':
      return agent ? '에이전트가 내용을 고쳐 저장' : '저장';
    case 'rename':
      return h.prevPath ? `이름 변경 · ${baseName(h.prevPath)} → ${baseName(h.path)}` : '이름 변경';
    case 'move':
      return h.prevPath ? `이동 · ${parentPath(h.prevPath)} → ${parentPath(h.path)}` : '이동';
    case 'copy':
      return h.prevPath ? `복사 · ${h.prevPath}에서` : '복사';
    case 'trash':
      return '휴지통으로';
    case 'restore':
      return '복원';
    case 'delete':
      return '영구 삭제';
    default:
      return '변경';
  }
}

/** Newest first; the API order is not relied on. */
export function sortHistory<T extends { at: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
