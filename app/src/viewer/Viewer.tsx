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
import type { Design, Model } from 'shaping';
import { cameraPose, modelRadius } from './camera';
import { Scene } from './Scene';

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

function CameraRig({ design, model, resetKey }: { design: Design; model: Model; resetKey: number }) {
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const { camera } = useThree();
  const b = model.diagnostics.bbox;
  const r = modelRadius(b);
  // Move the camera when the view dials change (or on reset), not on every rebuild.
  const v = design.view;
  useEffect(() => {
    const pose = cameraPose(v, b);
    camera.position.set(...pose.position);
    if (camera instanceof THREE.OrthographicCamera) camera.zoom = Math.min(window.innerWidth, window.innerHeight) / (r * 3.2);
    camera.near = r / 100;
    camera.far = r * 100;
    camera.updateProjectionMatrix();
    controls.current?.target.set(...pose.target);
    controls.current?.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.azimuthDeg, v.elevationDeg, v.camera, resetKey, camera]);
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} />;
}

function Capture() {
  const { gl, scene } = useThree();
  useEffect(() => {
    captureRef.current = async ({ design, model, width, height, transparent }) => {
      frameOverride.set?.({ design, model });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const target = new THREE.WebGLRenderTarget(width, height, { samples: 4, colorSpace: THREE.SRGBColorSpace });
      const pose = cameraPose(design.view, model.diagnostics.bbox);
      const r = modelRadius(model.diagnostics.bbox);
      const cam = design.view.camera === 'orthographic'
        ? new THREE.OrthographicCamera((-r * 1.6 * width) / height, (r * 1.6 * width) / height, r * 1.6, -r * 1.6, r / 100, r * 100)
        : new THREE.PerspectiveCamera(35, width / height, r / 100, r * 100);
      cam.position.set(...pose.position);
      cam.lookAt(...pose.target);
      const prevBg = scene.background;
      if (transparent) scene.background = null;
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
  children?: ReactNode;
}

export function Viewer({ design, model, busy, resetKey, showSlices, override, setOverride, children }: ViewerProps) {
  frameOverride.set = setOverride;
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
        {design.view.camera === 'orthographic' ? <OrthographicCamera makeDefault position={[0, 0, 100]} /> : <PerspectiveCamera makeDefault fov={35} position={[0, 0, 100]} />}
        <Environment resolution={128}>
          <Lightformer intensity={2} position={[0, 5, -9]} scale={[10, 10, 1]} />
          <Lightformer intensity={1.2} position={[-5, 1, -1]} rotation-y={Math.PI / 2} scale={[10, 2, 1]} />
          <Lightformer intensity={1.2} position={[5, 1, -1]} rotation-y={-Math.PI / 2} scale={[10, 2, 1]} />
        </Environment>
        {shown && <Scene design={shown.design} model={shown.model} dimmed={busy && !override} showSlices={showSlices} />}
        {model && <CameraRig design={design} model={model} resetKey={resetKey} />}
        <Capture />
      </Canvas>
      {children}
    </div>
  );
}
