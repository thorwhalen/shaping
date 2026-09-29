/**
 * Video encoding with WebCodecs, muxed by mediabunny (MPL-2.0, bundled).
 *
 * The codec is chosen with `VideoEncoder.isConfigSupported`, falling back H.264 (MP4), VP9 (WebM),
 * VP8 (WebM). H.264 needs even dimensions, so sizes are rounded down. Timestamps are exactly
 * i / fps (never wall clock), and the loop waits while the encoder's queue is long. Without
 * WebCodecs `encodeVideo` throws an informative error: there is no recorded-canvas fallback.
 */
import { BufferTarget, EncodedPacket, EncodedVideoPacketSource, Mp4OutputFormat, Output, WebMOutputFormat, type OutputFormat } from 'mediabunny';
import type { RenderFrame } from './gif';

const MICROSECONDS_PER_SECOND = 1_000_000;
/** Bits per pixel per frame used to derive a bitrate when none is given. */
const DEFAULT_BITS_PER_PIXEL = 0.15;
/** Pause rendering while the encoder holds this many unencoded frames. */
const MAX_ENCODE_QUEUE = 8;
/** A keyframe at least this often, in seconds, so the file can be scrubbed. */
const KEYFRAME_INTERVAL_SECONDS = 2;
const EVEN = 2;

export type VideoCodecName = 'avc' | 'vp9' | 'vp8';
export type Container = 'mp4' | 'webm';

export interface CodecCandidate {
  codec: VideoCodecName;
  /** The WebCodecs codec string. */
  codecString: string;
  container: Container;
  mimeType: string;
  extension: string;
}

/** Preference order: H.264 (level 5.1, high profile), then VP9, then VP8. */
export const CODEC_CANDIDATES: readonly CodecCandidate[] = [
  { codec: 'avc', codecString: 'avc1.640033', container: 'mp4', mimeType: 'video/mp4', extension: 'mp4' },
  { codec: 'vp9', codecString: 'vp09.00.10.08', container: 'webm', mimeType: 'video/webm', extension: 'webm' },
  { codec: 'vp8', codecString: 'vp8', container: 'webm', mimeType: 'video/webm', extension: 'webm' },
];

export interface VideoOptions {
  count: number;
  fps: number;
  width: number;
  height: number;
  /** Bits per second. Default: width * height * fps * 0.15. */
  bitrate?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface VideoResult {
  bytes: Uint8Array;
  mimeType: string;
  extension: string;
}

/** Round down to an even number (H.264 needs even dimensions), never below 2. */
export function evenDimension(n: number): number {
  return Math.max(EVEN, Math.floor(n / EVEN) * EVEN);
}

/** Default bitrate for a frame size and rate. */
export function defaultBitrate(width: number, height: number, fps: number): number {
  return Math.round(width * height * fps * DEFAULT_BITS_PER_PIXEL);
}

type IsSupported = (config: VideoEncoderConfig) => Promise<{ supported?: boolean }>;

/** True when the browser has WebCodecs video encoding. */
export function supportsVideo(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/**
 * The first candidate the encoder supports, with the config that was checked; null when none is.
 * `isConfigSupported` is injectable so the fallback order can be tested without a browser.
 */
export async function pickCodec(
  width: number,
  height: number,
  fps: number,
  bitrate: number,
  isSupported: IsSupported = (c) => VideoEncoder.isConfigSupported(c),
  candidates: readonly CodecCandidate[] = CODEC_CANDIDATES,
): Promise<{ candidate: CodecCandidate; config: VideoEncoderConfig } | null> {
  for (const candidate of candidates) {
    const config: VideoEncoderConfig = { codec: candidate.codecString, width, height, bitrate, framerate: fps };
    try {
      if ((await isSupported(config)).supported) return { candidate, config };
    } catch {
      // An unknown codec string can throw; treat as unsupported and try the next.
    }
  }
  return null;
}

function outputFormat(container: Container): OutputFormat {
  return container === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat();
}

function waitForQueue(encoder: VideoEncoder): Promise<void> {
  return new Promise((resolve) => encoder.addEventListener('dequeue', () => resolve(), { once: true }));
}

/** Encode `count` frames at `fps` into MP4 or WebM. Rejects with the signal's reason on abort. */
export async function encodeVideo(renderFrame: RenderFrame, options: VideoOptions): Promise<VideoResult> {
  if (!supportsVideo()) {
    throw new Error('Video export needs WebCodecs (VideoEncoder), which this browser lacks. Use a current Chrome, Edge or Safari, or export a GIF instead.');
  }
  const { count, fps, onProgress, signal } = options;
  const width = evenDimension(options.width);
  const height = evenDimension(options.height);
  const bitrate = options.bitrate ?? defaultBitrate(width, height, fps);
  const picked = await pickCodec(width, height, fps, bitrate);
  if (!picked) throw new Error(`No supported video codec (tried ${CODEC_CANDIDATES.map((c) => c.codec).join(', ')}) at ${width}x${height}. Try a smaller size or a GIF.`);
  const { candidate, config } = picked;

  const target = new BufferTarget();
  const output = new Output({ format: outputFormat(candidate.container), target });
  const source = new EncodedVideoPacketSource(candidate.codec);
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  let failure: unknown = null;
  let muxing: Promise<void> = Promise.resolve();
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxing = muxing.then(() => source.add(EncodedPacket.fromEncodedChunk(chunk), meta));
    },
    error: (e) => {
      failure = e;
    },
  });
  encoder.configure(candidate.codec === 'avc' ? { ...config, avc: { format: 'avc' } } : config);

  const keyInterval = Math.max(1, Math.round(fps * KEYFRAME_INTERVAL_SECONDS));
  try {
    for (let i = 0; i < count; i++) {
      signal?.throwIfAborted();
      if (failure) throw failure;
      while (encoder.encodeQueueSize > MAX_ENCODE_QUEUE) await waitForQueue(encoder);
      const image = await renderFrame(i);
      const frame = new VideoFrame(image.data, {
        format: 'RGBA',
        codedWidth: image.width,
        codedHeight: image.height,
        visibleRect: { x: 0, y: 0, width, height },
        timestamp: Math.round((i * MICROSECONDS_PER_SECOND) / fps),
        duration: Math.round(MICROSECONDS_PER_SECOND / fps),
      });
      encoder.encode(frame, { keyFrame: i % keyInterval === 0 });
      frame.close();
      onProgress?.((i + 1) / count);
    }
    await encoder.flush();
    if (failure) throw failure;
    await muxing;
    await output.finalize();
  } catch (e) {
    if (encoder.state !== 'closed') encoder.close();
    await output.cancel().catch(() => undefined);
    throw e;
  }
  encoder.close();
  if (!target.buffer) throw new Error('Video muxer produced no data');
  return { bytes: new Uint8Array(target.buffer), mimeType: candidate.mimeType, extension: candidate.extension };
}
