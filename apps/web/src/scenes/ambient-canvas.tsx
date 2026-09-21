'use client';

import { COLORS } from '@debrief/ui';
import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
} from 'three';

import { hexToRgb } from '../lib/scene';

const COUNT = 1400;

const VERTEX = /* glsl */ `
  attribute float seed;
  attribute float tint;
  uniform float uTime;
  varying float vTint;
  varying float vFade;
  void main() {
    vTint = tint;
    vec3 p = position;
    float drift = uTime * (0.02 + seed * 0.03);
    p.x += sin(drift + seed * 6.2831) * 18.0;
    p.y += cos(drift * 0.7 + seed * 3.1) * 12.0 + mod(uTime * (2.0 + seed * 3.0) + seed * 400.0, 400.0) - 200.0;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = clamp((-mv.z - 100.0) / 500.0, 0.0, 1.0);
    vFade = 1.0 - depth * 0.7;
    gl_PointSize = (1.5 + seed * 2.5) * (300.0 / -mv.z) * 4.0;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uEmber;
  uniform vec3 uCyan;
  varying float vTint;
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.2, d) * 0.55 * vFade;
    vec3 c = mix(uCyan, uEmber, vTint);
    gl_FragColor = vec4(c, a);
  }
`;

// A slow field of embers and sparks drifting up behind the page: the recorder is always listening.
function Field() {
  const points = useRef<Points>(null);
  const geometry = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const seeds = new Float32Array(COUNT);
    const tints = new Float32Array(COUNT);
    let state = 7;
    const random = (): number => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
    for (let i = 0; i < COUNT; i += 1) {
      positions[i * 3] = (random() - 0.5) * 900;
      positions[i * 3 + 1] = (random() - 0.5) * 400;
      positions[i * 3 + 2] = -random() * 500;
      seeds[i] = random();
      tints[i] = random() < 0.22 ? 1 : 0;
    }
    const built = new BufferGeometry();
    built.setAttribute('position', new Float32BufferAttribute(positions, 3));
    built.setAttribute('seed', new Float32BufferAttribute(seeds, 1));
    built.setAttribute('tint', new Float32BufferAttribute(tints, 1));
    return built;
  }, []);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uEmber: { value: new Color(...hexToRgb(COLORS.ember)) },
      uCyan: { value: new Color(...hexToRgb(COLORS.cyan)) },
    }),
    [],
  );
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms,
      }),
    [uniforms],
  );
  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.getElapsedTime();
  });
  return <points ref={points} geometry={geometry} material={material} />;
}

export function AmbientCanvas() {
  return (
    <Canvas
      dpr={[1, 1.5]}
      frameloop="always"
      camera={{ fov: 50, near: 1, far: 1200, position: [0, 0, 260] }}
      gl={{ antialias: false, alpha: true, powerPreference: 'low-power' }}
      style={{ background: 'transparent' }}
    >
      <Field />
    </Canvas>
  );
}
