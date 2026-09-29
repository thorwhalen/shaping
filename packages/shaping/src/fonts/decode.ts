/// <reference path="./opentype.d.ts" />
/**
 * From the bytes of a font file to the bytes of a plain TrueType or OpenType font.
 *
 * TTF, OTF and WOFF (zlib) are read directly by the parser. WOFF2 (Brotli, with a transformed
 * `glyf` table, and the only form in which Fontsource ships variable fonts) is decoded to TTF by
 * `woff2-encoder` (Google's woff2 decoder compiled to WebAssembly, ESM, works in browsers and Node),
 * loaded only when a WOFF2 file shows up.
 */

/** The four-byte signature that opens a WOFF2 file: "wOF2". */
const WOFF2_SIGNATURE = 0x774f4632;
const SIGNATURE_BYTES = 4;

/** True for WOFF2 bytes. */
export function isWoff2(bytes: Uint8Array): boolean {
  return bytes.byteLength >= SIGNATURE_BYTES && new DataView(bytes.buffer, bytes.byteOffset, SIGNATURE_BYTES).getUint32(0) === WOFF2_SIGNATURE;
}

/** Decode WOFF2 to TTF; any other format is returned as it is. */
export async function toSfnt(bytes: Uint8Array): Promise<Uint8Array> {
  if (!isWoff2(bytes)) return bytes;
  const { decompress } = await import('woff2-encoder');
  return decompress(bytes);
}
