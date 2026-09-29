/** Node-runnable tests for the media helpers: palette sampling, dimensions, codec fallback, GIF output. */
import { describe, expect, it } from 'vitest';
import { concatPixels, encodeGif, frameDelayMs, globalPalette, sampleFrameIndices } from './gif';
import { CODEC_CANDIDATES, defaultBitrate, evenDimension, pickCodec } from './video';

function solid(r: number, g: number, b: number, w = 4, h = 4): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) data.set([r, g, b, 255], p * 4);
  return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
}

describe('sampleFrameIndices', () => {
  it('spreads evenly, starts at 0, never repeats, never exceeds count', () => {
    expect(sampleFrameIndices(60, 6)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(sampleFrameIndices(3, 6)).toEqual([0, 1, 2]);
    expect(sampleFrameIndices(1, 6)).toEqual([0]);
  });
});

describe('palette', () => {
  it('concatenates pixels and covers colours from every sampled frame', () => {
    expect(concatPixels([[1, 2], [3]])).toEqual(new Uint8Array([1, 2, 3]));
    const palette = globalPalette([solid(255, 0, 0), solid(0, 0, 255)]);
    expect(palette.length).toBeGreaterThanOrEqual(2);
  });
  it('delay comes from fps', () => {
    expect(frameDelayMs(20)).toBe(50);
  });
});

describe('encodeGif', () => {
  it('writes a looping GIF with all frames and reports progress', async () => {
    const seen: number[] = [];
    const bytes = await encodeGif(async (i) => solid(i * 40, 0, 0), { count: 5, fps: 10, sampleCount: 2, onProgress: (f) => seen.push(f) });
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe('GIF89a');
    expect(new TextDecoder().decode(bytes)).toContain('NETSCAPE2.0');
    expect(seen.at(-1)).toBe(1);
  });
  it('aborts', async () => {
    const ctl = new AbortController();
    ctl.abort(new Error('stop'));
    await expect(encodeGif(async () => solid(0, 0, 0), { count: 3, fps: 10, signal: ctl.signal })).rejects.toThrow('stop');
  });
});

describe('video helpers', () => {
  it('rounds dimensions down to even', () => {
    expect(evenDimension(1081)).toBe(1080);
    expect(evenDimension(640)).toBe(640);
    expect(evenDimension(1)).toBe(2);
  });
  it('default bitrate scales with size and rate', () => {
    expect(defaultBitrate(200, 100, 10)).toBe(30000);
  });
  it('falls back H.264 -> VP9 -> VP8 by isConfigSupported', async () => {
    const asked: string[] = [];
    const only = (codec: string) => async (c: { codec: string }) => (asked.push(c.codec), { supported: c.codec === codec });
    expect((await pickCodec(64, 64, 24, 1000, only('avc1.640033')))?.candidate.codec).toBe('avc');
    expect((await pickCodec(64, 64, 24, 1000, only('vp09.00.10.08')))?.candidate.codec).toBe('vp9');
    asked.length = 0;
    expect((await pickCodec(64, 64, 24, 1000, only('vp8')))?.candidate.extension).toBe('webm');
    expect(asked).toEqual(CODEC_CANDIDATES.map((c) => c.codecString));
    expect(await pickCodec(64, 64, 24, 1000, async () => ({ supported: false }))).toBeNull();
  });
  it('treats a throwing check as unsupported', async () => {
    const r = await pickCodec(64, 64, 24, 1000, async (c) => {
      if (c.codec.startsWith('avc')) throw new Error('bad');
      return { supported: true };
    });
    expect(r?.candidate.codec).toBe('vp9');
  });
});
