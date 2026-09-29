/** Share by link: round trip, what stays out of the link, the size limit, and rejection of bad values. */
import { describe, expect, it } from 'vitest';
import type { DrawObject } from 'shaping';
import { MAX_INCOMING_PARAM_CHARS, MAX_SHARE_PARAM_CHARS, SHARE_PARAM, SHARE_TAG, designFromLink, encodeDesign, sharedParam, shareLink } from './link';
import { imageDesign, makeDesign, memoryBlobs, textDesign } from './testing';

const BASE = 'https://apps.example.org/shaping/';
const blobs = memoryBlobs();
const paramOf = (url: string) => new URL(url).searchParams.get(SHARE_PARAM)!;

function bigDrawing(points: number) {
  const objects = Array.from({ length: points }, (_, i) => ({ tool: 'pen' as const, points: [[i * 1.37, (i * 7.91) % 500], [i * 2.11, (i * 3.3) % 500]], size: 12, filled: true, erase: false }));
  return makeDesign('big', { sources: { profile: { kind: 'drawing', width: 512, height: 512, objects: objects as unknown as DrawObject[] } } });
}

describe('share by link', () => {
  it('round-trips a text design: letters, font id and axes survive, under a new id', () => {
    const d = textDesign('orig', 'Hello', 'roboto-flex');
    const source = { ...d.sources.profile, axes: { wght: 700 } };
    const design = { ...d, sources: { profile: source } } as typeof d;
    const r = shareLink(design, BASE, blobs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.url.startsWith(`${BASE}?${SHARE_PARAM}=${SHARE_TAG}`)).toBe(true);
    const back = designFromLink(paramOf(r.url));
    expect(back.id).not.toBe('orig');
    expect({ ...back, id: 'orig' }).toEqual(design);
  });

  it('is compact for an ordinary design', () => {
    expect(encodeDesign(textDesign('a', 'Shape')).length).toBeLessThan(MAX_SHARE_PARAM_CHARS / 4);
  });

  it('lets http(s) image sources travel as they are', () => {
    const d = imageDesign('i', 'https://example.org/cat.png');
    const r = shareLink(d, BASE, blobs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(designFromLink(paramOf(r.url)).sources.profile).toEqual(d.sources.profile);
  });

  it('refuses an image kept in the browser, and says why', () => {
    const r = shareLink(imageDesign('i', 'idb:abc123'), BASE, blobs);
    expect(r).toMatchObject({ ok: false, reason: 'local-image' });
    if (!r.ok) expect(r.message).toMatch(/file/);
  });

  it('refuses a design too big for a link, naming its largest part', () => {
    const d = bigDrawing(400);
    expect(encodeDesign(d).length).toBeGreaterThan(MAX_SHARE_PARAM_CHARS);
    const r = shareLink(d, BASE, blobs);
    expect(r).toMatchObject({ ok: false, reason: 'too-large' });
    if (!r.ok) expect(r.message).toMatch(/drawing source of "profile"/);
  });

  it('accepts a design just under the limit', () => {
    const r = shareLink(bigDrawing(30), BASE, blobs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(paramOf(r.url).length).toBeLessThanOrEqual(MAX_SHARE_PARAM_CHARS);
  });

  it('rejects damaged, foreign and invalid values with a message', () => {
    const good = encodeDesign(textDesign('a', 'Hi'));
    expect(() => designFromLink(good.slice(0, good.length - 10))).toThrow(/damaged/);
    expect(() => designFromLink('9.abc')).toThrow(/different version/);
    expect(() => designFromLink(`${SHARE_TAG}!!!`)).toThrow(/damaged/);
    const notADesign = encodeDesign({ version: 1, title: 'x' } as never);
    expect(() => designFromLink(notADesign)).toThrow(/valid design/);
    expect(() => designFromLink(SHARE_TAG + 'a'.repeat(MAX_INCOMING_PARAM_CHARS))).toThrow(/too long/);
  });

  it('reads the parameter from an address', () => {
    expect(sharedParam('?d=x&s=1.abc')).toBe('1.abc');
    expect(sharedParam('?d=x')).toBeNull();
  });
});
