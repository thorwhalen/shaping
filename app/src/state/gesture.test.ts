import { describe, expect, it } from 'vitest';
import { useApp } from './store';

describe('overlapping gestures', () => {
  it('stay on until the last one ends', () => {
    const { setGesture } = useApp.getState();
    setGesture(true); // a geometry drag, released, still waiting for its model
    setGesture(true); // a camera drag starts meanwhile
    setGesture(false); // the geometry model lands
    expect(useApp.getState().gesturing).toBe(true);
    setGesture(false);
    expect(useApp.getState().gesturing).toBe(false);
    setGesture(false); // an extra end never goes below zero
    setGesture(true);
    expect(useApp.getState().gesturing).toBe(true);
    setGesture(false);
  });
});
