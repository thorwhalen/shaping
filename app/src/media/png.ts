/**
 * Stills and saving.
 *
 * `canvasToPng` turns a canvas into a PNG blob, optionally with a transparent background.
 * `pickSaveHandle` asks for a file handle (File System Access API) so a long export can request
 * it BEFORE it starts, while the user gesture is still valid. `saveBytes` writes to that handle, or
 * falls back to an `<a download>` link with an object URL where the API is missing.
 */
const PNG_TYPE = 'image/png';
const DEFAULT_BACKGROUND = '#ffffff';
/** Delay before revoking a download URL, so the browser has started the download. */
const REVOKE_DELAY_MS = 10_000;

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface PngOptions {
  /** Keep the canvas alpha. When false, the image is flattened onto `background`. */
  transparent?: boolean;
  background?: string;
}

/** Minimal shape of a File System Access file handle. */
export interface SaveHandle {
  createWritable(): Promise<{ write(data: Blob | BufferSource): Promise<void>; close(): Promise<void> }>;
}
type SavePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveHandle>;

function toBlob(canvas: AnyCanvas): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: PNG_TYPE });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas could not be encoded as PNG'))), PNG_TYPE));
}

function flatten(canvas: AnyCanvas, background: string): OffscreenCanvas {
  const flat = new OffscreenCanvas(canvas.width, canvas.height);
  const ctx = flat.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  return flat;
}

/** PNG of a canvas. Transparent by default; `transparent: false` flattens onto `background`. */
export function canvasToPng(canvas: AnyCanvas, options: PngOptions = {}): Promise<Blob> {
  const { transparent = true, background = DEFAULT_BACKGROUND } = options;
  return toBlob(transparent ? canvas : flatten(canvas, background));
}

function pickerOf(): SavePicker | null {
  const w = globalThis as unknown as { showSaveFilePicker?: SavePicker };
  return typeof w.showSaveFilePicker === 'function' ? w.showSaveFilePicker.bind(globalThis) : null;
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot) : '';
}

/**
 * Ask the user where to save, now. Returns null when the browser has no file picker (then
 * `saveBytes` downloads instead). A cancelled dialog rejects with an AbortError.
 */
export async function pickSaveHandle(fileName: string, mediaType: string): Promise<SaveHandle | null> {
  const picker = pickerOf();
  if (!picker) return null;
  const ext = extensionOf(fileName);
  try {
    return await picker({ suggestedName: fileName, types: [{ description: fileName, accept: { [mediaType]: ext ? [ext] : [] } }] });
  } catch (e) {
    // The user closed the dialog: say so plainly, so the caller can stop without an error.
    if ((e as { name?: string }).name === 'AbortError') throw new SaveCancelled();
    throw e;
  }
}

/** The user cancelled the save dialog. */
export class SaveCancelled extends Error {
  constructor() {
    super('Saving was cancelled.');
    this.name = 'SaveCancelled';
  }
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * Save bytes or a blob. Uses `handle` when given, else asks now (if the picker exists), else
 * downloads through an `<a download>` object URL.
 */
export async function saveBytes(data: Uint8Array | Blob, fileName: string, mediaType: string, handle?: SaveHandle | null): Promise<void> {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mediaType });
  const target = handle ?? (await pickSaveHandle(fileName, mediaType));
  if (!target) return download(blob, fileName);
  const writable = await target.createWritable();
  await writable.write(blob);
  await writable.close();
}
