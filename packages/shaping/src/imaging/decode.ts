/**
 * Decoding image bytes to RGBA pixels, and reducing them to the working size.
 *
 * In a browser (or a worker) the platform decoder does the work (`createImageBitmap` drawn on an
 * `OffscreenCanvas`), which covers PNG, JPEG, WebP and, where the browser supports it, HEIC. In
 * Node, PNG goes through `fast-png` and JPEG through `jpeg-js`. Nothing here touches the DOM
 * except inside `decodeWithBrowser`, which is guarded.
 */
import { decode as decodePng } from 'fast-png';

/** Straight (non-premultiplied) RGBA pixels, row 0 at the top. */
export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'heic' | 'unknown';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const CHANNELS_RGBA = 4;
const OPAQUE = 255;
const BITS_PER_BYTE = 8;

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));

/** Identify a format from its leading bytes, falling back on the media type. */
export function sniffFormat(bytes: Uint8Array, mediaType?: string): ImageFormat {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'png';
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'jpeg';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'webp';
  if (ascii(bytes, 0, 3) === 'GIF') return 'gif';
  if (ascii(bytes, 4, 8) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1)/.test(ascii(bytes, 8, 12))) return 'heic';
  const type = mediaType?.toLowerCase() ?? '';
  for (const f of ['png', 'jpeg', 'webp', 'gif', 'heic'] as const) if (type.includes(f)) return f;
  return 'unknown';
}

/**
 * Decode PNG, JPEG, WebP or (where the browser can) HEIC bytes and reduce the longest side to
 * `maxSize` (no reduction when omitted). Throws an error naming what to do when the format cannot
 * be decoded in this environment.
 */
export async function decodeImage(bytes: Uint8Array, mediaType?: string, maxSize?: number): Promise<RGBAImage> {
  const format = sniffFormat(bytes, mediaType);
  const image = await decodeByFormat(bytes, format, mediaType);
  return maxSize ? resizeImage(image, maxSize) : image;
}

async function decodeByFormat(bytes: Uint8Array, format: ImageFormat, mediaType?: string): Promise<RGBAImage> {
  const browser = hasBrowserDecoder();
  if (browser) {
    try {
      return await decodeWithBrowser(bytes, mediaType ?? mediaTypeOf(format));
    } catch (error) {
      if (format !== 'png' && format !== 'jpeg') {
        const what = format === 'heic' ? 'HEIC is not supported by this browser. Convert the photo to PNG or JPEG.' : `This browser could not decode the image (${String(error)}).`;
        throw new Error(what);
      }
    }
  }
  switch (format) {
    case 'png':
      return decodePngBytes(bytes);
    case 'jpeg':
      return decodeJpegBytes(bytes);
    case 'heic':
      throw new Error('HEIC needs a browser that can decode it. Convert the photo to PNG or JPEG, or open the app in Safari.');
    default:
      throw new Error(`Cannot decode this image (${format}) outside a browser. Use PNG or JPEG.`);
  }
}

const mediaTypeOf = (format: ImageFormat) => (format === 'unknown' ? '' : `image/${format}`);

function hasBrowserDecoder(): boolean {
  return typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function';
}

async function decodeWithBrowser(bytes: Uint8Array, mediaType: string): Promise<RGBAImage> {
  const blob = new Blob([bytes as BlobPart], mediaType ? { type: mediaType } : undefined);
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('No 2D canvas context.');
    ctx.drawImage(bitmap, 0, 0);
    const { width, height, data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width, height, data };
  } finally {
    bitmap.close();
  }
}

/** PNG through `fast-png`: any bit depth, grey, grey+alpha, RGB, RGBA and palette images. */
export function decodePngBytes(bytes: Uint8Array): RGBAImage {
  const png = decodePng(bytes);
  const { width, height, channels, depth, palette } = png;
  const out = new Uint8ClampedArray(width * height * CHANNELS_RGBA);
  const src = png.data as ArrayLike<number>;
  const maxValue = 2 ** depth - 1;
  const scale = (v: number) => (depth === BITS_PER_BYTE ? v : Math.round((v * OPAQUE) / maxValue));
  for (let i = 0, n = width * height; i < n; i++) {
    const o = i * CHANNELS_RGBA;
    if (palette) {
      const [r, g, b, a] = palette[src[i * channels]];
      out.set([r, g, b, a ?? OPAQUE], o);
    } else if (channels <= 2) {
      const g = scale(src[i * channels]);
      out.set([g, g, g, channels === 2 ? scale(src[i * channels + 1]) : OPAQUE], o);
    } else {
      out.set([scale(src[i * channels]), scale(src[i * channels + 1]), scale(src[i * channels + 2]), channels === 4 ? scale(src[i * channels + 3]) : OPAQUE], o);
    }
  }
  return { width, height, data: out };
}

async function decodeJpegBytes(bytes: Uint8Array): Promise<RGBAImage> {
  const jpeg = await import('jpeg-js');
  const decode = jpeg.decode ?? (jpeg as unknown as { default: typeof jpeg }).default.decode;
  const { width, height, data } = decode(bytes, { useTArray: true, formatAsRGBA: true });
  return { width, height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) };
}

/**
 * Reduce an image so its longest side is at most `maxSize`, by averaging the source pixels under
 * each output pixel (a box filter, alpha-weighted so transparent pixels do not darken edges).
 * Images already small enough are returned as they are: images are never enlarged.
 */
export function resizeImage(image: RGBAImage, maxSize: number): RGBAImage {
  const longest = Math.max(image.width, image.height);
  if (longest <= maxSize) return image;
  const scale = maxSize / longest;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const out = new Uint8ClampedArray(width * height * CHANNELS_RGBA);
  const sx = image.width / width;
  const sy = image.height / height;
  const src = image.data;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(image.height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(image.width, Math.floor((x + 1) * sx)));
      let r = 0, g = 0, b = 0, a = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const p = (yy * image.width + xx) * CHANNELS_RGBA;
          const alpha = src[p + 3];
          r += src[p] * alpha;
          g += src[p + 1] * alpha;
          b += src[p + 2] * alpha;
          a += alpha;
        }
      }
      const o = (y * width + x) * CHANNELS_RGBA;
      const count = (y1 - y0) * (x1 - x0);
      if (a > 0) out.set([r / a, g / a, b / a, a / count], o);
    }
  }
  return { width, height, data: out };
}
