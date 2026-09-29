/**
 * The 3D scene: draws a `Model` and builds nothing. Bodies become buffer geometries; diagnostic
 * regions (wall shadows, original slices, the section cap) become flat meshes from the kernel's
 * polygons, exact at any zoom. The model is millimetres with z up; this component turns it once
 * into three.js's y-up world.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Body, Design, Model, PlanarRegion } from 'shaping';
import { lightDirection, modelCentre, modelRadius } from './camera';
import { materialFor } from './materials';

/** Normals are smoothed across edges flatter than this, and kept sharp across steeper ones. */
export const CREASE_ANGLE_DEG = 32;

/** Colours of the diagnostic layers. */
export const REGION_STYLE = {
  target: { color: '#1f1d1a', opacity: 0.9 },
  achieved: { color: '#8f877a', opacity: 0.55 },
  missing: { color: '#e03a2f', opacity: 0.85 },
  slice: { color: '#1f6fd4', opacity: 0.45 },
  section: { color: '#e0b43a', opacity: 0.95 },
} as const;

/** Model (x, y, z; z up) to scene (x, z, -y; y up). */
const Z_UP_TO_Y_UP = new THREE.Euler(-Math.PI / 2, 0, 0);

function BodyMesh({ body, design, clip }: { body: Body; design: Design; clip: THREE.Plane[] }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(body.positions, 3));
    g.setIndex(new THREE.BufferAttribute(body.indices, 1));
    const creased = toCreasedNormals(g, (CREASE_ANGLE_DEG * Math.PI) / 180);
    g.dispose();
    return creased;
  }, [body]);
  const m = materialFor(design.style);
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshPhysicalMaterial
        color={body.color}
        roughness={m.roughness}
        metalness={m.metalness}
        clearcoat={m.clearcoat}
        transmission={m.transmission}
        thickness={m.thickness}
        ior={m.ior}
        opacity={m.opacity}
        transparent={m.transparent}
        clippingPlanes={clip}
        clipShadows
        side={clip.length ? THREE.DoubleSide : THREE.FrontSide}
      />
    </mesh>
  );
}

