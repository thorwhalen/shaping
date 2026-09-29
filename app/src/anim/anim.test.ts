import { compile } from 'previz';
import { expand } from 'previz/formulas';
import { builtInGenres, newDesign } from 'shaping';
import { describe, expect, it } from 'vitest';
import { shapingFormulas } from './formulas';
import { captureKeyframe, emptySequence, moveKeyframe, removeKeyframe, updateKeyframe } from './sequence';
import { designWithState, shapingSpace, stateFromDesign } from './state';

for (const genreId of Object.keys(builtInGenres)) {
  const genre = builtInGenres[genreId];
  const design = newDesign(genreId, builtInGenres, { id: 'd' });

  describe(`animating ${genreId}`, () => {
    it('a state round-trips through the design', () => {
      const s = stateFromDesign(design, genre);
      const back = designWithState(design, s);
      expect(stateFromDesign(back, genre)).toEqual(s);
      expect(back.view).toEqual({ ...design.view });
    });

    it('captured views compile into a smooth sequence (camera orbits, colours mix)', () => {
      const space = shapingSpace(genre);
      const a = stateFromDesign(design, genre);
      const b = { ...a, camera: { ...a.camera, azimuth: a.camera.azimuth + 90, distance: a.camera.distance * 2 }, style: { ...a.style, color: '#2244ff' } };
      let seq = captureKeyframe(emptySequence(space), a, space);
      seq = captureKeyframe(seq, b, space);
      const reel = compile(seq);
      const mid = reel.at(reel.duration / 2) as typeof a;
      expect(mid.camera.azimuth).toBeGreaterThan(a.camera.azimuth);
      expect(mid.camera.azimuth).toBeLessThan(b.camera.azimuth);
      expect(mid.camera.distance).toBeGreaterThan(a.camera.distance);
      expect(mid.style.color).not.toBe(a.style.color);
      expect(reel.undeclared ?? []).toEqual([]);
    });

    it('every formula expands for this genre', () => {
      const space = shapingSpace(genre);
      const base = stateFromDesign(design, genre);
      for (const f of shapingFormulas(genre)) {
        const seq = expand(f, { base, space });
        expect(compile(seq).duration, f.id).toBeGreaterThan(0);
      }
    });
  });
}

describe('keyframe list', () => {
  it('moves, renames and removes', () => {
    const genre = builtInGenres.turned;
    const space = shapingSpace(genre);
    const s = stateFromDesign(newDesign('turned', builtInGenres, { id: 'x' }), genre);
    let seq = captureKeyframe(captureKeyframe(emptySequence(space), s, space), s, space);
    seq = updateKeyframe(seq, 0, { label: 'First', enter: { duration: 3 } });
    seq = moveKeyframe(seq, 0, 1);
    expect(seq.keyframes.map((k) => k.label)).toEqual(['View 2', 'First']);
    expect(seq.keyframes[1].enter?.duration).toBe(3);
    expect(removeKeyframe(seq, 0).keyframes).toHaveLength(1);
  });
});
