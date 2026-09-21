'use client';

import { COLORS } from '@debrief/ui';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  Color,
  type InstancedMesh,
  Object3D,
  type PointLight,
  ShaderMaterial,
  Vector3,
} from 'three';

import { hexToRgb } from '../lib/scene';

const BOXES = 1400;
const LOBES = 6;
const REACH = 80;
const REFORM_S = 11;
const MIGRATE_S = 3;
const SPRING = 2.4;
const SWIRL = 1.1;
const DAMPING = 2.6;
const SCATTER = 2600;
const MAX_DT = 1 / 30;
const CALL_RISE_S = 0.3;
const CALL_HOLD_S = 1.4;
const CALL_RELEASE_S = 1.8;

// A deterministic swarm: the same seed lays out the same boxes on every visit.
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface Pointer {
  x: number;
  y: number;
  on: boolean;
  click: { x: number; y: number; seq: number };
}

const toNdc = (event: PointerEvent): { x: number; y: number } => ({
  x: (event.clientX / window.innerWidth) * 2 - 1,
  y: -(event.clientY / window.innerHeight) * 2 + 1,
});

// The pointer in normalized device coordinates, shared by the wash and the swarm: where it is, whether it is over the
// page, and the last click (seq changes on every one so a frame can tell a new click from the last).
function usePointer(): { current: Pointer } {
  const pointer = useRef<Pointer>({ x: 0, y: 0, on: false, click: { x: 0, y: 0, seq: 0 } });
  useEffect(() => {
    const move = (event: PointerEvent): void => {
      pointer.current = { ...pointer.current, ...toNdc(event), on: true };
    };
    const down = (event: PointerEvent): void => {
      pointer.current = {
        ...pointer.current,
        click: { ...toNdc(event), seq: pointer.current.click.seq + 1 },
      };
    };
    const leave = (): void => {
      pointer.current = { ...pointer.current, on: false };
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', down, { passive: true });
    window.addEventListener('pointerleave', leave);
    document.addEventListener('mouseleave', leave);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerleave', leave);
      document.removeEventListener('mouseleave', leave);
    };
  }, []);
  return pointer;
}

const WASH_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Four soft lobes drifting through each other, plus a highlight that follows the pointer: a mesh gradient, not a picture.
const WASH_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uPointer;
  uniform float uPointerOn;
  uniform float uAspect;
  uniform vec3 uCyan;
  uniform vec3 uEmber;
  uniform vec3 uStage;
  varying vec2 vUv;
  float lobe(vec2 p, vec2 c, float r) {
    vec2 d = (p - c) * vec2(uAspect, 1.0);
    return exp(-dot(d, d) / (r * r));
  }
  // A splash: the radius wobbles around the rim on four harmonics that jiggle at their own rates, edge kept crisp.
  float splash(vec2 p, vec2 c, float r) {
    vec2 d = (p - c) * vec2(uAspect, 1.0);
    float a = atan(d.y, d.x);
    float rim = 1.0
      + 0.22 * sin(3.0 * a + uTime * 2.3)
      + 0.15 * sin(5.0 * a - uTime * 3.1 + 1.0)
      + 0.09 * sin(8.0 * a + uTime * 4.7)
      + 0.05 * sin(13.0 * a - uTime * 6.0);
    float rr = r * rim;
    return exp(-pow(dot(d, d) / (rr * rr), 1.2));
  }
  void main() {
    float t = uTime * 0.05;
    vec2 p = vUv;
    float c1 = lobe(p, vec2(0.25 + 0.12 * sin(t * 1.1), 0.75 + 0.1 * cos(t * 0.9)), 0.42);
    float c2 = lobe(p, vec2(0.8 + 0.1 * cos(t * 0.7), 0.6 + 0.12 * sin(t * 1.3)), 0.36);
    float e1 = lobe(p, vec2(0.7 + 0.14 * sin(t * 0.8 + 2.0), 0.15 + 0.1 * cos(t * 1.2)), 0.4);
    float e2 = lobe(p, vec2(0.15 + 0.1 * cos(t * 1.4 + 1.0), 0.2 + 0.08 * sin(t * 0.6)), 0.3);
    vec2 pointer = (uPointer + 1.0) * 0.5;
    float h = splash(p, pointer, 0.15) * uPointerOn;
    vec3 color = uStage;
    color += uCyan * (c1 * 0.11 + c2 * 0.07 + h * 0.16);
    color += uEmber * (e1 * 0.09 + e2 * 0.06 + h * 0.02);
    gl_FragColor = vec4(color, 1.0);
  }
