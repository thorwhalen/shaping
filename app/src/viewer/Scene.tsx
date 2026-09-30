/**
 * The 3D scene: draws a `Model` and builds nothing. Bodies become buffer geometries; diagnostic
 * regions (wall shadows, original slices, the section cap) become flat meshes from the kernel's
 * polygons, exact at any zoom. The model is millimetres with z up; this component turns it once
 * into three.js's y-up world.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { recolor, type Body, type Design, type Model, type PlanarRegion } from 'shaping';
import { lightDirection, modelCentre, modelRadius } from './camera';
import { materialFor } from './materials';
import { roomPlanes, type RoomPlane } from './room';

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

/** Where a wall is (model coordinates) and which way it faces (toward the object). */
interface WallCull {
  origin: THREE.Vector3;
  normal: THREE.Vector3;
}

/**
 * Hide every wall the camera stands behind, so a wall never blocks the view of the object (a
 * modelling tool's cut-away). Runs for the screen camera each frame and for an export's camera
 * right before it renders, so a captured frame shows what the screen shows.
 */
export function cullWalls(root: THREE.Object3D, camera: THREE.Camera) {
  const eye = new THREE.Vector3();
  camera.getWorldPosition(eye);
  root.traverse((o) => {
    const cull = o.userData.cull as WallCull | undefined;
    if (!cull || !o.parent) return;
    const point = o.parent.localToWorld(cull.origin.clone());
    const normal = cull.normal.clone().transformDirection(o.parent.matrixWorld);
    o.visible = normal.dot(eye.sub(point)) > 0;
    camera.getWorldPosition(eye);
  });
}

/**
 * The three axis lights, in scene coordinates (y up): parallel light from infinitely far along each
 * view's axis, so each casts its view's shadow on its own wall and grazes the other two. The model's
 * front view looks along +y (from scene +z), the side view along -x (from scene +x), the top view
 * down (from scene +y).
 */
const AXIS_LIGHTS: Array<[number, number, number]> = [
  [0, 0, 1],
  [1, 0, 0],
  [0, 1, 0],
];
/** Each axis light's share of the light intensity dial. */
const AXIS_LIGHT_SHARE = 0.6;

/** Walls read as walls on any background: a warm grey, with a thin darker edge on room walls. */
const WALL_COLOR = '#e4ded3';
const WALL_EDGE_COLOR = '#b9b1a3';

