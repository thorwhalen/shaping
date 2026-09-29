/**
 * The shapes shared by every exporter: options, the `Exporter` record, and the 2D operations.
 *
 * An exporter is a pure, synchronous function `(model, options) => bytes` plus a row of metadata
 * (extension, media type, what the format can carry). The export menu is built from that metadata.
 */
import type { Model } from '../types.js';

/** What a laser or cutter does with a path. Stroke means cut or score; fill means engrave. */
export type Operation = 'cut' | 'score' | 'engrave';

/** Roles of a planar region, as produced by the build. */
export type RegionRole = 'target' | 'achieved' | 'missing' | 'slice' | 'section';

/** One colour per operation (hex `#rrggbb`); services differ, so this is a parameter. */
export type OperationColors = Record<Operation, string>;

export interface ExportOptions {
  /** Title written into 3MF metadata. Default: none. */
  title?: string;
  /** 2D files: which planar regions to write. Default: `['slice', 'target']`. */
  roles?: RegionRole[];
  /** 2D files: the operation the paths stand for. Default: `'cut'`. */
  operation?: Operation;
  /** 2D files: colour per operation. Default: red cut, blue score, black engrave. */
  operationColors?: Partial<OperationColors>;
  /** 2D files: gap between regions laid out left to right, in mm. Default: 5. */
  gap?: number;
  /** 2D files: laser kerf in mm. Outer contours move out, holes move in, by half of it. Default: 0. */
  kerf?: number;
  /** SVG: stroke width in mm. Default: 0.01 (hairline). */
  hairline?: number;
}

export interface ExporterCapabilities {
  /** The file can hold colour. */
  color: boolean;
  /** The file states its units (otherwise the size belongs in the file name). */
  units: boolean;
  /** The file can hold several separate bodies. */
  bodies: boolean;
}

export interface Exporter {
  id: string;
  title: string;
  extension: string;
  mediaType: string;
  kind: '3d' | '2d';
  carries: ExporterCapabilities;
  /** Pure and synchronous: the same model and options give the same bytes. */
  write(model: Model, options?: ExportOptions): Uint8Array;
}
