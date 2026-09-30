/**
 * The viewer: one WebGL canvas (react-three-fiber), orbit controls, a perspective or orthographic
 * camera, and a `capture` hook that renders any design + model offscreen at an exact size — the
 * deterministic frame loop that PNG, GIF and video export use. Thumbnails and frames reuse this
 * one renderer; a second WebGL context could blank the first.
 */
import { Environment, Lightformer, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type { Design, Model, View } from 'shaping';
import { cameraFor, clampPose, framingBox, modelRadius, POSE_BOUNDS, poseFromCamera, samePose, type CameraSpec } from './camera';
import { cullWalls, Scene } from './Scene';

export interface CaptureRequest {
  design: Design;
  model: Model;
  width: number;
  height: number;
  transparent?: boolean;
}

/** Renders a frame offscreen and returns its pixels. Set once the canvas is ready. */
export const captureRef: { current: ((r: CaptureRequest) => Promise<ImageData>) | null } = { current: null };
/** Swaps what the scene shows (for capture) and waits until it has been drawn. */
const frameOverride: { set: ((o: { design: Design; model: Model } | null) => void) | null } = { set: null };

/** The object never shrinks below this many pixels across when zooming out. */
export const MIN_OBJECT_PX = 90;
/** The camera never comes closer to the centre than this many model radii. */
const MIN_DISTANCE_RADII = 1.1;

/**
 * Where the camera looks from: the unit vector from the orbit target to the camera, in scene
 * coordinates, published as the user orbits so overlays (the light ball) stay aligned with the view.
 */
export const cameraView = (() => {
  let dir: [number, number, number] = [0, 0, 1];
  const subs = new Set<() => void>();
  return {
    get: () => dir,
    set(camera: THREE.Camera, target: THREE.Vector3) {
      const v = camera.position.clone().sub(target).normalize();
      if (v.distanceTo(new THREE.Vector3(...dir)) < 1e-3) return;
      dir = [v.x, v.y, v.z];
      subs.forEach((f) => f());
    },
    subscribe(f: () => void) {
      subs.add(f);
      return () => void subs.delete(f);
    },
  };
})();

/** Store a camera movement that is still settling, now (e.g. right before capturing the view). */
export const flushPose: { current: () => void } = { current: () => undefined };

/** Pause after the last orbit movement (damping included) before the pose is written back. */
const POSE_WRITEBACK_MS = 250;

/** Set up a three.js camera from a spec: the one place screen and export cameras are configured. */
export function applyCamera(cam: THREE.PerspectiveCamera | THREE.OrthographicCamera, spec: CameraSpec, aspect: number) {
  if (cam instanceof THREE.PerspectiveCamera) {
    cam.fov = spec.fovDeg;
    cam.aspect = aspect;
    cam.zoom = 1;
  } else {
    cam.left = -spec.halfHeight * aspect;
    cam.right = spec.halfHeight * aspect;
    cam.top = spec.halfHeight;
    cam.bottom = -spec.halfHeight;
    cam.zoom = spec.zoom;
  }
  cam.near = spec.near;
  cam.far = spec.far;
  cam.position.set(...spec.position);
  cam.up.set(0, 1, 0);
  cam.lookAt(...spec.target);
  cam.updateProjectionMatrix();
}

/**
 * The on-screen camera: placed from the shown design's pose (so a preview or a played sequence
 * moves it), and orbiting with the mouse writes the pose back into the design (so what is stored,
 * and what an export renders, is always what is on screen).
 */
function CameraRig({ design, model, resetKey, onPose }: { design: Design; model: Model; resetKey: number; onPose: (pose: Partial<View>) => void }) {
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const { camera, size } = useThree();
  const box = framingBox(model, design.view);
  const r = modelRadius(box);
  const v = design.view;
  const spec = cameraFor(v, box);
  const aspect = size.width / Math.max(1, size.height);
  const boxKey = [...box.min, ...box.max].map((x) => x.toFixed(3)).join(',');
  const userMoving = useRef(false);
  const gestureEnded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const writeBackRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    // A write-back still pending (the user just moved): store it first, so this re-application
    // (a resize, a rebuild changing the frame) never throws the user's movement away.
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
      timer.current = undefined;
      writeBackRef.current();
      return;
    }
    const cam = camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    const c = controls.current;
    // Skip when the camera is already there (e.g. this change is our own write-back).
    const here = c ? poseFromCamera(cam.position.toArray() as [number, number, number], c.target.toArray() as [number, number, number], cam.zoom, box, v.camera) : null;
    if (here && samePose(here, v) && (!(cam instanceof THREE.PerspectiveCamera) || cam.fov === spec.fovDeg) && (cam instanceof THREE.PerspectiveCamera ? cam.aspect === aspect : cam.top === spec.halfHeight && cam.right === spec.halfHeight * aspect)) return;
    applyCamera(cam, spec, aspect);
    c?.target.set(...spec.target);
    c?.update();
    if (c) cameraView.set(cam, c.target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.azimuthDeg, v.elevationDeg, v.distance, v.panX, v.panY, v.panZ, v.fovDeg, v.zoom, v.camera, boxKey, aspect, resetKey, camera]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const writeBack = () => {
    timer.current = undefined;
    const c = controls.current;
    if (!c) return;
    const cam = camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    const pose = clampPose(poseFromCamera(cam.position.toArray() as [number, number, number], c.target.toArray() as [number, number, number], cam.zoom, box, v.camera));
    // The gesture is over only once the pointer was released and the camera has settled since.
    if (gestureEnded.current) userMoving.current = false;
    if (!samePose(pose, v)) onPose(pose);
  };
  writeBackRef.current = writeBack;
  flushPose.current = () => {
    if (timer.current === undefined) return;
    clearTimeout(timer.current);
    writeBack();
  };

  // Zoom limits from the object's size on screen: never smaller than MIN_OBJECT_PX, never inside it.
  // Limits come from the object itself, not the framed room: you can always come close to it, and it
  // never shrinks below MIN_OBJECT_PX.
  const ro = modelRadius(model.diagnostics.bbox);
  const maxDistance = Math.min(POSE_BOUNDS.distance.max * r, (ro * size.height) / (MIN_OBJECT_PX * Math.tan(((spec.fovDeg / 2) * Math.PI) / 180)));
  const minZoom = Math.max(POSE_BOUNDS.zoom.min, (MIN_OBJECT_PX / size.height) * (spec.halfHeight / ro));
  // Polar angle is measured from straight up: elevation e is polar 90° - e.
  const minPolar = ((90 - POSE_BOUNDS.elevationDeg.max) * Math.PI) / 180;
  const maxPolar = ((90 - POSE_BOUNDS.elevationDeg.min) * Math.PI) / 180;
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      minDistance={ro * MIN_DISTANCE_RADII}
      maxDistance={maxDistance}
      minZoom={minZoom}
      maxZoom={POSE_BOUNDS.zoom.max}
      minPolarAngle={minPolar}
      maxPolarAngle={maxPolar}
      onStart={() => {
        userMoving.current = true;
        gestureEnded.current = false;
      }}
      onEnd={() => void (gestureEnded.current = true)}
      onChange={() => {
        if (controls.current) cameraView.set(camera, controls.current.target);
        if (!userMoving.current) return;
        clearTimeout(timer.current);
        timer.current = setTimeout(writeBack, POSE_WRITEBACK_MS);
      }}
    />
  );
}