/** A planar region as a filled shape (and its outline), placed by its origin and (u, v) axes. */
function RegionMesh({ region, lift = 0 }: { region: PlanarRegion; lift?: number }) {
  const { fill, lines, matrix } = useMemo(() => {
    const shapes = region.polygons.map((p) => {
      const s = new THREE.Shape(p.outer.map(([x, y]) => new THREE.Vector2(x, y)));
      s.holes = p.holes.map((h) => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
      return s;
    });
    const fill = new THREE.ShapeGeometry(shapes);
    const pts: number[] = [];
    for (const p of region.polygons)
      for (const ring of [p.outer, ...p.holes])
        ring.forEach((a, i) => {
          const b = ring[(i + 1) % ring.length];
          pts.push(a[0], a[1], 0, b[0], b[1], 0);
        });
    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const u = new THREE.Vector3(...region.u);
    const v = new THREE.Vector3(...region.v);
    const n = new THREE.Vector3().crossVectors(u, v).normalize();
    const o = new THREE.Vector3(...region.origin).addScaledVector(n, lift);
    const matrix = new THREE.Matrix4().makeBasis(u, v, n).setPosition(o);
    return { fill, lines, matrix };
  }, [region, lift]);
  const style = REGION_STYLE[region.role];
  const outlineOnly = region.role === 'target';
  return (
    <group matrixAutoUpdate={false} matrix={matrix}>
      {!outlineOnly && (
        <mesh geometry={fill} renderOrder={2}>
          <meshBasicMaterial color={style.color} opacity={style.opacity} transparent side={THREE.DoubleSide} depthWrite={false} polygonOffset polygonOffsetFactor={-1} />
        </mesh>
      )}
      <lineSegments geometry={lines} renderOrder={3}>
        <lineBasicMaterial color={style.color} transparent opacity={outlineOnly ? style.opacity : Math.min(1, style.opacity + 0.3)} />
      </lineSegments>
    </group>
  );
}

/** Walls behind the shadow regions, so the shadows read as cast on something. */
function Walls({ regions }: { regions: PlanarRegion[] }) {
  const walls = useMemo(() => {
    const byWall = new Map<string, PlanarRegion>();
    for (const r of regions) if (r.role === 'target') byWall.set(r.id.split(':')[0], r);
    return [...byWall.values()].map((r) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of r.polygons) for (const [x, y] of p.outer) ((x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y)));
      const pad = 0.25 * Math.max(x1 - x0, y1 - y0);
      const u = new THREE.Vector3(...r.u);
      const v = new THREE.Vector3(...r.v);
      const n = new THREE.Vector3().crossVectors(u, v).normalize();
      const centre = new THREE.Vector3(...r.origin).addScaledVector(u, (x0 + x1) / 2).addScaledVector(v, (y0 + y1) / 2).addScaledVector(n, -0.05);
      const matrix = new THREE.Matrix4().makeBasis(u, v, n).setPosition(centre);
      return { id: r.id, matrix, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
    });
  }, [regions]);
  return (
    <>
      {walls.map((w) => (
        <group key={w.id} matrixAutoUpdate={false} matrix={w.matrix}>
          <mesh receiveShadow>
            <planeGeometry args={[w.w, w.h]} />
            <meshStandardMaterial color="#ffffff" roughness={0.95} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </>
  );
}

export interface SceneProps {
  design: Design;
  model: Model;
  /** Dim the model while a newer one is being built. */
  dimmed?: boolean;
  showSlices?: boolean;
}

export function Scene({ design, model, dimmed = false, showSlices = false }: SceneProps) {
  const view = design.view;
  const b = model.diagnostics.bbox;
  const r = modelRadius(b);
  const c = modelCentre(b);
  const light = lightDirection(view);
  const regions = model.diagnostics.regions;
  const wallRegions = view.walls ? regions.filter((x) => x.role === 'target' || x.role === 'achieved' || x.role === 'missing') : [];
  const section = view.section ? regions.find((x) => x.role === 'section') : undefined;
  // Keep the back half (model y >= cut), so the cut face looks at the default camera.
  const clip = useMemo(() => (section ? [new THREE.Plane(new THREE.Vector3(0, 0, -1), -section.origin[1])] : []), [section]);

  return (
    <>
      <ambientLight intensity={0.35} />
      <hemisphereLight args={['#ffffff', '#d8cfc0', 0.6]} />
      <directionalLight
        position={[c[0] + light[0] * r * 4, c[1] + light[1] * r * 4, c[2] + light[2] * r * 4]}
        intensity={view.lightIntensity}
        color={view.lightColor}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-r * 3}
        shadow-camera-right={r * 3}
        shadow-camera-top={r * 3}
        shadow-camera-bottom={-r * 3}
        shadow-camera-far={r * 12}
        shadow-bias={-0.0004}
      />
      <group rotation={Z_UP_TO_Y_UP}>
        <group visible>
          {model.bodies.map((body, i) => (
            <group key={`${body.partId}-${i}`}>
              <BodyMesh body={body} design={dimmed ? { ...design, style: { ...design.style, opacity: Math.min(design.style.opacity, 0.35) } } : design} clip={clip} />
            </group>
          ))}
        </group>
        {view.walls && <Walls regions={wallRegions} />}
        {wallRegions.map((reg) => (
          <RegionMesh key={reg.id} region={reg} lift={reg.role === 'target' ? 0.02 : reg.role === 'missing' ? 0.015 : 0.01} />
        ))}
        {showSlices && regions.filter((x) => x.role === 'slice').map((reg) => <RegionMesh key={reg.id} region={reg} />)}
        {section && <RegionMesh region={section} />}
      </group>
      {view.ground && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[c[0], 0, c[2]]} receiveShadow>
          <planeGeometry args={[r * 12, r * 12]} />
          <shadowMaterial opacity={0.22} />
        </mesh>
      )}
    </>
  );
}
