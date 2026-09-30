/**
 * DrawingCanvas: a controlled drawing surface that edits a `DrawingSource` (a list of objects).
 *
 * Tools: pen (pressure-aware), line, rectangle, ellipse (filled or outline), eraser. Size slider,
 * undo, redo, clear (undoable). Pointer events with capture and coalesced samples; shift constrains
 * lines to 45 degrees and rectangles/ellipses to squares/circles. Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z
 * work while the drawing area is focused. The canvas is only a rendering of the object list.
 *
 * The frame (the drawing's `width x height`) is drawn as a white rectangle with a border on a muted
 * ground, so placement and size are visible. Strokes may extend past the frame: the part outside is
 * drawn DIMMED (not clipped) on the muted ground, so the user sees that it is there and where it
 * ends, and can still pull it back in; only what is inside the frame counts as the shape.
 *
 * Zoom (wheel, pinch, `+`/`-` buttons and keys, `Fit`/`0`) and pan (Space+drag, middle button,
 * two-finger drag) go through a pure view transform (`./view`); pointer positions are converted
 * back to exact drawing coordinates, and stroke width is in drawing units so it scales with zoom.
 * The canvas fills its container width, is tall enough to show the whole frame at Fit for any
 * aspect ratio, and re-fits when the frame's size changes.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { canRedo, canUndo, historyReducer, initHistory, type History, type HistoryAction } from './history';
import { drawScene } from './render';
import { DEFAULT_PRESSURE, shapePoints, type DrawingSource, type DrawObject, type Point } from './strokes';
import {
  MAX_REL_ZOOM, MIN_REL_ZOOM, PINCH_ZOOM_RATE, WHEEL_ZOOM_RATE, ZOOM_STEP,
  fitView, fitZoom, panBy, screenToDrawing, viewportHeight, zoomAround, type Size, type View,
} from './view';

export interface DrawingCanvasProps {
  value: DrawingSource;
  onChange: (next: DrawingSource) => void;
  className?: string;
}

type ToolId = 'pen' | 'line' | 'rect' | 'ellipse' | 'eraser';

const TOOLS: { id: ToolId; label: string; icon: string }[] = [
  { id: 'pen', label: 'Pen', icon: 'M3 21l3.5-1 12-12a2.1 2.1 0 00-3-3l-12 12L3 21z' },
  { id: 'line', label: 'Line', icon: 'M4 20L20 4' },
  { id: 'rect', label: 'Rectangle', icon: 'M4 6h16v12H4z' },
  { id: 'ellipse', label: 'Ellipse', icon: 'M12 5c5 0 9 3 9 7s-4 7-9 7-9-3-9-7 4-7 9-7z' },
  { id: 'eraser', label: 'Eraser', icon: 'M8 20h12M5 15l9-9 5 5-6 6H8l-3-2z' },
];

const MIN_SIZE = 1;
const MAX_SIZE = 80;
const DEFAULT_SIZE = 12;
/** Movement (drawing units) below which a shape drag is treated as a click and discarded. */
const MIN_SHAPE_EXTENT = 1;
const MAX_DPR = 3;
const PAN_BUTTON = 1;
const KEYS_ZOOM_IN = ['+', '='];
const KEYS_ZOOM_OUT = ['-', '_'];
const KEY_FIT = '0';
const KEY_PAN = ' ';

/** A point in CSS pixels relative to the canvas element. */
interface Screen { x: number; y: number }
/** Centre and spread of two touch points: the state of a pinch / two-finger pan gesture. */
const pinchOf = (a: Screen, b: Screen) => ({ cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) });

const btn =
  'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded border px-2 text-sm transition-colors ' +
  'focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 disabled:cursor-not-allowed';
