'use client';

import type { Event } from '@debrief/schema';
import { COLORS } from '@debrief/ui';
import { Html } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { AdditiveBlending, CatmullRomCurve3, Color, Vector3 } from 'three';

import type { MapFrame } from '../lib/map-layout';
import { shortLabel } from '../lib/map-layout';
import {
  type CameraPose,
  PLATFORM_HEIGHT,
  type StageEdge,
  type StageModel,
  type StageNode,
  blastFocus,
  cameraPose,
  focusPoints,
  packetPhase,
  pointAt,
} from '../lib/stage-model';

export interface Stage3DProps {
  model: StageModel;
  frame: MapFrame;
  previous?: MapFrame;
  t: number;
  eventT?: number;
  currentEvent?: Event;
  divergenceNodeId?: string;
  diverged: boolean;
  frozen: boolean;
  hops: ReadonlyMap<string, number>;
  progress: number;
  onSelect?: (nodeId: string) => void;
  onFrame?: (drawCalls: number) => void;
}

const BLAST_RADIUS = 48;

// Draw calls are read after the frame renders: useFrame with a priority above zero runs after the default render pass.
function Rig({ pose, onFrame }: { pose: CameraPose; onFrame?: (drawCalls: number) => void }) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  // The canvas draws once as it mounts, before this rig exists: ask for one more frame with the pose applied.
  useEffect(() => {
    invalidate();
  }, [invalidate]);
  useFrame(() => {
    camera.position.set(...pose.position);
    camera.lookAt(...pose.target);
  });
  useFrame(({ scene, camera: active }) => {
    gl.render(scene, active);
    onFrame?.(gl.info.render.calls);
  }, 1);
  return null;
}

