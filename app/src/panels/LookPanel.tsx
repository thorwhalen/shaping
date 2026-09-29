/** Materials, colour, light and view: the dials of the Design's `style` and `view` sections. */
import { StyleSchema, ViewSchema } from 'shaping';
import { Dials } from '../dials/Dials';
import { useApp } from '../state/store';

export function LookPanel({ onResetView, showSlices, setShowSlices }: { onResetView: () => void; showSlices: boolean; setShowSlices: (v: boolean) => void }) {
  const design = useApp((s) => s.design)!;
  const edit = useApp((s) => s.edit);
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
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">View and light</h3>
          <button className="rounded border border-line bg-white px-2 py-0.5 text-xs hover:border-muted" onClick={onResetView}>Reset view</button>
        </div>
        <Dials
          schema={ViewSchema}
          value={design.view}
          only={['camera', 'walls', 'ground', 'section', 'sectionOffset', 'azimuthDeg', 'elevationDeg', 'lightAzimuthDeg', 'lightElevationDeg', 'lightIntensity', 'lightColor']}
          onChange={(k, v) => edit((d) => void ((d.view as Record<string, unknown>)[k] = v))}
        />
        <label className="flex cursor-pointer items-center justify-between text-sm">
          <span>Show original slices</span>
          <input type="checkbox" className="h-4 w-4" checked={showSlices} onChange={(e) => setShowSlices(e.target.checked)} />
        </label>
      </section>
    </div>
  );
}
