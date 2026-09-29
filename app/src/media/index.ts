/** Media output for the app: GIF, video (WebCodecs) and PNG encoding, and saving. Plain TypeScript, no React. */
export { encodeGif, sampleFrameIndices, globalPalette, frameDelayMs, type GifOptions, type RenderFrame } from './gif';
export { encodeVideo, supportsVideo, pickCodec, evenDimension, defaultBitrate, CODEC_CANDIDATES, type VideoOptions, type VideoResult } from './video';
export { canvasToPng, saveBytes, pickSaveHandle, type PngOptions, type SaveHandle } from './png';
