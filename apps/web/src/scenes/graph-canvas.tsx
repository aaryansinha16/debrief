'use client';

import { COLORS } from '@debrief/ui';
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

import { LOD_NODE_THRESHOLD, type SceneData, edgesTouching, hexToRgb } from '../lib/scene';

export interface GraphCanvasProps {
  scene: SceneData;
  hovered?: number;
  onHover: (index: number | undefined) => void;
  frameloop?: 'always' | 'demand';
  spin?: boolean;
  onFrame?: (ms: number) => void;
}

const EMBER = hexToRgb(COLORS.ember);

// Sphere impostors: one point per node, the disc shaded in the fragment shader, an ember ring for observed nodes.
const NODE_VERTEX = `
attribute float radius;
attribute float ring;
attribute float lift;
attribute vec3 color;
uniform float uScale;
varying vec3 vColor;
varying float vRing;
varying float vLift;
void main() {
  vColor = color;
  vRing = ring;
  vLift = lift;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float size = radius * (1.0 + lift * 0.35) * 2.0 * uScale / -mvPosition.z;
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
void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float d = dot(uv, uv);
  if (d > 1.0) discard;
  float light = 0.55 + 0.45 * (1.0 - d) + 0.2 * (uv.x - uv.y);
  vec3 shaded = mix(vColor, vec3(1.0), vLift * 0.5) * light;
  if (vRing > 0.5 && d > 0.62 && d < 0.9) shaded = uEmber;
  gl_FragColor = vec4(shaded, 1.0);
}
`;

// Far LOD: a flat square per node, no discard, so software rasterizers pay a few fragments per node.
const DOT_VERTEX = `
attribute float radius;
attribute float ring;
attribute float lift;
attribute vec3 color;
uniform float uScale;
uniform vec3 uEmber;
varying vec3 vColor;
void main() {
  vColor = mix(color, uEmber, ring) * (1.0 + lift * 0.6);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float size = radius * 2.0 * uScale / -mvPosition.z;
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

function Nodes({
  scene,
  hovered,
  onHover,
}: Pick<GraphCanvasProps, 'scene' | 'hovered' | 'onHover'>) {
  const far = scene.nodes.length > LOD_NODE_THRESHOLD;
  const ref = useRef<Points>(null);
  const { size, camera } = useThree((state) => ({ size: state.size, camera: state.camera }));
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(scene.positions, 3));
    g.setAttribute('color', new BufferAttribute(scene.colors, 3));
    g.setAttribute('radius', new BufferAttribute(scene.radii, 1));
    const ring = Float32Array.from(scene.nodes, (node) => (node.provenance === 'observed' ? 1 : 0));
    g.setAttribute('ring', new BufferAttribute(ring, 1));
    g.setAttribute('lift', new BufferAttribute(new Float32Array(scene.nodes.length), 1));
    return g;
  }, [scene]);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: far ? DOT_VERTEX : NODE_VERTEX,
        fragmentShader: far ? DOT_FRAGMENT : NODE_FRAGMENT,
        uniforms: { uScale: { value: 1 }, uEmber: { value: new Color(...EMBER) } },
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
  useLayoutEffect(() => {
    const fov = 'fov' in camera ? camera.fov : 50;
    material.uniforms.uScale = { value: size.height / (2 * Math.tan((fov * Math.PI) / 360)) };
  }, [material, size, camera]);
  useLayoutEffect(() => {
    const lift = geometry.getAttribute('lift');
    if (!(lift instanceof BufferAttribute)) return;
    for (let index = 0; index < lift.count; index += 1) lift.setX(index, index === hovered ? 1 : 0);
    lift.needsUpdate = true;
  }, [geometry, hovered]);
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

function Edges({ scene, hovered }: Pick<GraphCanvasProps, 'scene' | 'hovered'>) {
  const far = scene.nodes.length > LOD_NODE_THRESHOLD;
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
    return g;
  }, [buffers]);
  useEffect(
    () => () => {
      geometry.dispose();
    },
    [geometry],
  );
  return (
    <lineSegments geometry={geometry} frustumCulled={false} visible={buffers.segments.length > 0}>
      <lineBasicMaterial vertexColors depthWrite={false} />
    </lineSegments>
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

export function GraphCanvas({
  scene,
  hovered,
  onHover,
  frameloop = 'demand',
  spin = false,
  onFrame,
}: GraphCanvasProps) {
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
      <Rig scene={scene} spin={spin} onFrame={onFrame} />
      <Edges scene={scene} hovered={hovered} />
      <Nodes scene={scene} hovered={hovered} onHover={onHover} />
    </Canvas>
  );
}
