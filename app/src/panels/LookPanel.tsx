/** Materials, colour, light and view: the dials of the Design's `style` and `view` sections. */
import { PART_PALETTE, recolor, StyleSchema, ViewSchema } from 'shaping';
import { Dials } from '../dials/Dials';
import { useApp } from '../state/store';

export function LookPanel({ onResetView, showSlices, setShowSlices }: { onResetView: () => void; showSlices: boolean; setShowSlices: (v: boolean) => void }) {
  const design = useApp((s) => s.design)!;
  const edit = useApp((s) => s.edit);
  const setView = (k: string, v: unknown) => edit((d) => void ((d.view as Record<string, unknown>)[k] = v));
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Material</h3>
        <Dials schema={StyleSchema} value={design.style} only={['material', 'color', 'palette', 'opacity', 'background']} onChange={(k, v) => edit((d) => void ((d.style as Record<string, unknown>)[k] = v))} />
        <details className="rounded-md border border-line bg-white/50 px-3 py-2">
          <summary className="cursor-pointer select-none text-sm">Advanced</summary>
          <div className="mt-2">
            <Dials schema={StyleSchema} value={design.style} only={['roughness', 'metalness']} onChange={(k, v) => edit((d) => void ((d.style as Record<string, unknown>)[k] = v))} />
          </div>
        </details>
      </section>
      <PartColours />
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Walls</h3>
        <Dials schema={ViewSchema} value={design.view} only={['room', 'wallGap', 'wallSize', 'ground']} onChange={setView} />
        <p className="text-xs text-muted">Walls between the camera and the object are cut away, so you always see the object.</p>
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Light</h3>
        <Dials schema={ViewSchema} value={design.view} only={['light']} onChange={setView} />
        {design.view.light === 'sun' && (
          <>
            <p className="text-xs text-muted">Drag the sun on the ball in the viewer's corner, or Shift + drag on the view.</p>
            {design.genre === 'shadow-blocks' && (
              <div className="flex items-center gap-1 text-xs">
                <span className="text-muted">Sun along</span>
                {WALL_LIGHTS.map((w) => (
                  <button key={w.label} className="flex-1 rounded border border-line bg-white px-2 py-0.5 hover:border-muted" onClick={() => edit((d) => void ((d.view.lightAzimuthDeg = w.az), (d.view.lightElevationDeg = w.el)))}>
                    {w.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {design.view.light === 'axes' && <p className="text-xs text-muted">Three parallel lights, one along each view: each casts its view's shadow on its own wall.</p>}
        {design.view.light === 'off' && <p className="text-xs text-muted">No direct light: only the fill light and reflections.</p>}
        <Dials
          schema={ViewSchema}
          value={design.view}
          only={[...(design.view.light === 'sun' ? ['lightAzimuthDeg', 'lightElevationDeg'] : []), ...(design.view.light !== 'off' ? ['lightIntensity', 'lightColor'] : []), 'fillIntensity', 'environmentIntensity']}
          onChange={setView}
        />
      </section>
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">View</h3>
          <button className="rounded border border-line bg-white px-2 py-0.5 text-xs hover:border-muted" onClick={onResetView}>Reset view</button>
        </div>
        <Dials schema={ViewSchema} value={design.view} only={['camera', 'azimuthDeg', 'elevationDeg', 'distance', 'fovDeg', 'zoom', 'section', 'sectionOffset']} onChange={setView} />
        <label className="flex cursor-pointer items-center justify-between text-sm">
          <span>Show original slices</span>
          <input type="checkbox" className="h-4 w-4" checked={showSlices} onChange={(e) => setShowSlices(e.target.checked)} />
        </label>
      </section>
    </div>
  );
}

/** Sun directions along each view's axis, so its real shadow falls on that wall (scene azimuth 0 looks from the front). */
const WALL_LIGHTS = [
  { label: 'Front', az: 0, el: 0 },
  { label: 'Side', az: 90, el: 0 },
  { label: 'Top', az: 0, el: 90 },
];

/** A colour for every component of the model: the body colours, editable one by one. */
function PartColours() {
  const model = useApp((s) => s.model);
  const edit = useApp((s) => s.edit);
  const style = useApp((s) => s.design!.style);
  // Colours are display fields: show them as the viewer and the exporters apply them.
  const bodies = model ? recolor(model, style).bodies : [];
  if (bodies.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Colours</h3>
        {Object.keys(style.partColors).length > 0 && (
          <button className="text-xs text-muted hover:text-ink" onClick={() => edit((d) => void (d.style.partColors = {}))}>
            Reset
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {bodies.map((b, i) => (
          <label key={`${b.partId}-${i}`} className="flex items-center gap-1 rounded border border-line bg-white px-1.5 py-0.5 text-xs" title={`Colour of ${b.partId}`}>
            <input
              type="color"
              aria-label={`Colour of ${b.partId}`}
              className="h-5 w-6 cursor-pointer"
              value={style.partColors[b.partId] ?? b.color ?? PART_PALETTE[i % PART_PALETTE.length]}
              onChange={(e) => edit((d) => void (d.style.partColors[b.partId] = e.target.value))}
            />
            {b.partId}
          </label>
        ))}
      </div>
    </section>
  );
}