function Platform({ zone, hot }: { zone: StageModel['zones'][number]; hot: boolean }) {
  const [w, d] = zone.size;
  return (
    <group position={[zone.center[0], 0, zone.center[2]]}>
      <mesh position={[0, PLATFORM_HEIGHT / 2, 0]}>
        <boxGeometry args={[w, PLATFORM_HEIGHT, d]} />
        <meshStandardMaterial
          color="#20202c"
          emissive={hot ? COLORS.emberDim : '#0c1118'}
          emissiveIntensity={hot ? 0.9 : 0.6}
          roughness={0.7}
          metalness={0.2}
        />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[w + 1.2, 0.4, d + 1.2]} />
        <meshBasicMaterial color={hot ? COLORS.ember : '#3a3a4c'} />
      </mesh>
      <Html
        position={[
          zone.labelAt[0] - zone.center[0],
          zone.labelAt[1],
          zone.labelAt[2] - zone.center[2],
        ]}
        zIndexRange={[4, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <span
          className={`font-mono text-[10px] tracking-[0.2em] whitespace-nowrap uppercase ${hot ? 'text-ember' : 'text-text-muted'}`}
          data-testid="zone-label"
          data-zone={zone.id}
        >
          {zone.label}
        </span>
      </Html>
    </group>
  );
}

function Glyph({ node, color, emissive }: { node: StageNode; color: string; emissive: string }) {
  const material = (
    <meshStandardMaterial
      color={color}
      emissive={emissive}
      emissiveIntensity={0.8}
      roughness={0.4}
      metalness={0.3}
    />
  );
  switch (node.type) {
    case 'tool':
    case 'system':
      return (
        <mesh>
          <boxGeometry args={[5, 5, 5]} />
          {material}
        </mesh>
      );
    case 'grant':
      return (
        <mesh>
          <octahedronGeometry args={[3.6]} />
          {material}
        </mesh>
      );
    case 'resource':
      return (
        <mesh>
          <cylinderGeometry args={[3.4, 3.4, 2.2, 18]} />
          {material}
        </mesh>
      );
    case 'llm':
      return (
        <mesh>
          <icosahedronGeometry args={[3.4, 0]} />
          {material}
        </mesh>
      );
    default:
      return (
        <mesh>
          <sphereGeometry args={[3.2, 20, 14]} />
          {material}
        </mesh>
      );
  }
}

function Edge({
  edge,
  current,
  accent,
  phase,
}: {
  edge: StageEdge;
  current: boolean;
  accent: string;
  phase: number;
}) {
  const curve = useMemo(
    () => new CatmullRomCurve3(edge.points.map((point) => new Vector3(...point))),
    [edge],
  );
  const packet = pointAt(edge.points, phase);
  return (
    <group>
      <mesh>
        <tubeGeometry args={[curve, 24, current ? 0.7 : 0.35, 5, false]} />
        <meshBasicMaterial
          color={current ? accent : '#4a4a5c'}
          transparent
          opacity={current ? 0.95 : 0.55}
        />
      </mesh>
      {current && phase < 1 ? (
        <mesh position={[packet[0], packet[1], packet[2]]}>
          <sphereGeometry args={[2.2, 10, 8]} />
          <meshBasicMaterial color={accent} transparent opacity={0.9} />
        </mesh>
      ) : null}
    </group>
  );
}

function Ring({
  position,
  radius,
  color,
  opacity,
  tube = 0.6,
}: {
  position: readonly [number, number, number];
  radius: number;
  color: string;
  opacity: number;
  tube?: number;
}) {
  return (
    <mesh position={[position[0], position[1], position[2]]} rotation={[-Math.PI / 2, 0, 0]}>
      <torusGeometry args={[radius, tube, 6, 48]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        blending={AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

// ARCHITECTURE §11: the stage is a pure function of the clock — platforms never move, objects light as events touch them,
// the camera glides to where the story is. Rendered on demand: a frame only when the clock or a prop changes.
export function Stage3D({
  model,
  frame,
  previous,
  t,
  eventT,
  currentEvent,
  divergenceNodeId,
  diverged,
  frozen,
  hops,
  progress,
  onSelect,
  onFrame,
}: Stage3DProps) {
  const accent = currentEvent?.provenance === 'observed' ? COLORS.ember : COLORS.cyan;
  const byId = useMemo(() => new Map(model.nodes.map((node) => [node.id, node])), [model]);
  const focus = focusPoints(model, frame, previous);
  const blast = diverged ? blastFocus(model, divergenceNodeId) : undefined;
  const pose = cameraPose(model, {
    t,
    eventT: blast === undefined ? eventT : undefined,
    previous: blast ?? focus.previous,
    current: blast ?? focus.current,
    pushed: diverged,
  });
  const cursor = frame.cursor === undefined ? undefined : byId.get(frame.cursor);
  const divergence = divergenceNodeId === undefined ? undefined : byId.get(divergenceNodeId);
  const origin = [...hops.entries()].find(([, hop]) => hop === 0)?.[0];
  const originNode = origin === undefined ? undefined : byId.get(origin);
  const phase = packetPhase(t, eventT);
  const pulse = 1 + 0.08 * Math.sin(t / 120);
  return (
    <Canvas
      dpr={[1, 1.5]}
      frameloop="demand"
      camera={{ fov: 44, near: 1, far: 1200, position: pose.position as [number, number, number] }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      style={{ background: 'transparent' }}
      onPointerMissed={() => undefined}
    >
      <fog attach="fog" args={[new Color(COLORS.stage), 420, 980]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[90, 220, 140]} intensity={1.1} />
      {cursor === undefined ? null : (
        <pointLight
          position={[cursor.position[0], cursor.position[1] + 18, cursor.position[2]]}
          color={accent}
          intensity={900}
          distance={120}
          decay={2}
        />
      )}
      <Rig pose={pose} onFrame={onFrame} />
      <mesh position={[0, -1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1400, 1000]} />
        <meshStandardMaterial color="#0e0e15" roughness={1} metalness={0} />
      </mesh>
      {model.zones.map((zone) => (
        <Platform key={zone.id} zone={zone} hot={diverged && zone.id === 'production'} />
      ))}
      {model.edges.map((edge) =>
        frame.traversed.has(edge.id) ? (
          <Edge
            key={edge.id}
            edge={edge}
            current={frame.currentEdges.has(edge.id)}
            accent={accent}
            phase={phase}
          />
        ) : null,
      )}
      {model.nodes.map((node) => {
        const touched = frame.touched.has(node.id);
        const current = frame.currentNodes.has(node.id);
        const hop = hops.get(node.id);
        const burnt = hop !== undefined && progress >= hop;
        const state = burnt ? 'burnt' : current ? 'current' : touched ? 'touched' : 'idle';
        const color = burnt
          ? COLORS.emberDim
          : current
            ? accent
            : touched
              ? COLORS.textMuted
              : COLORS.stageEdge;
        const emissive = burnt ? COLORS.ember : current ? accent : '#000000';
        return (
          <group key={node.id} position={[node.position[0], node.position[1], node.position[2]]}>
            <group
              onClick={(event) => {
                event.stopPropagation();
                onSelect?.(node.id);
              }}
            >
              <Glyph node={node} color={color} emissive={emissive} />
            </group>
            {current || burnt ? (
              <mesh>
                <sphereGeometry args={[7.5, 14, 10]} />
                <meshBasicMaterial
                  color={burnt ? COLORS.ember : accent}
                  transparent
                  opacity={0.16}
                  blending={AdditiveBlending}
                  depthWrite={false}
                />
              </mesh>
            ) : null}
            <Html
              position={[node.labelAt[0] - node.position[0], 0, 0]}
              zIndexRange={[5, 0]}
              style={{ pointerEvents: 'none' }}
            >
              <span
                className={`whitespace-nowrap text-[12px] ${node.type === 'resource' || node.type === 'grant' ? 'font-mono' : 'font-sans'} ${
                  burnt ? 'text-ember' : touched ? 'text-text' : 'text-text-muted'
                }`}
                style={{ textShadow: '0 1px 6px rgba(0,0,0,0.9)' }}
                data-testid="node-label"
                data-node={node.id}
                data-state={state}
              >
                {shortLabel(node)}
              </span>
            </Html>
          </group>
        );
      })}
      {cursor === undefined ? null : (
        <group scale={[pulse, pulse, pulse]} position={[cursor.position[0], 0, cursor.position[2]]}>
          <Ring
            position={[0, cursor.position[1] - 0.5, 0]}
            radius={7}
            color={accent}
            opacity={0.9}
          />
          <Html
            position={[0, cursor.position[1] + 9, 0]}
            zIndexRange={[5, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <span className="sr-only" data-testid="cursor-node" data-node={cursor.id} />
          </Html>
        </group>
      )}
      {diverged && divergence !== undefined ? (
        <Ring
          position={[divergence.position[0], PLATFORM_HEIGHT + 0.6, divergence.position[2]]}
          radius={frozen ? 14 : 10}
          color={COLORS.ember}
          opacity={0.85}
          tube={0.9}
        />
      ) : null}
      {progress > 0 && originNode !== undefined ? (
        <Ring
          position={[originNode.position[0], PLATFORM_HEIGHT + 0.8, originNode.position[2]]}
          radius={Math.min(progress, hops.size) * BLAST_RADIUS}
          color={COLORS.ember}
          opacity={Math.max(0.05, 0.7 - progress * 0.22)}
          tube={1.4}
        />
      ) : null}
    </Canvas>
  );
}