`;

function Wash({ pointer }: { pointer: ReturnType<typeof usePointer> }) {
  const size = useThree((state) => state.size);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPointer: { value: [0, 0] as [number, number] },
      uPointerOn: { value: 0 },
      uAspect: { value: 1 },
      uCyan: { value: new Color(...hexToRgb(COLORS.cyan)) },
      uEmber: { value: new Color(...hexToRgb(COLORS.ember)) },
      uStage: { value: new Color(...hexToRgb(COLORS.stage)) },
    }),
    [],
  );
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: WASH_VERTEX,
        fragmentShader: WASH_FRAGMENT,
        uniforms,
        depthTest: false,
        depthWrite: false,
      }),
    [uniforms],
  );
  useFrame(({ clock }, delta) => {
    uniforms.uTime.value = clock.getElapsedTime();
    uniforms.uAspect.value = size.width / size.height;
    const target = pointer.current;
    const current = uniforms.uPointer.value;
    const follow = 1 - Math.exp(-delta * 14);
    current[0] += (target.x - current[0]) * follow;
    current[1] += (target.y - current[1]) * follow;
    uniforms.uPointerOn.value += ((target.on ? 1 : 0) - uniforms.uPointerOn.value) * follow * 0.6;
  });
  return (
    <mesh renderOrder={-1} frustumCulled={false} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}

interface Box {
  position: Vector3;
  velocity: Vector3;
  offset: Vector3;
  seed: number;
  stagger: number;
  size: number;
  spin: Vector3;
  tint: number;
  heat: number;
}

// Where the cloud is: it wanders the page on slow, unrelated sines so the path never repeats within a visit.
function centroidAt(t: number, out: Vector3): Vector3 {
  return out.set(
    100 * Math.sin(t * 0.07) + 35 * Math.sin(t * 0.031 + 1),
    45 * Math.sin(t * 0.053 + 2) + 20 * Math.cos(t * 0.09),
    30 * Math.sin(t * 0.04),
  );
}

// Each lobe orbits the centroid, breathing in and out, so the cloud splits, stretches and rejoins; returns its radius.
function lobeAt(t: number, index: number, out: Vector3): number {
  const reach = 40 + 80 * (0.5 + 0.5 * Math.sin(t * 0.045 + index * 1.7));
  const angle =
    (index * Math.PI * 2) / LOBES +
    t * 0.03 * (index % 2 === 0 ? 1 : -1) +
    0.6 * Math.sin(t * 0.02 + index);
  out.set(
    Math.cos(angle) * reach,
    Math.sin(angle) * reach * 0.65,
    25 * Math.sin(t * 0.06 + index * 2),
  );
  return 32 + 30 * (0.5 + 0.5 * Math.sin(t * 0.08 + index * 2.3));
}

// Every REFORM_S seconds each box picks a new lobe, spread over MIGRATE_S so the cloud flows into its next shape.
function lobeOf(box: Box, t: number): number {
  const generation = Math.floor((t + box.stagger * MIGRATE_S) / REFORM_S);
  const hash = Math.sin(box.seed * 12.9898 + generation * 78.233) * 43758.5453;
  return Math.floor((hash - Math.floor(hash)) * LOBES);
}

// How far the swarm answers a click: rises over CALL_RISE_S, holds, then lets go over CALL_RELEASE_S.
function callAt(since: number): number {
  if (since < 0) return 0;
  if (since < CALL_RISE_S) return since / CALL_RISE_S;
  if (since < CALL_RISE_S + CALL_HOLD_S) return 1;
  return Math.max(0, 1 - (since - CALL_RISE_S - CALL_HOLD_S) / CALL_RELEASE_S);
}

// One swarm of boxes flocking into a cloud with no fixed shape: each box springs toward its place in a lobe and swirls
// around it; the pointer scatters whatever is within REACH and lights it; the swarm closes up again behind it.
// A click calls the whole swarm: the centroid runs to the point and the lobes fold in, then the cloud blooms back out.
function Swarm({ pointer }: { pointer: ReturnType<typeof usePointer> }) {
  const mesh = useRef<InstancedMesh>(null);
  const core = useRef<PointLight>(null);
  const camera = useThree((state) => state.camera);
  const scratch = useMemo(
    () => ({
      dummy: new Object3D(),
      centroid: new Vector3(),
      lobes: Array.from({ length: LOBES }, () => ({ centre: new Vector3(), radius: 0 })),
      target: new Vector3(),
      accel: new Vector3(),
      pointerAt: new Vector3(),
      direction: new Vector3(),
      call: { seq: 0, at: -100, point: new Vector3() },
      color: new Color(),
      dim: new Color('#3a3a4e'),
      cyan: new Color(COLORS.cyan),
      ember: new Color(COLORS.ember),
    }),
    [],
  );
  const boxes = useMemo(() => {
    const next = random(11);
    centroidAt(0, scratch.centroid);
    return Array.from({ length: BOXES }, (): Box => {
      const direction = new Vector3(next() - 0.5, next() - 0.5, next() - 0.5).normalize();
      const offset = direction.multiplyScalar(Math.cbrt(next()));
      const box: Box = {
        position: new Vector3(),
        velocity: new Vector3(),
        offset,
        seed: next() * 1000,
        stagger: next(),
        size: 1.8 + next() ** 2 * 5,
        spin: new Vector3(next() - 0.5, next() - 0.5, next() - 0.5).multiplyScalar(1.2),
        tint: next(),
        heat: 0,
      };
      const radius = lobeAt(0, lobeOf(box, 0), scratch.target);
      box.position
        .copy(scratch.centroid)
        .add(scratch.target)
        .addScaledVector(offset, radius)
        .add(new Vector3(next() - 0.5, next() - 0.5, next() - 0.5).multiplyScalar(80));
      return box;
    });
  }, [scratch]);
  const baseColor = (box: Box, into: Color): Color =>
    into
      .copy(scratch.dim)
      .lerp(box.tint > 0.94 ? scratch.ember : scratch.cyan, box.tint > 0.76 ? 0.45 : 0);
  useEffect(() => {
    const instanced = mesh.current;
    if (instanced === null) return;
    boxes.forEach((box, index) => instanced.setColorAt(index, baseColor(box, scratch.color)));
    if (instanced.instanceColor !== null) instanced.instanceColor.needsUpdate = true;
  }, [boxes, scratch]);
  useFrame(({ clock }, delta) => {
    const instanced = mesh.current;
    if (instanced === null) return;
    const t = clock.getElapsedTime();
    const dt = Math.min(MAX_DT, delta);
    const target = pointer.current;
    const { call } = scratch;
    if (target.click.seq !== call.seq) {
      call.seq = target.click.seq;
      call.at = t;
      scratch.pointerAt.set(target.click.x, target.click.y, 0.5).unproject(camera);
      scratch.direction.copy(scratch.pointerAt).sub(camera.position).normalize();
      call.point
        .copy(camera.position)
        .addScaledVector(scratch.direction, -camera.position.z / scratch.direction.z);
    }
    const gather = callAt(t - call.at);
    const spring = SPRING * (1 + 2 * gather);
    centroidAt(t, scratch.centroid).lerp(call.point, gather);
    core.current?.position.copy(scratch.centroid);
    scratch.lobes.forEach((lobe, index) => {
      lobe.radius = lobeAt(t, index, lobe.centre) * (1 - 0.55 * gather);
      lobe.centre.multiplyScalar(1 - 0.85 * gather).add(scratch.centroid);
    });
    const painted = { any: false };
    boxes.forEach((box, index) => {
      const lobe = scratch.lobes[lobeOf(box, t)];
      if (lobe === undefined) return;
      scratch.target.copy(lobe.centre).addScaledVector(box.offset, lobe.radius);
      scratch.target.x += Math.sin(t * 0.9 + box.seed) * 3;
      scratch.target.y += Math.cos(t * 0.7 + box.seed) * 3;
      scratch.accel.copy(scratch.target).sub(box.position).multiplyScalar(spring);
      scratch.accel.x += -(box.position.y - lobe.centre.y) * SWIRL;
      scratch.accel.y += (box.position.x - lobe.centre.x) * SWIRL;
      let heat = 0;
      if (target.on) {
        // The pointer's ray at this box's depth: unproject the pointer onto the plane z = box.z.
        scratch.pointerAt.set(target.x, target.y, 0.5).unproject(camera);
        scratch.direction.copy(scratch.pointerAt).sub(camera.position).normalize();
        const along = (box.position.z - camera.position.z) / scratch.direction.z;
        scratch.pointerAt.copy(camera.position).addScaledVector(scratch.direction, along);
        const dx = box.position.x - scratch.pointerAt.x;
        const dy = box.position.y - scratch.pointerAt.y;
        const distance = Math.hypot(dx, dy);
        if (distance < REACH) {
          heat = (1 - distance / REACH) * (1 - 0.7 * gather);
          const force = (heat * heat * SCATTER * (1 - gather)) / (distance === 0 ? 1 : distance);
          scratch.accel.x += dx * force;
          scratch.accel.y += dy * force;
        }
      }
      box.velocity.addScaledVector(scratch.accel, dt).multiplyScalar(Math.max(0, 1 - DAMPING * dt));
      box.position.addScaledVector(box.velocity, dt);
      const wasLit = box.heat > 0.01;
      box.heat += (heat - box.heat) * 0.2;
      scratch.dummy.position.copy(box.position);
      scratch.dummy.rotation.set(
        t * box.spin.x + box.seed,
        t * box.spin.y + box.heat * 1.4,
        t * box.spin.z,
      );
      const scale = box.size * (1 + box.heat * 0.7);
      scratch.dummy.scale.set(scale, scale, scale);
      scratch.dummy.updateMatrix();
      instanced.setMatrixAt(index, scratch.dummy.matrix);
      if (box.heat > 0.01 || wasLit) {
        instanced.setColorAt(
          index,
          baseColor(box, scratch.color).lerp(
            box.tint > 0.94 ? scratch.ember : scratch.cyan,
            Math.min(1, box.heat * 1.2),
          ),
        );
        painted.any = true;
      }
    });
    instanced.instanceMatrix.needsUpdate = true;
    if (painted.any && instanced.instanceColor !== null) {
      instanced.instanceColor.needsUpdate = true;
    }
  });
  return (
    <group>
      <pointLight ref={core} color={COLORS.cyan} intensity={2600} distance={280} decay={2} />
      <instancedMesh ref={mesh} args={[undefined, undefined, BOXES]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.5} metalness={0.3} />
      </instancedMesh>
    </group>
  );
}

export function AmbientCanvas() {
  const pointer = usePointer();
  return (
    <Canvas
      dpr={[1, 1.5]}
      frameloop="always"
      camera={{ fov: 50, near: 1, far: 1200, position: [0, 0, 300] }}
      gl={{ antialias: true, alpha: false, powerPreference: 'low-power' }}
      style={{ background: COLORS.stage }}
    >
      <fog attach="fog" args={[new Color(COLORS.stage), 300, 700]} />
      <Wash pointer={pointer} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[120, 200, 160]} intensity={1.6} />
      <Swarm pointer={pointer} />
    </Canvas>
  );
}
