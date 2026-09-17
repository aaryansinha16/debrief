'use client';

import type { Risk } from '@debrief/schema';
import { COLORS } from '@debrief/ui';
import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  type InstancedMesh,
  Matrix4,
  type Points,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import type { StoreApi } from 'zustand/vanilla';

import { type ApproachState, MAX_AGENTS, PULSE_MS } from '../lib/approach';
import { AgentField, LOD_AGENT_THRESHOLD, TRAIL, ZoneField } from '../lib/approach-field';
import { hexToRgb } from '../lib/scene';
import { type RenderStats, RenderMeter } from './render-meter';
import { FLAT_FRAGMENT, LINE_PX, QUAD_LINE_GLSL } from './stage-shaders';

export interface StageLabel {
  kind: 'zone' | 'principal';
  name: string;
  x: number;
  y: number;
  events: number;
  riskMax?: Risk;
}

export interface ApproachCanvasProps {
  store: StoreApi<ApproachState>;
  capacity?: number;
  hovered?: number;
  onHover: (slot: number | undefined) => void;
  onSelect?: (slot: number) => void;
  onLabels?: (labels: StageLabel[]) => void;
  onRender?: (stats: RenderStats) => void;
  onFrame?: (ms: number) => void;
  frameloop?: 'always' | 'demand';
}

export const MAX_ZONES = 64;
const SLAB = { width: 30, depth: 18, height: 5 };
const RISKS: readonly Risk[] = ['low', 'medium', 'high', 'critical'];
const EMBER = new Color(...hexToRgb(COLORS.ember));
const LEASH = hexToRgb(COLORS.cyanDim).map((channel) => channel * 0.7) as [number, number, number];
export const MAX_PRINCIPALS = 256;

// Agents are point impostors (D-048): one draw for the whole fleet, `dim` fades idle ones, `lift` marks the hovered one.
const AGENT_VERTEX = `
attribute vec3 color;
attribute float size;
attribute float dim;
attribute float lift;
uniform float uHeight;
varying vec3 vColor;
varying float vLift;
void main() {
  vColor = color * (1.0 - dim * 0.75);
  vLift = lift;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float px = size * (1.0 + lift * 0.5) * uHeight * projectionMatrix[1][1] / -mvPosition.z;
  gl_PointSize = clamp(px, 2.0, 24.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const AGENT_FRAGMENT = `
