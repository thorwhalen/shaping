/**
 * GIF encoding with one global palette.
 *
 * A few frames spread evenly over the animation are rendered first and quantised together into a
 * single palette; every frame is then mapped onto that palette, so colours do not flicker from
 * frame to frame. The animation loops forever. Frames are pulled one at a time from `renderFrame`
 * (which may rebuild geometry), so memory holds one frame plus the encoded bytes.
 */
import { GIFEncoder, applyPalette, quantize, type Rgb } from 'gifenc';

const DEFAULT_SAMPLE_COUNT = 6;
const DEFAULT_MAX_COLORS = 256;
const PALETTE_FORMAT = 'rgb565' as const;
const MS_PER_SECOND = 1000;
/** gifenc: a repeat count of 0 loops forever. */
const LOOP_FOREVER = 0;

export interface GifOptions {
  /** Number of frames to write (see `frameCount` in `shaping/animate`). */
  count: number;
  fps: number;
  /** Called with a fraction in [0, 1] after each frame. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** How many frames to sample for the shared palette. */
  sampleCount?: number;
  maxColors?: number;
}

export type RenderFrame = (index: number) => Promise<ImageData>;

/** Indices of up to `sampleCount` frames spread evenly over `count` frames, always including 0. */
export function sampleFrameIndices(count: number, sampleCount: number = DEFAULT_SAMPLE_COUNT): number[] {
  const n = Math.max(1, Math.min(count, sampleCount));
  return [...new Set(Array.from({ length: n }, (_, k) => Math.floor((k * count) / n)))];
}

/** Concatenate RGBA pixel arrays into one, for quantising several frames together. */
export function concatPixels(frames: ArrayLike<number>[]): Uint8Array {
  const total = frames.reduce((sum, f) => sum + f.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const f of frames) {
    out.set(f, offset);
    offset += f.length;
  }
  return out;
}

/** One palette for the whole animation, from the sampled frames. */
export function globalPalette(samples: ImageData[], maxColors: number = DEFAULT_MAX_COLORS): Rgb[] {
  return quantize(concatPixels(samples.map((s) => s.data)), maxColors, { format: PALETTE_FORMAT });
}

/** Frame delay in milliseconds for a frame rate. */
export function frameDelayMs(fps: number): number {
  return Math.round(MS_PER_SECOND / fps);
}

async function renderSamples(renderFrame: RenderFrame, indices: number[], signal?: AbortSignal): Promise<Map<number, ImageData>> {
  const samples = new Map<number, ImageData>();
  for (const i of indices) {
    signal?.throwIfAborted();
    samples.set(i, await renderFrame(i));
  }
  return samples;
}

/** Encode `count` frames as an infinitely looping GIF. Rejects with the signal's reason on abort. */
export async function encodeGif(renderFrame: RenderFrame, options: GifOptions): Promise<Uint8Array> {
  const { count, fps, onProgress, signal, sampleCount = DEFAULT_SAMPLE_COUNT, maxColors = DEFAULT_MAX_COLORS } = options;
  if (count < 1) throw new Error('encodeGif needs at least one frame');
  const samples = await renderSamples(renderFrame, sampleFrameIndices(count, sampleCount), signal);
  const palette = globalPalette([...samples.values()], maxColors);
  const gif = GIFEncoder();
  const delay = frameDelayMs(fps);
  for (let i = 0; i < count; i++) {
    signal?.throwIfAborted();
    const frame = samples.get(i) ?? (await renderFrame(i));
    const index = applyPalette(frame.data, palette, PALETTE_FORMAT);
    gif.writeFrame(index, frame.width, frame.height, { palette, delay, repeat: LOOP_FOREVER });
    samples.delete(i);
    onProgress?.((i + 1) / count);
  }
  gif.finish();
  return gif.bytes();
}
