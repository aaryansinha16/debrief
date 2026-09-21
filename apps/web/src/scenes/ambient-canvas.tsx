'use client';

import { COLORS } from '@debrief/ui';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  Color,
  type InstancedMesh,
  Matrix4,
  Object3D,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';

import { hexToRgb } from '../lib/scene';

const CUBES = 420;
const DEPTH = 420;
const REACH = 95;

// A deterministic field: the same seed lays out the same cloud on every visit.
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// The pointer in normalized device coordinates, shared by the wash and the cloud; off-screen when there is none.
function usePointer(): { current: { x: number; y: number; on: boolean } } {
  const pointer = useRef({ x: 0, y: 0, on: false });
  useEffect(() => {
    const move = (event: PointerEvent): void => {
      pointer.current = {
        x: (event.clientX / window.innerWidth) * 2 - 1,
        y: -(event.clientY / window.innerHeight) * 2 + 1,
        on: true,
      };
    };
    const leave = (): void => {
      pointer.current = { ...pointer.current, on: false };
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerleave', leave);
    document.addEventListener('mouseleave', leave);
    return () => {
      window.removeEventListener('pointermove', move);
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
  void main() {
    float t = uTime * 0.05;
    vec2 p = vUv;
    float c1 = lobe(p, vec2(0.25 + 0.12 * sin(t * 1.1), 0.75 + 0.1 * cos(t * 0.9)), 0.42);
    float c2 = lobe(p, vec2(0.8 + 0.1 * cos(t * 0.7), 0.6 + 0.12 * sin(t * 1.3)), 0.36);
    float e1 = lobe(p, vec2(0.7 + 0.14 * sin(t * 0.8 + 2.0), 0.15 + 0.1 * cos(t * 1.2)), 0.4);
    float e2 = lobe(p, vec2(0.15 + 0.1 * cos(t * 1.4 + 1.0), 0.2 + 0.08 * sin(t * 0.6)), 0.3);
    vec2 pointer = (uPointer + 1.0) * 0.5;
    float h = lobe(p, pointer, 0.22) * uPointerOn;
    vec3 color = uStage;
    color += uCyan * (c1 * 0.11 + c2 * 0.07 + h * 0.12);
    color += uEmber * (e1 * 0.09 + e2 * 0.06 + h * 0.04);
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
  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.getElapsedTime();
    uniforms.uAspect.value = size.width / size.height;
    const target = pointer.current;
    const current = uniforms.uPointer.value;
    current[0] += (target.x - current[0]) * 0.06;
    current[1] += (target.y - current[1]) * 0.06;
    uniforms.uPointerOn.value += ((target.on ? 1 : 0) - uniforms.uPointerOn.value) * 0.08;
  });
  return (
    <mesh renderOrder={-1} frustumCulled={false} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}

interface Cube {
  base: Vector3;
  size: number;
  spin: Vector3;
  phase: number;
  tint: number;
  push: Vector3;
}

// A cloud of small boxes tumbling in depth; within REACH of the pointer they are pushed aside and lit, then ease back.
function Cloud({ pointer }: { pointer: ReturnType<typeof usePointer> }) {
  const mesh = useRef<InstancedMesh>(null);
  const camera = useThree((state) => state.camera);
  const cubes = useMemo(() => {
    const next = random(11);
    return Array.from({ length: CUBES }, (): Cube => {
      const depth = -next() * DEPTH;
      return {
        base: new Vector3((next() - 0.5) * 1100, (next() - 0.5) * 620, depth),
        size: 2 + next() * 6,
        spin: new Vector3(next() - 0.5, next() - 0.5, next() - 0.5).multiplyScalar(0.4),
        phase: next() * Math.PI * 2,
        tint: next(),
        push: new Vector3(),
      };
    });
  }, []);
  const scratch = useMemo(
    () => ({
      dummy: new Object3D(),
      matrix: new Matrix4(),
      quaternion: new Quaternion(),
      pointerAt: new Vector3(),
      direction: new Vector3(),
      color: new Color(),
      dim: new Color('#2a2a36'),
      cyan: new Color(COLORS.cyan),
      ember: new Color(COLORS.ember),
      lit: new Color(),
    }),
    [],
  );
  useEffect(() => {
    const instanced = mesh.current;
    if (instanced === null) return;
    cubes.forEach((cube, index) => {
      scratch.color
        .copy(scratch.dim)
        .lerp(cube.tint > 0.85 ? scratch.ember : scratch.cyan, cube.tint > 0.7 ? 0.35 : 0);
      instanced.setColorAt(index, scratch.color);
    });
    if (instanced.instanceColor !== null) instanced.instanceColor.needsUpdate = true;
  }, [cubes, scratch]);
  useFrame(({ clock }) => {
    const instanced = mesh.current;
    if (instanced === null) return;
    const t = clock.getElapsedTime();
    const target = pointer.current;
    const painted = { any: false };
    cubes.forEach((cube, index) => {
      const drift = Math.sin(t * 0.25 + cube.phase) * 10;
      const rise = ((t * 3 + cube.phase * 60) % 700) - 350;
      const x = cube.base.x + drift;
      const y = ((cube.base.y + rise + 310) % 620) - 310;
      const z = cube.base.z;
      // The pointer's ray at this cube's depth: unproject the pointer onto the plane z = cube.z.
      let heat = 0;
      if (target.on) {
        scratch.pointerAt.set(target.x, target.y, 0.5).unproject(camera);
        scratch.direction.copy(scratch.pointerAt).sub(camera.position).normalize();
        const along = (z - camera.position.z) / scratch.direction.z;
        scratch.pointerAt.copy(camera.position).addScaledVector(scratch.direction, along);
        const dx = x - scratch.pointerAt.x;
        const dy = y - scratch.pointerAt.y;
        const distance = Math.hypot(dx, dy);
        if (distance < REACH) {
          heat = 1 - distance / REACH;
          const force = heat * heat * 34;
          const inv = distance === 0 ? 0 : 1 / distance;
          cube.push.x += (dx * inv * force - cube.push.x) * 0.12;
          cube.push.y += (dy * inv * force - cube.push.y) * 0.12;
        }
      }
      cube.push.multiplyScalar(0.94);
      scratch.dummy.position.set(x + cube.push.x, y + cube.push.y, z);
      scratch.dummy.rotation.set(
        t * cube.spin.x + cube.phase,
        t * cube.spin.y + heat * 1.2,
        t * cube.spin.z,
      );
      const scale = cube.size * (1 + heat * 0.6);
      scratch.dummy.scale.set(scale, scale, scale);
      scratch.dummy.updateMatrix();
      instanced.setMatrixAt(index, scratch.dummy.matrix);
      if (heat > 0.02 || cube.push.lengthSq() > 0.5) {
        scratch.lit
          .copy(scratch.dim)
          .lerp(cube.tint > 0.85 ? scratch.ember : scratch.cyan, Math.min(1, 0.15 + heat));
        instanced.setColorAt(index, scratch.lit);
        painted.any = true;
      } else if (cube.push.lengthSq() <= 0.5 && cube.push.lengthSq() > 0.2) {
        scratch.color
          .copy(scratch.dim)
          .lerp(cube.tint > 0.85 ? scratch.ember : scratch.cyan, cube.tint > 0.7 ? 0.35 : 0);
        instanced.setColorAt(index, scratch.color);
        painted.any = true;
      }
    });
    instanced.instanceMatrix.needsUpdate = true;
    if (painted.any && instanced.instanceColor !== null) {
      instanced.instanceColor.needsUpdate = true;
    }
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, CUBES]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.55} metalness={0.35} />
    </instancedMesh>
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
      <fog attach="fog" args={[new Color(COLORS.stage), 260, 720]} />
      <Wash pointer={pointer} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[120, 200, 160]} intensity={1.4} />
      <pointLight position={[-200, -100, 120]} color={COLORS.cyan} intensity={4000} />
      <Cloud pointer={pointer} />
    </Canvas>
  );
}