/** Share of the fill light given to the ambient term (the rest is the sky/ground hemisphere). */
const AMBIENT_SHARE_OF_FILL = 0.5;
/** Pushes shadow lookups off curved inner walls, against speckled self-shadowing. */
const SHADOW_NORMAL_BIAS_PER_RADIUS = 0.004;

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
  useEffect(() => () => geometry.dispose(), [geometry]);
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
  useEffect(() => () => (fill.dispose(), lines.dispose()), [fill, lines]);
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
function Walls({ regions, size }: { regions: PlanarRegion[]; size: number }) {
  const walls = useMemo(() => {
    const byWall = new Map<string, PlanarRegion>();
    for (const r of regions) if (r.role === 'target') byWall.set(r.id.split(':')[0], r);
    return [...byWall.values()].map((r) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of r.polygons) for (const [x, y] of p.outer) ((x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y)));
      const pad = ((size - 1) / 2) * Math.max(x1 - x0, y1 - y0);
      const u = new THREE.Vector3(...r.u);
      const v = new THREE.Vector3(...r.v);
      const n = new THREE.Vector3().crossVectors(u, v).normalize();
      const centre = new THREE.Vector3(...r.origin).addScaledVector(u, (x0 + x1) / 2).addScaledVector(v, (y0 + y1) / 2).addScaledVector(n, -0.05);
      const matrix = new THREE.Matrix4().makeBasis(u, v, n).setPosition(centre);
      return { id: r.id, matrix, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
    });
  }, [regions, size]);
  return (
    <>
      {walls.map((w) => (
        <group key={w.id} matrixAutoUpdate={false} matrix={w.matrix}>
          <mesh receiveShadow>
            <planeGeometry args={[w.w, w.h]} />
            <meshStandardMaterial color={WALL_COLOR} roughness={0.95} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </>
  );
}

/** One big wall of a corner or a box room; it hides itself when the camera is behind it. */
function RoomWall({ wall }: { wall: RoomPlane }) {
  const matrix = useMemo(() => {
    const u = new THREE.Vector3(...wall.u);
    const v = new THREE.Vector3(...wall.v);
    const n = new THREE.Vector3().crossVectors(u, v);
    return new THREE.Matrix4().makeBasis(u, v, n).setPosition(new THREE.Vector3(...wall.centre));
  }, [wall]);
  const cull = useMemo(() => ({ origin: new THREE.Vector3(...wall.centre), normal: new THREE.Vector3(...wall.inward) }) satisfies WallCull, [wall]);
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(wall.width, wall.height)), [wall.width, wall.height]);
  useEffect(() => () => edges.dispose(), [edges]);
  return (
    <group userData={{ cull }}>
      <group matrixAutoUpdate={false} matrix={matrix}>
        <lineSegments renderOrder={1} geometry={edges}>
          <lineBasicMaterial color={WALL_EDGE_COLOR} />
        </lineSegments>
        <mesh receiveShadow>
          <planeGeometry args={[wall.width, wall.height]} />
          <meshStandardMaterial color={WALL_COLOR} roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
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
  // The sun aims at the model's centre (by default a directional light aims at the origin).
  const sunTarget = useMemo(() => new THREE.Object3D(), []);
  // Colours are display fields: the model is coloured here, exactly as the exporters colour it.
  const coloured = useMemo(() => recolor(model, design.style), [model, design.style]);
  const b = model.diagnostics.bbox;
  const r = modelRadius(b);
  const c = modelCentre(b);
  const light = lightDirection(view);
  const regions = model.diagnostics.regions;
  const room = view.room;
  const wallRegions = room !== 'none' ? regions.filter((x) => x.role === 'target' || x.role === 'achieved' || x.role === 'missing') : [];
  const bigWalls = useMemo(() => roomPlanes(model, view), [model, view.room, view.wallGap]); // eslint-disable-line react-hooks/exhaustive-deps
  // One group per wall (a view's slot), which hides itself when the camera is behind it.
  const wallSlots = useMemo(() => {
    const centre = new THREE.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    const bySlot = new Map<string, PlanarRegion[]>();
    for (const reg of wallRegions) {
      const id = reg.id.split(':')[0];
      bySlot.set(id, [...(bySlot.get(id) ?? []), reg]);
    }
    return [...bySlot].map(([id, regs]) => {
      const r0 = regs[0];
      const origin = new THREE.Vector3(...r0.origin);
      const normal = new THREE.Vector3().crossVectors(new THREE.Vector3(...r0.u), new THREE.Vector3(...r0.v)).normalize();
      if (normal.dot(centre.clone().sub(origin)) < 0) normal.negate();
      return { id, regions: regs, cull: { origin, normal } satisfies WallCull };
    });
  }, [wallRegions, b]);
  useFrame(({ scene, camera }) => cullWalls(scene, camera));
  const section = view.section ? regions.find((x) => x.role === 'section') : undefined;
  // Keep the back half (model y >= cut), so the cut face looks at the default camera.
  const clip = useMemo(() => (section ? [new THREE.Plane(new THREE.Vector3(0, 0, -1), -section.origin[1])] : []), [section]);

  return (
    <>
      <ambientLight intensity={view.fillIntensity * AMBIENT_SHARE_OF_FILL} />
      <hemisphereLight args={['#ffffff', '#d8cfc0', view.fillIntensity]} />
      <primitive object={sunTarget} position={c} />
      {view.light === 'axes' &&
        AXIS_LIGHTS.map((dir, i) => (
          <directionalLight
            key={i}
            target={sunTarget}
            position={[c[0] + dir[0] * r * 4, c[1] + dir[1] * r * 4, c[2] + dir[2] * r * 4]}
            intensity={view.lightIntensity * AXIS_LIGHT_SHARE}
            color={view.lightColor}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-camera-left={-r * 4}
            shadow-camera-right={r * 4}
            shadow-camera-top={r * 4}
            shadow-camera-bottom={-r * 4}
            shadow-camera-far={r * 12}
            shadow-bias={-0.0004}
            shadow-normalBias={r * SHADOW_NORMAL_BIAS_PER_RADIUS}
          />
        ))}
      {view.light === 'sun' && <directionalLight
        target={sunTarget}
        position={[c[0] + light[0] * r * 4, c[1] + light[1] * r * 4, c[2] + light[2] * r * 4]}
        intensity={view.lightIntensity}
        color={view.lightColor}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-r * 4}
        shadow-camera-right={r * 4}
        shadow-camera-top={r * 4}
        shadow-camera-bottom={-r * 4}
        shadow-camera-far={r * 12}
        shadow-bias={-0.0004}
        shadow-normalBias={r * SHADOW_NORMAL_BIAS_PER_RADIUS}
      />}
      <group rotation={Z_UP_TO_Y_UP}>
        <group visible>
          {coloured.bodies.map((body, i) => (
            <group key={`${body.partId}-${i}`}>
              <BodyMesh body={body} design={dimmed ? { ...design, style: { ...design.style, opacity: Math.min(design.style.opacity, 0.35) } } : design} clip={clip} />
            </group>
          ))}
        </group>
        {bigWalls.map((w) => (
          <RoomWall key={w.id} wall={w} />
        ))}
        {wallSlots.map((slot) => (
          <group key={slot.id} userData={{ cull: slot.cull }}>
            {room === 'shadow' && <Walls regions={slot.regions} size={view.wallSize} />}
            {slot.regions.map((reg) => (
              <RegionMesh key={reg.id} region={reg} lift={reg.role === 'target' ? 0.02 : reg.role === 'missing' ? 0.015 : 0.01} />
            ))}
          </group>
        ))}
        {showSlices && regions.filter((x) => x.role === 'slice').map((reg) => <RegionMesh key={reg.id} region={reg} />)}
        {section && <RegionMesh region={section} />}
      </group>
      {view.ground && (room === 'none' || (room === 'shadow' && !wallRegions.length)) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[c[0], 0, c[2]]} receiveShadow>
          <planeGeometry args={[r * 12, r * 12]} />
          <shadowMaterial opacity={0.22} />
        </mesh>
      )}
    </>
  );
}