function Capture() {
  const { gl, scene } = useThree();
  // Development only: let the browser checks inspect the scene.
  if (import.meta.env.DEV) (window as unknown as { __scene?: unknown }).__scene = scene;
  useEffect(() => {
    captureRef.current = async ({ design, model, width, height, transparent }) => {
      frameOverride.set?.({ design, model });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const target = new THREE.WebGLRenderTarget(width, height, { samples: 4, colorSpace: THREE.SRGBColorSpace });
      // The same camera function as the screen, with the frame's own pose: an export is the view.
      const spec = cameraFor(design.view, framingBox(model, design.view));
      const cam = design.view.camera === 'orthographic' ? new THREE.OrthographicCamera() : new THREE.PerspectiveCamera();
      applyCamera(cam, spec, width / height);
      const prevBg = scene.background;
      if (transparent) scene.background = null;
      scene.updateMatrixWorld();
      cullWalls(scene, cam);
      gl.setRenderTarget(target);
      gl.render(scene, cam);
      const buf = new Uint8Array(width * height * 4);
      gl.readRenderTargetPixels(target, 0, 0, width, height, buf);
      gl.setRenderTarget(null);
      scene.background = prevBg;
      target.dispose();
      // WebGL rows are bottom-up; images are top-down.
      const out = new ImageData(width, height);
      const row = width * 4;
      for (let y = 0; y < height; y++) out.data.set(buf.subarray((height - 1 - y) * row, (height - y) * row), y * row);
      return out;
    };
    return () => {
      captureRef.current = null;
    };
  }, [gl, scene]);
  return null;
}

export interface ViewerProps {
  design: Design;
  model: Model | null;
  busy: boolean;
  resetKey: number;
  showSlices: boolean;
  override: { design: Design; model: Model } | null;
  setOverride: (o: { design: Design; model: Model } | null) => void;
  /** Called when the user has orbited, panned or zoomed: the new pose, to store in the design. */
  onPose: (pose: Partial<View>) => void;
  children?: ReactNode;
}

export function Viewer({ design, model, busy, resetKey, showSlices, override, setOverride, onPose, children }: ViewerProps) {
  frameOverride.set = setOverride;
  // Development only: let the browser checks see whether a preview is on screen.
  if (import.meta.env.DEV) (window as unknown as { __override?: unknown }).__override = override;
  const shown = override ?? (model ? { design, model } : null);
  return (
    <div className="relative h-full w-full">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ preserveDrawingBuffer: true, antialias: true, localClippingEnabled: true } as never}
        onCreated={({ gl }) => {
          gl.localClippingEnabled = true;
        }}
      >
        <color attach="background" args={[shown?.design.style.background ?? design.style.background]} />
        {(shown?.design ?? design).view.camera === 'orthographic' ? <OrthographicCamera makeDefault manual position={[0, 0, 100]} /> : <PerspectiveCamera makeDefault position={[0, 0, 100]} />}
        {/* The environment follows the frame being shown (a preview or a captured frame), like the lights. */}
        <Environment resolution={128} environmentIntensity={(shown?.design ?? design).view.environmentIntensity} environmentRotation={[0, ((shown?.design ?? design).view.lightAzimuthDeg * Math.PI) / 180, 0]}>
          <Lightformer intensity={2} position={[0, 5, -9]} scale={[10, 10, 1]} />
          <Lightformer intensity={1.2} position={[-5, 1, -1]} rotation-y={Math.PI / 2} scale={[10, 2, 1]} />
          <Lightformer intensity={1.2} position={[5, 1, -1]} rotation-y={-Math.PI / 2} scale={[10, 2, 1]} />
        </Environment>
        {shown && <Scene design={shown.design} model={shown.model} dimmed={busy && !override} showSlices={showSlices} />}
        {shown && <CameraRig design={shown.design} model={shown.model} resetKey={resetKey} onPose={override ? () => undefined : onPose} />}
        <Capture />
      </Canvas>
      {children}
    </div>
  );
}
