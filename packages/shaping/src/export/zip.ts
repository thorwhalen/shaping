/**
 * Deterministic zip writing on `fflate`: entries in the order given, a fixed timestamp, so the
 * same model always gives the same bytes.
 */
import { zipSync, type Zippable } from 'fflate';

/** Timestamp stored in every entry (zip cannot represent dates before 1980). */
export const ZIP_TIMESTAMP_MS = Date.UTC(1981, 0, 1, 12);

/** Zip `files` (path -> bytes), keeping insertion order. */
export function zipFiles(files: Record<string, Uint8Array>): Uint8Array {
  const entries: Zippable = {};
  for (const [path, data] of Object.entries(files)) entries[path] = [data, { mtime: ZIP_TIMESTAMP_MS }];
  return zipSync(entries);
}
