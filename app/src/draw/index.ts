/** Public surface of the drawing canvas: the component and the pure helpers shared with figure conversion. */
export { DrawingCanvas, type DrawingCanvasProps } from './DrawingCanvas';
export { PEN_OPTIONS, strokeOutline, shapePoints, shapePolygon, type DrawingSource, type DrawObject } from './strokes';
export { historyReducer, initHistory, type History, type HistoryAction } from './history';
