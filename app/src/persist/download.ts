/** Browser plumbing for files: hand a file to the user, and read one they choose. */
import type { FileOut } from './types';

export function downloadFile({ filename, mediaType, text }: FileOut) {
  const url = URL.createObjectURL(new Blob([text], { type: mediaType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url));
}

export const readFileText = (file: File): Promise<string> => file.text();

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