precision mediump float;
varying vec3 vColor;
varying float vLift;
void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float d = dot(uv, uv);
  if (d > 1.0) discard;
  float light = 0.6 + 0.4 * (1.0 - d);
  gl_FragColor = vec4(mix(vColor, vec3(1.0), vLift * 0.5) * light, 1.0);
}
`;

// Far LOD beyond LOD_AGENT_THRESHOLD: flat squares capped at a few pixels, no discard, like the graph's far dots (D-048).
const AGENT_FAR_VERTEX = `
attribute vec3 color;
attribute float size;
attribute float dim;
attribute float lift;
uniform float uHeight;
varying vec3 vColor;
void main() {
  vColor = color * (1.0 - dim * 0.75) * (1.0 + lift * 0.6);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float px = size * 0.6 * uHeight * projectionMatrix[1][1] / -mvPosition.z;
  gl_PointSize = clamp(px, 1.5, 5.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

// Trails are the agents' last TRAIL samples as smaller, dimmer points; an aged-out sample leaves the clip volume.
const TRAIL_VERTEX = `
attribute vec3 color;
attribute float age;
uniform float uHeight;
varying vec3 vColor;
void main() {
  vColor = color * (1.0 - age) * 0.8;
  if (age >= 1.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    gl_PointSize = 1.0;
    return;
  }
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float px = 1.8 * (1.0 - age) * uHeight * projectionMatrix[1][1] / -mvPosition.z;
  gl_PointSize = clamp(px, 1.0, 6.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

// Principals are flat off-white squares on the row: the anchors the leashes run to.
const PRINCIPAL_VERTEX = `
uniform float uHeight;
uniform vec3 uColor;
varying vec3 vColor;
void main() {
  vColor = uColor;
  gl_PointSize = clamp(0.012 * uHeight, 5.0, 12.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const LEASH_VERTEX = `
attribute vec3 other;
attribute float side;
attribute float dim;
uniform vec3 uColor;
varying vec3 vColor;
${QUAD_LINE_GLSL}
void main() {
  vColor = uColor * (1.0 - dim * 0.75);
  gl_Position = quadLine(position, other, side);
}
`;

// ARCHITECTURE §11: risk zones pulse via a shader uniform; the pulse decays from the instance's pulseAt against uNow.
const SLAB_VERTEX = `
attribute float pulseAt;
attribute float pulseStrength;
attribute float riskRank;
uniform float uNow;
varying float vPulse;
varying float vRisk;
varying float vTop;
void main() {
  vPulse = pulseStrength * exp(-max(uNow - pulseAt, 0.0) / 450.0);
  vRisk = riskRank;
  vTop = normal.z;
  vec3 scaled = vec3(position.xy * (1.0 + vPulse * 0.08), position.z);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(scaled, 1.0);
}
`;

const SLAB_FRAGMENT = `
precision mediump float;
uniform vec3 uBase;
uniform vec3 uEmber;
varying float vPulse;
varying float vRisk;
varying float vTop;
void main() {
  vec3 base = mix(uBase * 0.7, uBase * 1.25, smoothstep(0.0, 1.0, vTop));
  vec3 color = mix(base, uEmber, max(vRisk, 0.0) / 3.0 * 0.35);
  gl_FragColor = vec4(mix(color, uEmber, vPulse), 1.0);
}
`;

const upload = (attribute: BufferAttribute | InstancedBufferAttribute, count: number): void => {
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, count);
  attribute.needsUpdate = true;
};

const sideAttribute = (count: number): BufferAttribute =>
  new BufferAttribute(
    Float32Array.from({ length: count * 4 }, (_, index) => (index % 2 === 0 ? -1 : 1)),
    1,
  );

const quadIndex = (count: number): BufferAttribute => {
  const index = new Uint32Array(count * 6);
  for (let quad = 0; quad < count; quad += 1) {
    const base = quad * 4;
    index.set([base, base + 1, base + 2, base, base + 2, base + 3], quad * 6);
  }
  return new BufferAttribute(index, 1);
};

function Stage({
  store,
  capacity,
  hovered,
  onHover,
  onSelect,
  onLabels,
  onFrame,
}: Required<Pick<ApproachCanvasProps, 'store' | 'capacity'>> &
  Pick<ApproachCanvasProps, 'hovered' | 'onHover' | 'onSelect' | 'onLabels' | 'onFrame'>) {
  const invalidate = useThree((state) => state.invalidate);
  const raycaster = useThree((state) => state.raycaster);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const agents = useMemo(() => new AgentField(capacity, store.getState().seed), [capacity, store]);
  const zones = useMemo(() => new ZoneField(), []);
  const slabs = useRef<InstancedMesh>(null);
  const agentPoints = useRef<Points>(null);
  const last = useRef<number | undefined>(undefined);
  const labelKey = useRef('');
  const principalVersion = useRef(-1);
  const buffers = useMemo(() => {
    const agentGeometry = new BufferGeometry();
    agentGeometry.setAttribute('position', new BufferAttribute(agents.positions, 3));
    agentGeometry.setAttribute('color', new BufferAttribute(agents.colors, 3));
    agentGeometry.setAttribute('size', new BufferAttribute(agents.sizes, 1));
    agentGeometry.setAttribute('dim', new BufferAttribute(agents.dims, 1));
    agentGeometry.setAttribute('lift', new BufferAttribute(new Float32Array(capacity), 1));
    const trailGeometry = new BufferGeometry();
    trailGeometry.setAttribute('position', new BufferAttribute(agents.trail, 3));
    trailGeometry.setAttribute('age', new BufferAttribute(agents.trailAge, 1));
    trailGeometry.setAttribute(
      'color',
      new BufferAttribute(new Float32Array(capacity * TRAIL * 3), 3),
    );
    const leashGeometry = new BufferGeometry();
    leashGeometry.setAttribute('position', new BufferAttribute(new Float32Array(capacity * 12), 3));
    leashGeometry.setAttribute('other', new BufferAttribute(new Float32Array(capacity * 12), 3));
    leashGeometry.setAttribute('side', sideAttribute(capacity));
    leashGeometry.setAttribute('dim', new BufferAttribute(new Float32Array(capacity * 4), 1));
    leashGeometry.setIndex(quadIndex(capacity));
    const principalGeometry = new BufferGeometry();
    principalGeometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(MAX_PRINCIPALS * 3).fill(1e6), 3),
    );
    const slabGeometry = new BoxGeometry(SLAB.width, SLAB.depth, SLAB.height);
    slabGeometry.translate(0, 0, SLAB.height / 2);
    slabGeometry.setAttribute(
      'pulseAt',
      new InstancedBufferAttribute(new Float32Array(MAX_ZONES).fill(-1e9), 1),
    );
    slabGeometry.setAttribute(
      'pulseStrength',
      new InstancedBufferAttribute(new Float32Array(MAX_ZONES), 1),
    );
    slabGeometry.setAttribute(
      'riskRank',
      new InstancedBufferAttribute(new Float32Array(MAX_ZONES).fill(-1), 1),
    );
    const point = { uHeight: { value: 1 } };
    const agentMaterial = new ShaderMaterial({
      vertexShader: AGENT_VERTEX,
      fragmentShader: AGENT_FRAGMENT,
      uniforms: { ...point },
    });
    const agentFarMaterial = new ShaderMaterial({
      vertexShader: AGENT_FAR_VERTEX,
      fragmentShader: FLAT_FRAGMENT,
      uniforms: { ...point },
      depthTest: false,
      depthWrite: false,
    });
    const trailMaterial = new ShaderMaterial({
      vertexShader: TRAIL_VERTEX,
      fragmentShader: FLAT_FRAGMENT,
      uniforms: { ...point },
      depthWrite: false,
    });
    const principalMaterial = new ShaderMaterial({
      vertexShader: PRINCIPAL_VERTEX,
      fragmentShader: FLAT_FRAGMENT,
      uniforms: { ...point, uColor: { value: new Color(...hexToRgb(COLORS.text)) } },
    });
    const leashMaterial = new ShaderMaterial({
      vertexShader: LEASH_VERTEX,
      fragmentShader: FLAT_FRAGMENT,
      uniforms: {
        uColor: { value: new Color(...LEASH) },
        uResolution: { value: new Vector2(1, 1) },
        uNear: { value: 1 },
        uLineWidth: { value: LINE_PX },
      },
      depthWrite: false,
      side: DoubleSide,
    });
    const slabMaterial = new ShaderMaterial({
      vertexShader: SLAB_VERTEX,
      fragmentShader: SLAB_FRAGMENT,
      uniforms: {
        uNow: { value: 0 },
        uBase: { value: new Color(...hexToRgb(COLORS.stageEdge)) },
        uEmber: { value: EMBER.clone() },
      },
    });
    return {
      agentGeometry,
      trailGeometry,
      leashGeometry,
      principalGeometry,
      slabGeometry,
      agentMaterial,
      agentFarMaterial,
      trailMaterial,
      leashMaterial,
      principalMaterial,
      slabMaterial,
    };
  }, [agents, capacity]);
  useEffect(
    () => () => {
      for (const item of Object.values(buffers)) item.dispose();
    },
    [buffers],
  );
  useLayoutEffect(() => {
    raycaster.params.Points.threshold = 5;
  }, [raycaster]);
  useEffect(
    () =>
      store.subscribe(() => {
        invalidate();
      }),
    [store, invalidate],
  );
  useLayoutEffect(() => {
    const lift = buffers.agentGeometry.getAttribute('lift');
    if (!(lift instanceof BufferAttribute)) return;
    lift.array.fill(0);
    if (hovered !== undefined && hovered < capacity) lift.setX(hovered, 1);
    lift.needsUpdate = true;
    invalidate();
  }, [buffers, hovered, capacity, invalidate]);
  const matrix = useMemo(() => new Matrix4(), []);
  const projected = useMemo(() => new Vector3(), []);
  useFrame((state) => {
    const now = performance.now();
    if (onFrame !== undefined) {
      if (last.current !== undefined) onFrame(now - last.current);
      last.current = now;
    }
    const approach = store.getState();
    agents.sync(approach, now);
    zones.sync(approach, now);
    const moving = agents.step(now);
    const pulsing = zones.step(now, PULSE_MS);
    const count = agents.count;
    const detailed = count <= LOD_AGENT_THRESHOLD;
    const height = state.size.height * state.viewport.dpr;
    buffers.agentMaterial.uniforms.uHeight = { value: height };
    buffers.agentFarMaterial.uniforms.uHeight = { value: height };
    if (agentPoints.current !== null) {
      agentPoints.current.material = detailed ? buffers.agentMaterial : buffers.agentFarMaterial;
    }
    buffers.trailMaterial.uniforms.uHeight = { value: height };
    buffers.principalMaterial.uniforms.uHeight = { value: height };
    buffers.leashMaterial.uniforms.uResolution = {
      value: new Vector2(state.size.width * state.viewport.dpr, height),
    };
    buffers.leashMaterial.uniforms.uNear = {
      value: 'near' in state.camera ? state.camera.near : 1,
    };
    buffers.slabMaterial.uniforms.uNow = { value: now };
    const { agentGeometry, trailGeometry, leashGeometry, principalGeometry, slabGeometry } =
      buffers;
    const principalPosition = principalGeometry.getAttribute('position');
    const principals = Math.min(approach.principals.size, MAX_PRINCIPALS);
    if (
      principalPosition instanceof BufferAttribute &&
      principalVersion.current !== approach.version
    ) {
      principalVersion.current = approach.version;
      let slot = 0;
      for (const position of approach.principals.values()) {
        if (slot >= MAX_PRINCIPALS) break;
        principalPosition.array.set(position, slot * 3);
        slot += 1;
      }
      upload(principalPosition, principals * 3);
    }
    principalGeometry.setDrawRange(0, principals);
    for (const name of ['position', 'color', 'size', 'dim'] as const) {
      const attribute = agentGeometry.getAttribute(name);
      if (attribute instanceof BufferAttribute) upload(attribute, count * attribute.itemSize);
    }
    agentGeometry.setDrawRange(0, count);
    if (detailed) {
      const trailColor = trailGeometry.getAttribute('color');
      if (trailColor instanceof BufferAttribute) {
        for (let slot = 0; slot < count; slot += 1) {
          for (let point = 0; point < TRAIL; point += 1) {
            trailColor.array.set(
              agents.colors.subarray(slot * 3, slot * 3 + 3),
              (slot * TRAIL + point) * 3,
            );
          }
        }
        upload(trailColor, count * TRAIL * 3);
      }
      for (const name of ['position', 'age'] as const) {
        const attribute = trailGeometry.getAttribute(name);
        if (attribute instanceof BufferAttribute)
          upload(attribute, count * TRAIL * attribute.itemSize);
      }
      const leashPosition = leashGeometry.getAttribute('position');
      const leashOther = leashGeometry.getAttribute('other');
      const leashDim = leashGeometry.getAttribute('dim');
      if (
        leashPosition instanceof BufferAttribute &&
        leashOther instanceof BufferAttribute &&
        leashDim instanceof BufferAttribute
      ) {
        for (let slot = 0; slot < count; slot += 1) {
          const agent = agents.positions.subarray(slot * 3, slot * 3 + 3);
          const principal = agents.leashEnds.subarray(slot * 3, slot * 3 + 3);
          for (let vertex = 0; vertex < 4; vertex += 1) {
            const at = (slot * 4 + vertex) * 3;
            leashPosition.array.set(vertex < 2 ? agent : principal, at);
            leashOther.array.set(vertex < 2 ? principal : agent, at);
            leashDim.setX(slot * 4 + vertex, agents.dims[slot] ?? 1);
          }
        }
        upload(leashPosition, count * 12);
        upload(leashOther, count * 12);
        upload(leashDim, count * 4);
      }
    }
    trailGeometry.setDrawRange(0, detailed ? count * TRAIL : 0);
    leashGeometry.setDrawRange(0, detailed ? count * 6 : 0);
    const mesh = slabs.current;
    if (mesh !== null) {
      const pulseAt = slabGeometry.getAttribute('pulseAt');
      const pulseStrength = slabGeometry.getAttribute('pulseStrength');
      const riskRank = slabGeometry.getAttribute('riskRank');
      const shown = Math.min(zones.slots.length, MAX_ZONES);
      for (let index = 0; index < shown; index += 1) {
        const slot = zones.slots[index];
        if (slot === undefined) continue;
        matrix.makeTranslation(slot.position[0], slot.position[1], slot.position[2]);
        mesh.setMatrixAt(index, matrix);
        if (pulseAt instanceof InstancedBufferAttribute) pulseAt.setX(index, slot.pulseAt);
        if (pulseStrength instanceof InstancedBufferAttribute) {
          pulseStrength.setX(index, slot.pulseStrength);
        }
        if (riskRank instanceof InstancedBufferAttribute) riskRank.setX(index, slot.riskRank);
      }
      mesh.count = shown;
      mesh.instanceMatrix.needsUpdate = true;
      for (const attribute of [pulseAt, pulseStrength, riskRank]) {
        if (attribute instanceof InstancedBufferAttribute) upload(attribute, shown);
      }
    }
    if (onLabels !== undefined) {
      const place = (x: number, y: number, z: number): [number, number] => {
        projected.set(x, y, z).project(camera);
        return [((projected.x + 1) / 2) * size.width, ((1 - projected.y) / 2) * size.height];
      };
      const labels: StageLabel[] = zones.slots.map((slot) => {
        const [x, y] = place(slot.position[0], slot.position[1] + SLAB.depth / 2, SLAB.height + 3);
        const label: StageLabel = { kind: 'zone', name: slot.name, x, y, events: slot.events };
        const riskMax = RISKS[slot.riskRank];
        if (riskMax !== undefined) label.riskMax = riskMax;
        return label;
      });
      for (const [name, position] of approach.principals) {
        const [x, y] = place(position[0], position[1], -2);
        labels.push({ kind: 'principal', name, x, y, events: 0 });
      }
      const key = labels
        .map(
          (label) =>
            `${label.kind}:${label.name}:${label.x.toFixed(0)},${label.y.toFixed(0)}:${String(label.events)}:${label.riskMax ?? ''}`,
        )
        .join('|');
      if (key !== labelKey.current) {
        labelKey.current = key;
        onLabels(labels);
      }
    }
    if (moving || pulsing) invalidate();
  });
  return (
    <>
      <instancedMesh
        ref={slabs}
        args={[buffers.slabGeometry, buffers.slabMaterial, MAX_ZONES]}
        frustumCulled={false}
      />
      <mesh
        geometry={buffers.leashGeometry}
        material={buffers.leashMaterial}
        frustumCulled={false}
      />
      <points
        geometry={buffers.principalGeometry}
        material={buffers.principalMaterial}
        frustumCulled={false}
      />
      <points
        geometry={buffers.trailGeometry}
        material={buffers.trailMaterial}
        frustumCulled={false}
      />
      <points
        ref={agentPoints}
        geometry={buffers.agentGeometry}
        material={buffers.agentMaterial}
        frustumCulled={false}
        onPointerMove={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          onHover(
            event.index !== undefined && event.index < agents.count ? event.index : undefined,
          );
        }}
        onPointerOut={() => {
          onHover(undefined);
        }}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          if (event.index !== undefined && event.index < agents.count) onSelect?.(event.index);
        }}
      />
    </>
  );
}

// The approach: a fixed raised camera over the principals' row and the systems' arc; nothing to drag, the feed moves.
export function ApproachCanvas({
  store,
  capacity = MAX_AGENTS,
  hovered,
  onHover,
  onSelect,
  onLabels,
  onRender,
  onFrame,
  frameloop = 'demand',
}: ApproachCanvasProps) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      frameloop={frameloop}
      camera={{ fov: 36, near: 1, far: 2000, position: [0, -300, 330], up: [0, 0, 1] }}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      style={{ background: COLORS.stage }}
      onCreated={({ camera }) => {
        camera.lookAt(0, -30, 0);
      }}
      onPointerMissed={() => {
        onHover(undefined);
      }}
    >
      {onRender === undefined ? null : <RenderMeter onRender={onRender} />}
      <Stage
        store={store}
        capacity={capacity}
        hovered={hovered}
        onHover={onHover}
        onSelect={onSelect}
        onLabels={onLabels}
        onFrame={onFrame}
      />
    </Canvas>
  );
}
