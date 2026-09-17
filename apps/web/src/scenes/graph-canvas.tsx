'use client';

import {
  COLORS,
  type CameraKeyframe,
  type CameraPose,
  type ReplayClock,
  cameraPoseAt,
} from '@debrief/ui';
import { CameraControls, type CameraControlsImpl } from '@react-three/drei';
import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  type Object3D,
  type Points,
  ShaderMaterial,
  Vector3,
} from 'three';

import type { Ripple } from '../lib/ripple';
import { LOD_NODE_THRESHOLD, type SceneData, edgesTouching, hexToRgb } from '../lib/scene';

export interface GraphCanvasProps {
  scene: SceneData;
  hovered?: number;
  onHover: (index: number | undefined) => void;
  frameloop?: 'always' | 'demand';
  spin?: boolean;
  onFrame?: (ms: number) => void;
  clock?: ReplayClock;
  keyframes?: readonly CameraKeyframe[];
  onPose?: (pose: CameraPose, manual: boolean, actual: ActualCamera) => void;
  flares?: ReadonlyMap<number, number>;
  ripple?: Ripple;
  progress?: number;
}

export interface ActualCamera {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  fov: number;
  width: number;
  height: number;
}

const EMBER = hexToRgb(COLORS.ember);

// Sphere impostors: one point per node, the disc shaded in the fragment shader, an ember ring for observed nodes.
// The ripple: `wave` is the blast hop (-1 outside it), uRipple the front in waves; a node lights as the front passes it.
const RIPPLE = `
uniform float uRipple;
attribute float wave;
float rippleOn() { return step(0.0, uRipple) * step(-0.5, wave); }
float rippleHit() { return rippleOn() * clamp(uRipple - wave, 0.0, 1.0); }
float rippleFront() { return rippleOn() * max(0.0, 1.0 - abs(uRipple - wave - 0.3) * 2.5); }
float rippleDim() { return step(0.0, uRipple) * (1.0 - step(-0.5, wave)) * 0.45; }
`;

const NODE_VERTEX = `
attribute float radius;
attribute float ring;
attribute float lift;
attribute vec3 color;
uniform float uHeight;
varying vec3 vColor;
varying float vRing;
varying float vLift;
varying float vHit;
varying float vDim;
${RIPPLE}
void main() {
  vColor = color;
  vRing = ring;
  vHit = rippleHit();
  vDim = rippleDim();
  vLift = max(lift, rippleFront());
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float size = radius * (1.0 + vLift * 0.35) * uHeight * projectionMatrix[1][1] / -mvPosition.z;
  gl_PointSize = clamp(size, 2.0, 96.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const NODE_FRAGMENT = `
