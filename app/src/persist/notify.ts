/**
 * A tiny notice store: every persistence action says what happened (or why it did not) through
 * `notify`; `Notices.tsx` shows them. No action fails silently.
 */
export type NoticeKind = 'info' | 'success' | 'error';

export interface Notice {
  id: number;
  kind: NoticeKind;
  text: string;
}

/** How long a notice stays before it goes away by itself (errors stay until dismissed). */
export const NOTICE_MS = 6000;

let notices: Notice[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const emit = (next: Notice[]) => {
  notices = next;
  listeners.forEach((l) => l());
};

export function dismiss(id: number) {
  emit(notices.filter((n) => n.id !== id));
}

export function notify(kind: NoticeKind, text: string) {
  const id = nextId++;
  emit([...notices, { id, kind, text }]);
  if (kind !== 'error') setTimeout(() => dismiss(id), NOTICE_MS);
}

export const subscribeNotices = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
export const getNotices = () => notices;
