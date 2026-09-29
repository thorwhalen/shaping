/**
 * The light ball: a small lighting sphere in the corner of the viewer, drawn as seen from the
 * current camera, with the sun as a dot on it. Drag the dot and the light follows where you drag,
 * in the view you are looking at, at any zoom. It writes the Design's `lightAzimuthDeg` and
 * `lightElevationDeg` — the same two fields the sliders edit, so there is nothing to keep in sync.
 *
 * Keyboard: arrows move the light 5° (1° with Shift). Double-click resets it. Ctrl snaps to 15°.
 * Shift + drag on the 3D view does the same as dragging the dot (see `useShiftDragLight`).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ViewSchema, type View } from 'shaping';
import { cameraView } from './Viewer';

const SIZE_PX = 76;
const R = SIZE_PX / 2 - 6;
const KEY_STEP_DEG = 5;
const FINE_STEP_DEG = 1;
const SNAP_DEG = 15;
/** Degrees of light rotation per pixel of Shift + drag on the canvas. */
const DRAG_DEG_PER_PX = 0.4;
const DEFAULTS = ViewSchema.parse({});
const EL_MIN = 0;
const EL_MAX = 90;

type V3 = [number, number, number];
const norm = (v: V3): V3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Light angles (scene convention, see camera.ts) to a unit direction, and back. */
export function lightDir(azDeg: number, elDeg: number): V3 {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}
export function lightAngles(d: V3): { az: number; el: number } {
  const el = (Math.asin(Math.max(-1, Math.min(1, d[1]))) * 180) / Math.PI;
  const az = (Math.atan2(d[0], d[2]) * 180) / Math.PI;
  return { az, el: Math.max(EL_MIN, Math.min(EL_MAX, el)) };
}

/** The camera's screen axes in scene coordinates: right, up, toward the viewer. */
function viewBasis(toCamera: V3): { right: V3; up: V3; back: V3 } {
  const back = norm(toCamera);
  const worldUp: V3 = Math.abs(back[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0];
  const right = norm(cross(worldUp, back));
  return { right, up: cross(back, right), back };
}

const snap = (deg: number, on: boolean) => (on ? Math.round(deg / SNAP_DEG) * SNAP_DEG : deg);

export interface LightBallProps {
  view: View;
  onChange: (az: number, el: number) => void;
}

export function LightBall({ view, onChange }: LightBallProps) {
  const toCam = useSyncExternalStore(cameraView.subscribe, cameraView.get);
  const [dragging, setDragging] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const basis = viewBasis(toCam);
  const d = lightDir(view.lightAzimuthDeg, view.lightElevationDeg);
  const x = dot(d, basis.right), y = dot(d, basis.up), z = dot(d, basis.back);
  const front = z >= 0;

  const fromPointer = useCallback(
    (clientX: number, clientY: number, snapOn: boolean) => {
      const box = svg.current!.getBoundingClientRect();
      let px = (clientX - box.left - SIZE_PX / 2) / R;
      let py = -(clientY - box.top - SIZE_PX / 2) / R;
      const l = Math.hypot(px, py);
      if (l > 1) ((px /= l), (py /= l));
      // Keep the hemisphere the sun is on: in front of the object, or behind it.
      const pz = (front ? 1 : -1) * Math.sqrt(Math.max(0, 1 - px * px - py * py));
      const world = norm([0, 1, 2].map((i) => px * basis.right[i] + py * basis.up[i] + pz * basis.back[i]) as V3);
      const a = lightAngles(world);
      onChange(snap(a.az, snapOn), snap(a.el, snapOn));
    },
    [basis, front, onChange],
  );

  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? FINE_STEP_DEG : KEY_STEP_DEG;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    onChange(view.lightAzimuthDeg + m[0], Math.max(EL_MIN, Math.min(EL_MAX, view.lightElevationDeg + m[1])));
  };

  return (
    <div className="pointer-events-auto absolute bottom-14 right-3 flex flex-col items-center gap-1 opacity-70 transition-opacity hover:opacity-100 focus-within:opacity-100">
      <svg
        ref={svg}
        width={SIZE_PX}
        height={SIZE_PX}
        role="slider"
        tabIndex={0}
        aria-label="Light direction: drag the sun, arrows to nudge, double-click to reset"
        aria-valuetext={`azimuth ${Math.round(view.lightAzimuthDeg)}°, elevation ${Math.round(view.lightElevationDeg)}°`}
        className="cursor-grab touch-none rounded-full focus:outline-2 focus:outline-accent active:cursor-grabbing"
        onKeyDown={onKey}
        onDoubleClick={() => onChange(DEFAULTS.lightAzimuthDeg, DEFAULTS.lightElevationDeg)}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          setDragging(true);
          fromPointer(e.clientX, e.clientY, e.ctrlKey);
        }}
        onPointerMove={(e) => dragging && fromPointer(e.clientX, e.clientY, e.ctrlKey)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        <defs>
          <radialGradient id="light-ball-shade" cx={0.5 + 0.35 * x} cy={0.5 - 0.35 * y} r="0.75">
            <stop offset="0" stopColor={front ? '#ffffff' : '#d8d2c6'} />
            <stop offset="0.55" stopColor="#c9c1b2" />
            <stop offset="1" stopColor="#6f685d" />
          </radialGradient>
        </defs>
        <circle cx={SIZE_PX / 2} cy={SIZE_PX / 2} r={R} fill="url(#light-ball-shade)" stroke="#8f877a" strokeWidth={1} />
        <circle
          cx={SIZE_PX / 2 + x * R}
          cy={SIZE_PX / 2 - y * R}
          r={6}
          fill={front ? '#f2b33d' : 'none'}
          stroke="#b0781a"
          strokeWidth={2}
        >
          <title>{front ? 'The sun, in front of the object' : 'The sun, behind the object'}</title>
        </circle>
      </svg>
      <span className="rounded bg-white/80 px-1 text-[10px] tabular-nums text-muted">
        {dragging ? `az ${Math.round(view.lightAzimuthDeg)}° · el ${Math.round(view.lightElevationDeg)}°` : 'light'}
      </span>
    </div>
  );
}

/**
 * Shift + drag on the 3D view turns the light instead of the camera: horizontal movement changes
 * the azimuth, vertical the elevation. Returns pointer handlers for the viewer's container; they
 * run in the capture phase so the orbit controls never see a Shift-drag.
 */
export function useShiftDragLight(view: View, onChange: (az: number, el: number) => void) {
  const start = useRef<{ x: number; y: number; az: number; el: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => () => void (start.current = null), []);
  return {
    onPointerDownCapture(e: React.PointerEvent) {
      if (!e.shiftKey) return;
      e.stopPropagation();
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      start.current = { x: e.clientX, y: e.clientY, az: viewRef.current.lightAzimuthDeg, el: viewRef.current.lightElevationDeg };
    },
    onPointerMoveCapture(e: React.PointerEvent) {
      const s = start.current;
      if (!s) return;
      e.stopPropagation();
      const az = snap(s.az + (e.clientX - s.x) * DRAG_DEG_PER_PX, e.ctrlKey);
      const el = snap(Math.max(EL_MIN, Math.min(EL_MAX, s.el - (e.clientY - s.y) * DRAG_DEG_PER_PX)), e.ctrlKey);
      onChange(az, el);
    },
    onPointerUpCapture(e: React.PointerEvent) {
      if (start.current) e.stopPropagation();
      start.current = null;
    },
  };
}
