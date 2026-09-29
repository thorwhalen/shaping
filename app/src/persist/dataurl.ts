/** Bytes to and from base64 and `data:` URLs, in chunks so large images do not overflow the call stack. */
const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const bytesToDataUrl = (bytes: Uint8Array, mediaType: string) => `data:${mediaType};base64,${bytesToBase64(bytes)}`;

const DATA_URL = /^data:([^;,]*);base64,(.*)$/s;

/** Returns null when the text is not a base64 data URL. */
export function dataUrlToBytes(url: string): { bytes: Uint8Array; mediaType: string } | null {
  const m = DATA_URL.exec(url);
  if (!m) return null;
  try {
    return { bytes: base64ToBytes(m[2]), mediaType: m[1] || 'application/octet-stream' };
  } catch {
    return null;
  }
}

/** URL-safe base64 without padding (for query strings). */
export const toBase64Url = (bytes: Uint8Array) => bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}
