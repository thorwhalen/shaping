/**
 * DrawingCanvas: a controlled drawing surface that edits a `DrawingSource` (a list of objects).
 *
 * Tools: pen (pressure-aware), line, rectangle, ellipse (filled or outline), eraser. Size slider,
 * undo, redo, clear (undoable). Pointer events with capture and coalesced samples; shift constrains
 * lines to 45 degrees and rectangles/ellipses to squares/circles. Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z
 * work while the drawing area is focused. The canvas is only a rendering of the object list.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { canRedo, canUndo, historyReducer, initHistory, type History, type HistoryAction } from './history';
import { drawAll } from './render';
import { DEFAULT_PRESSURE, shapePoints, type DrawingSource, type DrawObject, type Point } from './strokes';

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

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef({ w: 0, h: 0 });
  const historyRef = useRef<History>(initHistory(value.objects));
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const dragRef = useRef<{ id: number; start: Point; points: Point[]; base: DrawObject } | null>(null);

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

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const { w } = boxRef.current;
    if (!canvas || !ctx || w === 0) return;
    const { width, height } = valueRef.current;
    const scale = (w * Math.min(window.devicePixelRatio || 1, MAX_DPR)) / width;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawAll(ctx, width, height, historyRef.current.present, dragRef.current ? previewRef.current : null);
  }, []);
  const previewRef = useRef<DrawObject | null>(null);
  previewRef.current = preview;

  // Keep the backing store matched to the element's CSS size and the device pixel ratio.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      boxRef.current = { w: rect.width, h: rect.height };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [redraw]);

  useLayoutEffect(redraw, [redraw, value.objects, value.width, value.height, preview]);

  const toPoint = (e: { clientX: number; clientY: number; pressure?: number; pointerType?: string }): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * value.width) / rect.width;
    const y = ((e.clientY - rect.top) * value.height) / rect.height;
    const p = e.pointerType === 'mouse' || !e.pressure ? DEFAULT_PRESSURE : e.pressure;
    return [x, y, p];
  };

  const build = (points: Point[], base: DrawObject, shift: boolean): DrawObject =>
    base.tool === 'pen'
      ? { ...base, points }
      : { ...base, points: shapePoints(base.tool, points[0], points[points.length - 1], shift) };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || dragRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.parentElement?.focus({ preventScroll: true });
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
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId) return;
    const native = e.nativeEvent;
    const samples = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    for (const s of samples.length ? samples : [native]) drag.points.push(toPoint(s));
    setPreview(build(drag.points, drag.base, e.shiftKey));
  };

  const finish = (e: PointerEvent<HTMLCanvasElement>, commit: boolean) => {
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
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
    e.preventDefault();
    dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
  };

  const showFill = tool === 'rect' || tool === 'ellipse';

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
        <label className="flex items-center gap-1.5 text-sm text-muted" title="Stroke size">
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
      </div>
      <div tabIndex={0} onKeyDown={onKeyDown} aria-label="Drawing area"
        className="w-full overflow-hidden rounded border border-line bg-white outline-none focus-visible:ring-2 focus-visible:ring-accent"
        style={{ aspectRatio: `${value.width} / ${value.height}` }}>
        <canvas ref={canvasRef} role="img" aria-label="Drawing canvas"
          className="block h-full w-full cursor-crosshair"
          style={{ touchAction: 'none' }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={(e) => finish(e, true)} onPointerCancel={(e) => finish(e, false)}
          onLostPointerCapture={(e) => finish(e, false)} />
      </div>
    </div>
  );
}
