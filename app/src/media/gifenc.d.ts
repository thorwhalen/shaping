/** Minimal type declarations for the parts of `gifenc` (which ships none) used by `gif.ts`. */
declare module 'gifenc' {
  export type Rgb = [number, number, number];
  export interface GifWriteOptions {
    palette?: Rgb[];
    /** Frame delay in milliseconds (stored in centiseconds). */
    delay?: number;
    /** Loop count; 0 means forever, -1 means play once. */
    repeat?: number;
  }
  export interface GifEncoder {
    writeFrame(index: Uint8Array, width: number, height: number, options?: GifWriteOptions): void;
    finish(): void;
    bytes(): Uint8Array;
  }
  export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): GifEncoder;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: { format?: 'rgb565' | 'rgb444' | 'rgba4444' }): Rgb[];
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Rgb[], format?: 'rgb565' | 'rgb444' | 'rgba4444'): Uint8Array;
}