const btnIdle = 'border-line bg-paper text-ink hover:bg-line/50';
const btnActive = 'border-accent bg-accent text-white';

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function DrawingCanvas({ value, onChange, className }: DrawingCanvasProps) {
  const [tool, setTool] = useState<ToolId>('pen');
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [filled, setFilled] = useState(true);
  const [preview, setPreview] = useState<DrawObject | null>(null);
  const [, bump] = useState(0);
  const [grid, setGrid] = useState(false);
  const [box, setBox] = useState<Size>({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ zoom: 1, tx: 0, ty: 0 });
  const [panning, setPanning] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const boxRef = useRef(box);
  boxRef.current = box;
  const gridRef = useRef(grid);
  gridRef.current = grid;
  /** True until the user zooms or pans: then size changes re-fit, otherwise they keep the view. */
  const autoFitRef = useRef(true);
  const panRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const touchesRef = useRef(new Map<number, Screen>());
  const pinchRef = useRef<ReturnType<typeof pinchOf> | null>(null);
  const historyRef = useRef<History>(initHistory(value.objects));
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const dragRef = useRef<{ id: number; start: Point; points: Point[]; base: DrawObject } | null>(null);
  const previewRef = useRef<DrawObject | null>(null);
  previewRef.current = preview;

  // External edits to the object list replace the history; our own commits already match.
  if (value.objects !== historyRef.current.present) historyRef.current = initHistory(value.objects);
  const history = historyRef.current;

  const dispatch = useCallback((action: HistoryAction) => {
    const before = historyRef.current;
    const after = historyReducer(before, action);
    if (after === before) return;
    historyRef.current = after;
    bump((n) => n + 1);
    if (after.present !== before.present) {
      onChangeRef.current({ ...valueRef.current, objects: after.present as DrawObject[] });
    }
  }, []);

  const frameSize = (): Size => ({ w: valueRef.current.width, h: valueRef.current.height });

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const viewport = boxRef.current;
    if (!canvas || !ctx || viewport.w === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    drawScene(
      ctx,
      { view: viewRef.current, viewport, frame: frameSize(), grid: gridRef.current, dpr },
      historyRef.current.present,
      dragRef.current ? previewRef.current : null,
    );
  }, []);

  /** Set the view. `user` moves stop later size changes from re-fitting. */
  const applyView = useCallback((next: View, user = true) => {
    if (user) autoFitRef.current = false;
    viewRef.current = next;
    setView(next);
  }, []);

  const fit = useCallback(() => {
    autoFitRef.current = true;
    applyView(fitView(frameSize(), boxRef.current), false);
  }, [applyView]);

  // Track the container width; the canvas height follows the frame's aspect ratio.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = viewportHeight(w, { w: value.width, h: value.height });
      if (w !== boxRef.current.w || h !== boxRef.current.h) setBox({ w, h });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value.width, value.height]);

  // Keep the backing store matched to the CSS size and the device pixel ratio; re-fit when due.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || box.w === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.width = Math.max(1, Math.round(box.w * dpr));
    canvas.height = Math.max(1, Math.round(box.h * dpr));
    if (autoFitRef.current) applyView(fitView(frameSize(), box), false);
    redraw();
  }, [box, applyView, redraw]);

  // A different frame is a different drawing area: fit it again.
  useLayoutEffect(() => {
    if (boxRef.current.w > 0) fit();
  }, [value.width, value.height, fit]);

  useLayoutEffect(redraw, [redraw, view, grid, value.objects, value.width, value.height, preview]);

  const local = (e: { clientX: number; clientY: number }): Screen => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const zoomBy = (factor: number, at: Screen = { x: boxRef.current.w / 2, y: boxRef.current.h / 2 }) =>
    applyView(zoomAround(viewRef.current, factor, at.x, at.y, fitZoom(frameSize(), boxRef.current)));

  // Wheel zoom needs a non-passive listener so the page does not scroll.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const rate = e.ctrlKey ? PINCH_ZOOM_RATE : WHEEL_ZOOM_RATE;
      zoomBy(Math.exp(-e.deltaY * rate), { x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
    // zoomBy only reads refs and stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toPoint = (e: { clientX: number; clientY: number; pressure?: number; pointerType?: string }): Point => {
    const { x: sx, y: sy } = local(e);
    const [x, y] = screenToDrawing(viewRef.current, sx, sy);
    const p = e.pointerType === 'mouse' || !e.pressure ? DEFAULT_PRESSURE : e.pressure;
    return [x, y, p];
  };

  const build = (points: Point[], base: DrawObject, shift: boolean): DrawObject =>
    base.tool === 'pen'
      ? { ...base, points }
      : { ...base, points: shapePoints(base.tool, points[0], points[points.length - 1], shift) };

  const cancelDrawing = () => {
    dragRef.current = null;
    setPreview(null);
  };

  const startPan = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = local(e);
    panRef.current = { id: e.pointerId, x: p.x, y: p.y };
    setPanning(true);
  };

  /** Track touches; a second finger turns a drawing gesture into pinch-zoom plus two-finger pan. */
  const trackTouch = (e: PointerEvent<HTMLCanvasElement>): boolean => {
    if (e.pointerType !== 'touch') return false;
    touchesRef.current.set(e.pointerId, local(e));
    if (touchesRef.current.size < 2) return false;
    cancelDrawing();
    const [a, b] = [...touchesRef.current.values()];
    pinchRef.current = pinchOf(a, b);
    return true;
  };

  const movePinch = (e: PointerEvent<HTMLCanvasElement>) => {
    touchesRef.current.set(e.pointerId, local(e));
    const prev = pinchRef.current;
    if (!prev || touchesRef.current.size < 2) return;
    const [a, b] = [...touchesRef.current.values()];
    const now = pinchOf(a, b);
    const factor = prev.d > 0 ? now.d / prev.d : 1;
    const zoomed = zoomAround(viewRef.current, factor, prev.cx, prev.cy, fitZoom(frameSize(), boxRef.current));
    applyView(panBy(zoomed, now.cx - prev.cx, now.cy - prev.cy));
    pinchRef.current = now;
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.parentElement?.focus({ preventScroll: true });
    if (trackTouch(e)) return;
    if (e.button === PAN_BUTTON || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      return startPan(e);
    }
    if (e.button !== 0 || dragRef.current || pinchRef.current) return;
    const start = toPoint(e);
    const base: DrawObject = {
      tool: tool === 'eraser' ? 'pen' : tool,
      points: [start],
      size,
      filled: tool === 'rect' || tool === 'ellipse' ? filled : true,
      erase: tool === 'eraser',
    };
    dragRef.current = { id: e.pointerId, start, points: [start], base };
    setPreview(build([start], base, e.shiftKey));
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (pinchRef.current) return movePinch(e);
    const pan = panRef.current;
    if (pan && pan.id === e.pointerId) {
      const p = local(e);
      applyView(panBy(viewRef.current, p.x - pan.x, p.y - pan.y));
      panRef.current = { id: pan.id, x: p.x, y: p.y };
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId) return;
    const native = e.nativeEvent;
    const samples = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    for (const s of samples.length ? samples : [native]) drag.points.push(toPoint(s));
    setPreview(build(drag.points, drag.base, e.shiftKey));
  };

  const finish = (e: PointerEvent<HTMLCanvasElement>, commit: boolean) => {
    touchesRef.current.delete(e.pointerId);
    if (touchesRef.current.size < 2) pinchRef.current = null;
    if (panRef.current?.id === e.pointerId) {
      panRef.current = null;
      setPanning(false);
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId) return;
    if (commit) drag.points.push(toPoint(e));
    const obj = build(drag.points, drag.base, e.shiftKey);
    dragRef.current = null;
    setPreview(null);
    if (!commit) return;
    const [a, b] = obj.points;
    const degenerate = obj.tool !== 'pen' && Math.hypot(b[0] - a[0], b[1] - a[1]) < MIN_SHAPE_EXTENT;
    if (!degenerate) dispatch({ type: 'commit', object: obj });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === KEY_PAN) {
      e.preventDefault();
      return setSpaceDown(true);
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      return dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
    }
    if (KEYS_ZOOM_IN.includes(e.key)) zoomBy(ZOOM_STEP);
    else if (KEYS_ZOOM_OUT.includes(e.key)) zoomBy(1 / ZOOM_STEP);
    else if (e.key === KEY_FIT) fit();
    else return;
    e.preventDefault();
  };

  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === KEY_PAN) setSpaceDown(false);
  };

  const showFill = tool === 'rect' || tool === 'ellipse';
  const fitZ = box.w ? fitZoom({ w: value.width, h: value.height }, box) : 1;
  const zoomPct = Math.round((view.zoom / fitZ) * 100);
  const cursor = panning ? 'cursor-grabbing' : spaceDown ? 'cursor-grab' : 'cursor-crosshair';

  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      <div role="toolbar" aria-label="Drawing tools" className="flex flex-wrap items-center gap-1.5">
        <div role="group" aria-label="Tool" className="flex gap-1">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" title={t.label} aria-label={t.label} aria-pressed={tool === t.id}
              className={`${btn} ${tool === t.id ? btnActive : btnIdle}`} onClick={() => setTool(t.id)}>
              <Icon d={t.icon} />
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm text-muted" title="Stroke size (drawing units)">
          Size
          <input type="range" min={MIN_SIZE} max={MAX_SIZE} value={size} aria-label="Stroke size"
            onChange={(e) => setSize(Number(e.target.value))} className="w-24 accent-accent" />
          <span className="w-6 tabular-nums text-ink">{size}</span>
        </label>
        {/* Always rendered (disabled when irrelevant) so the toolbar does not shift between tools. */}
        <button type="button" disabled={!showFill} aria-pressed={filled} title="Fill rectangles and ellipses"
          className={`${btn} ${showFill && filled ? btnActive : btnIdle}`} onClick={() => setFilled((f) => !f)}>
          Filled
        </button>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
        <button type="button" className={`${btn} ${btnIdle}`} disabled={!canUndo(history)} title="Undo (Ctrl/Cmd+Z)"
          aria-label="Undo" onClick={() => dispatch({ type: 'undo' })}>
          <Icon d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />
        </button>
        <button type="button" className={`${btn} ${btnIdle}`} disabled={!canRedo(history)} title="Redo (Shift+Ctrl/Cmd+Z)"
          aria-label="Redo" onClick={() => dispatch({ type: 'redo' })}>
          <Icon d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" />
        </button>
        <button type="button" className={`${btn} ${btnIdle}`} disabled={history.present.length === 0}
          title="Clear the drawing (can be undone)" onClick={() => dispatch({ type: 'clear' })}>
          Clear
        </button>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
        <div role="group" aria-label="Zoom" className="flex items-center gap-1">
          <button type="button" className={`${btn} ${btnIdle}`} title="Zoom out (-)" aria-label="Zoom out"
            disabled={view.zoom <= fitZ * MIN_REL_ZOOM * 1.001} onClick={() => zoomBy(1 / ZOOM_STEP)}>
            &minus;
          </button>
          <span className="w-12 text-center text-sm tabular-nums text-ink" aria-live="polite" title="Zoom level">
            {zoomPct}%
          </span>
          <button type="button" className={`${btn} ${btnIdle}`} title="Zoom in (+)" aria-label="Zoom in"
            disabled={view.zoom >= fitZ * MAX_REL_ZOOM * 0.999} onClick={() => zoomBy(ZOOM_STEP)}>
            +
          </button>
          <button type="button" className={`${btn} ${btnIdle}`} title="Fit the frame to the area (0)" onClick={fit}>
            Fit
          </button>
          <button type="button" aria-pressed={grid} title="Show a grid inside the frame"
            className={`${btn} ${grid ? btnActive : btnIdle}`} onClick={() => setGrid((g) => !g)}>
            Grid
          </button>
        </div>
      </div>
      <div ref={frameRef} tabIndex={0} onKeyDown={onKeyDown} onKeyUp={onKeyUp} onBlur={() => setSpaceDown(false)}
        aria-label="Drawing area. Wheel to zoom; Space+drag or middle button to pan."
        className="w-full overflow-hidden rounded border border-line outline-none focus-visible:ring-2 focus-visible:ring-accent"
        style={{ height: box.h || undefined }}>
        <canvas ref={canvasRef} role="img" aria-label="Drawing canvas"
          className={`block ${cursor}`}
          style={{ touchAction: 'none', width: box.w || '100%', height: box.h || '100%' }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={(e) => finish(e, true)} onPointerCancel={(e) => finish(e, false)}
          onLostPointerCapture={(e) => finish(e, false)} onAuxClick={(e) => e.preventDefault()} />
      </div>
    </div>
  );
}