precision mediump float;
uniform vec3 uEmber;
varying vec3 vColor;
varying float vRing;
varying float vLift;
varying float vHit;
varying float vDim;
void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float d = dot(uv, uv);
  if (d > 1.0) discard;
  float light = 0.55 + 0.45 * (1.0 - d) + 0.2 * (uv.x - uv.y);
  vec3 base = mix(vColor, uEmber, vHit * 0.7);
  vec3 shaded = mix(base, vec3(1.0), vLift * 0.5) * light;
  if (max(vRing, vHit) > 0.5 && d > 0.62 && d < 0.9) shaded = uEmber;
  gl_FragColor = vec4(shaded * (1.0 - vDim), 1.0);
}
`;

// Far LOD: a flat square per node, no discard, so software rasterizers pay a few fragments per node.
const DOT_VERTEX = `
attribute float radius;
attribute float ring;
attribute float lift;
attribute vec3 color;
uniform float uHeight;
uniform vec3 uEmber;
varying vec3 vColor;
${RIPPLE}
void main() {
  float front = rippleFront();
  vec3 lit = mix(mix(color, uEmber, max(ring, rippleHit())), vec3(1.0), front * 0.5);
  vColor = lit * (1.0 + max(lift, front) * 0.6) * (1.0 - rippleDim());
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float size = radius * uHeight * projectionMatrix[1][1] / -mvPosition.z;
  gl_PointSize = clamp(size, 1.5, 6.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const DOT_FRAGMENT = `
precision mediump float;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 1.0);
}
`;

// Edges light up as the front travels them: from the node a wave leaves to the node it reaches.
const EDGE_VERTEX = `
attribute vec3 color;
uniform vec3 uEmber;
varying vec3 vColor;
${RIPPLE}
void main() {
  float hit = rippleOn() * clamp(uRipple - wave + 1.0, 0.0, 1.0);
  vColor = mix(color, uEmber, hit) * (1.0 - rippleDim());
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const EDGE_FRAGMENT = DOT_FRAGMENT;

const OFF = -1;

const waveAttribute = (count: number, fill: (index: number) => number): BufferAttribute =>
  new BufferAttribute(
    Float32Array.from({ length: count }, (_, index) => fill(index)),
    1,
  );

function Nodes({
  scene,
  hovered,
  onHover,
  flares,
  ripple,
  progress = OFF,
}: Pick<GraphCanvasProps, 'scene' | 'hovered' | 'onHover' | 'flares' | 'ripple' | 'progress'>) {
  const far = scene.nodes.length > LOD_NODE_THRESHOLD;
  const ref = useRef<Points>(null);
  const invalidate = useThree((state) => state.invalidate);
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(scene.positions, 3));
    g.setAttribute('color', new BufferAttribute(scene.colors, 3));
    g.setAttribute('radius', new BufferAttribute(scene.radii, 1));
    const ring = Float32Array.from(scene.nodes, (node) => (node.provenance === 'observed' ? 1 : 0));
    g.setAttribute('ring', new BufferAttribute(ring, 1));
    g.setAttribute('lift', new BufferAttribute(new Float32Array(scene.nodes.length), 1));
    g.setAttribute(
      'wave',
      waveAttribute(scene.nodes.length, () => OFF),
    );
    return g;
  }, [scene]);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: far ? DOT_VERTEX : NODE_VERTEX,
        fragmentShader: far ? DOT_FRAGMENT : NODE_FRAGMENT,
        uniforms: {
          uHeight: { value: 1 },
          uEmber: { value: new Color(...EMBER) },
          uRipple: { value: OFF },
        },
        transparent: false,
        depthWrite: true,
      }),
    [far],
  );
  useEffect(
    () => () => {
      geometry.dispose();
    },
    [geometry],
  );
  useEffect(
    () => () => {
      material.dispose();
    },
    [material],
  );
  // Point size in device pixels follows the drawing buffer, so it is a pure function of camera and viewport.
  useFrame((state) => {
    material.uniforms.uHeight = { value: state.size.height * state.viewport.dpr };
  });
  // Lift = hover or the flare of a world change landing on the node; both feed the same shader attribute.
  useLayoutEffect(() => {
    const lift = geometry.getAttribute('lift');
    if (!(lift instanceof BufferAttribute)) return;
    for (let index = 0; index < lift.count; index += 1) {
      lift.setX(index, Math.max(index === hovered ? 1 : 0, flares?.get(index) ?? 0));
    }
    lift.needsUpdate = true;
    invalidate();
  }, [geometry, hovered, flares, invalidate]);
  useLayoutEffect(() => {
    const wave = geometry.getAttribute('wave');
    if (!(wave instanceof BufferAttribute)) return;
    for (let index = 0; index < wave.count; index += 1) {
      wave.setX(index, ripple?.waves.get(index) ?? OFF);
    }
    wave.needsUpdate = true;
    invalidate();
  }, [geometry, ripple, invalidate]);
  useLayoutEffect(() => {
    material.uniforms.uRipple = { value: progress };
    invalidate();
  }, [material, progress, invalidate]);
  return (
    <points
      ref={ref}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        onHover(event.index);
      }}
      onPointerOut={() => {
        onHover(undefined);
      }}
    />
  );
}

function Edges({
  scene,
  hovered,
  ripple,
  progress = OFF,
}: Pick<GraphCanvasProps, 'scene' | 'hovered' | 'ripple' | 'progress'>) {
  const far = scene.nodes.length > LOD_NODE_THRESHOLD;
  const invalidate = useThree((state) => state.invalidate);
  const buffers = useMemo(
    () =>
      far
        ? edgesTouching(scene, hovered)
        : { segments: scene.segments, segmentColors: scene.segmentColors },
    [scene, hovered, far],
  );
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(buffers.segments, 3));
    g.setAttribute('color', new BufferAttribute(buffers.segmentColors, 3));
    const waves = far ? undefined : ripple?.edgeWaves;
    g.setAttribute(
      'wave',
      waveAttribute(buffers.segments.length / 3, (index) => waves?.[index >> 1] ?? OFF),
    );
    return g;
  }, [buffers, far, ripple]);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: EDGE_VERTEX,
        fragmentShader: EDGE_FRAGMENT,
        uniforms: { uEmber: { value: new Color(...EMBER) }, uRipple: { value: OFF } },
        depthWrite: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
    },
    [geometry],
  );
  useEffect(
    () => () => {
      material.dispose();
    },
    [material],
  );
  useLayoutEffect(() => {
    material.uniforms.uRipple = { value: progress };
    invalidate();
  }, [material, progress, invalidate]);
  return (
    <lineSegments
      geometry={geometry}
      material={material}
      frustumCulled={false}
      visible={buffers.segments.length > 0}
    />
  );
}

function Rig({ scene, spin, onFrame }: Pick<GraphCanvasProps, 'scene' | 'spin' | 'onFrame'>) {
  const camera = useThree((state) => state.camera);
  const raycaster = useThree((state) => state.raycaster);
  const group = useRef<Object3D>(null);
  const last = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const distance = Math.max(60, scene.radiusOfGraph * 2.2);
    camera.position.set(
      scene.center[0],
      scene.center[1] - distance * 0.35,
      scene.center[2] + distance,
    );
    camera.lookAt(new Vector3(...scene.center));
    camera.updateProjectionMatrix();
    raycaster.params.Points.threshold = 4;
  }, [camera, raycaster, scene]);
  useFrame((_, delta) => {
    if (spin === true && group.current !== null) group.current.rotation.z += delta * 0.2;
    if (onFrame !== undefined) {
      const now = performance.now();
      if (last.current !== undefined) onFrame(now - last.current);
      last.current = now;
    }
  });
  return <group ref={group} />;
}

// ARCHITECTURE §11: the auto-director drives drei's CameraControls; a drag takes over, play hands control back.
function CinematicCamera({
  clock,
  keyframes,
  onPose,
}: {
  clock: ReplayClock;
  keyframes: readonly CameraKeyframe[];
  onPose?: (pose: CameraPose, manual: boolean, actual: ActualCamera) => void;
}) {
  const size = useThree((state) => state.size);
  const controls = useRef<CameraControlsImpl>(null);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const raycaster = useThree((state) => state.raycaster);
  const manual = useRef(false);
  useLayoutEffect(() => {
    raycaster.params.Points.threshold = 4;
  }, [raycaster]);
  useEffect(() => {
    const instance = controls.current;
    if (instance === null) return;
    const takeOver = (): void => {
      manual.current = true;
    };
    instance.addEventListener('controlstart', takeOver);
    return () => {
      instance.removeEventListener('controlstart', takeOver);
    };
  }, []);
  useEffect(() => {
    let wasPlaying = clock.getState().playing;
    return clock.subscribe((state) => {
      if (state.playing && !wasPlaying) manual.current = false;
      wasPlaying = state.playing;
      invalidate();
    });
  }, [clock, invalidate]);
  const applied = useRef<string | undefined>(undefined);
  // Only a changed pose touches the controls: each setLookAt re-invalidates, so a paused clock must not keep frames coming.
  useFrame(() => {
    const instance = controls.current;
    if (instance === null) return;
    const pose = cameraPoseAt(keyframes, clock.getState().t / 1000);
    if (pose === undefined) return;
    const signature = manual.current
      ? 'manual'
      : [...pose.position, ...pose.target, pose.fov].join(',');
    if (signature !== applied.current) {
      applied.current = signature;
      if (!manual.current) {
        // smoothTime is clamped above zero inside camera-controls; a large delta converges the damping this frame.
        void instance.setLookAt(...pose.position, ...pose.target, false);
        instance.update(1);
        if ('fov' in camera && camera.fov !== pose.fov) {
          camera.fov = pose.fov;
          camera.updateProjectionMatrix();
        }
      }
      onPose?.(pose, manual.current, {
        position: camera.position.toArray(),
        quaternion: camera.quaternion.toArray(),
        fov: 'fov' in camera ? camera.fov : 0,
        width: size.width,
        height: size.height,
      });
    }
  });
  return <CameraControls ref={controls} makeDefault smoothTime={0} draggingSmoothTime={0} />;
}

export function GraphCanvas({
  scene,
  hovered,
  onHover,
  frameloop = 'demand',
  spin = false,
  onFrame,
  clock,
  keyframes,
  onPose,
  flares,
  ripple,
  progress,
}: GraphCanvasProps) {
  const cinematic = clock !== undefined && keyframes !== undefined && keyframes.length > 0;
  return (
    <Canvas
      dpr={[1, 1.5]}
      frameloop={frameloop}
      camera={{ fov: 50, near: 1, far: 5000 }}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      style={{ background: COLORS.stage }}
      onPointerMissed={() => {
        onHover(undefined);
      }}
    >
      {cinematic ? (
        <CinematicCamera clock={clock} keyframes={keyframes} onPose={onPose} />
      ) : (
        <Rig scene={scene} spin={spin} onFrame={onFrame} />
      )}
      <Edges scene={scene} hovered={hovered} ripple={ripple} progress={progress} />
      <Nodes
        scene={scene}
        hovered={hovered}
        onHover={onHover}
        flares={flares}
        ripple={ripple}
        progress={progress}
      />
    </Canvas>
  );
}
