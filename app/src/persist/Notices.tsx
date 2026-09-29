/** Shows the notices from `notify.ts` in a live region (mounted once, in the app shell). */
import { useSyncExternalStore } from 'react';
import { dismiss, getNotices, subscribeNotices, type NoticeKind } from './notify';

const TONE: Record<NoticeKind, string> = {
  info: 'border-line text-ink',
  success: 'border-green-700 text-green-900',
  error: 'border-red-700 text-red-800',
};

export function Notices() {
  const notices = useSyncExternalStore(subscribeNotices, getNotices);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-50 flex flex-col items-center gap-2 px-3" aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} role={n.kind === 'error' ? 'alert' : 'status'} className={`pointer-events-auto flex max-w-lg items-start gap-3 whitespace-pre-line rounded-lg border bg-white px-3 py-2 text-sm shadow ${TONE[n.kind]}`}>
          <span className="flex-1">{n.text}</span>
          <button className="text-muted hover:text-ink" aria-label="Dismiss" onClick={() => dismiss(n.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
