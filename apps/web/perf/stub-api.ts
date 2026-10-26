import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';

import { SAMPLE_POLICIES, parsePolicy } from '@debrief/policy';
import {
  authorityLineage,
  blastRadius,
  counterfactual,
  direct,
  divergence,
  layout,
  reconstructGraph,
} from '@debrief/reconstruct';
import { DEMO_RUN_ID, demoRunFixture } from '@debrief/reconstruct/fixtures';
import type { Event, Run } from '@debrief/schema';
import { z } from 'zod';

import { liveEvent } from '../src/lib/__fixtures__/live';
import { SIM_SYSTEMS } from '../src/lib/approach-sim';

export interface StubApi {
  url: string;
  runId: string;
  freezeEventId: string;
  streams(): number;
  emit(batch: readonly Event[]): void;
  close(): Promise<void>;
}

const PROD_GUARD = SAMPLE_POLICIES['prod-guard'] ?? '';
const policyBody = z.object({ policy: z.string().optional() });
const FLEET = 8;

// One beat of a small fleet on the fictional systems: four agents turn to another system, the first with a critical call.
export const fleetBeat = (beat: number): Event[] =>
  Array.from({ length: 4 }, (_, index) => {
    const agent = (beat * 3 + index) % FLEET;
    return liveEvent({
      runId: `fleet-${String(agent)}`,
      actor: {
        type: 'agent',
        id: `fleet-agent-${String(agent)}`,
        name: `fleet-agent-${String(agent)}`,
      },
      authority: { principalId: `human:pilot-${String(agent % 3)}` },
      target: {
        system: SIM_SYSTEMS[(beat + index * 3) % SIM_SYSTEMS.length] ?? 'orbital',
        risk: index === 0 ? 'critical' : 'low',
      },
      summary: `fleet-agent-${String(agent)} beat ${String(beat)}`,
    });
  });

// The demo run served the way the API serves it (ReconstructionService), so browser checks need no database.
export async function startStubApi(port: number): Promise<StubApi> {
  const events = demoRunFixture().filter((event) => event.runId === DEMO_RUN_ID);
  const graph = reconstructGraph(events, { runId: DEMO_RUN_ID });
  const report = divergence(events, parsePolicy(PROD_GUARD), graph);
  const origin = report.freezeFrame?.nodeId;
  const blast = origin === undefined ? undefined : blastRadius(graph, origin, events);
  const placed = layout(graph, DEMO_RUN_ID);
  const first = events[0];
  const last = events.at(-1);
  const freezeEventId = report.freezeFrame?.eventId;
  if (first === undefined || last === undefined || freezeEventId === undefined) {
    throw new Error('the demo fixture has no run or no freeze frame');
  }
  const run: Run = {
    id: DEMO_RUN_ID,
    tenantId: first.tenantId,
    principalId: 'human:aaryan',
    agentName: 'orbital-agent',
    startedAt: first.ts,
    endedAt: last.ts,
    eventCount: events.length,
    status: 'ended',
    riskMax: 'critical',
    divergenceCount: report.points.length,
    graphVersion: 1,
  };
  const graphResponse = {
    runId: DEMO_RUN_ID,
    headSeq: last.seq,
    graph,
    layout: placed,
    keyframes: direct(graph, placed, report, blast),
    divergence: report,
    cached: { events: true, layout: true },
  };
  const open = new Set<ServerResponse>();
  const json = (response: ServerResponse, status: number, body: unknown): void => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  const readBody = async (request: IncomingMessage): Promise<unknown> => {
    let text = '';
    for await (const chunk of request) text += String(chunk);
    return text === '' ? {} : JSON.parse(text);
  };
  const answer = (path: string, node: string): unknown => {
    if (path === '/v1/runs') return { runs: [run] };
    if (path === '/run') return run;
    if (path === '/run/events') return { events };
    if (path === '/run/graph') return graphResponse;
    if (path === '/run/blast') return blastRadius(graph, node, events);
    if (path === '/run/lineage') return authorityLineage(graph, node, events);
    return undefined;
  };
  const route = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://stub');
    const path = url.pathname.replace(`/v1/runs/${DEMO_RUN_ID}`, '/run');
    if (path === '/v1/live') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      response.write(': stub\n\n');
      open.add(response);
      request.on('close', () => {
        open.delete(response);
      });
      return;
    }
    if (path === '/run/counterfactual' && request.method === 'POST') {
      const { policy = PROD_GUARD } = policyBody.parse(await readBody(request));
      json(response, 200, counterfactual(events, parsePolicy(policy), graph));
      return;
    }
    const body = answer(path, url.searchParams.get('node') ?? '');
    if (body === undefined) json(response, 404, { message: `stub: no ${url.pathname}` });
    else json(response, 200, body);
  };
  const server = createServer((request, response) => {
    route(request, response).catch((error: unknown) => {
      json(response, 500, { message: error instanceof Error ? error.message : 'stub failed' });
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${String(port)}`,
    runId: DEMO_RUN_ID,
    freezeEventId,
    streams: () => open.size,
    emit: (batch) => {
      const frames = batch
        .map(
          (event) => `event: event\nid: ${String(event.seq)}\ndata: ${JSON.stringify(event)}\n\n`,
        )
        .join('');
      for (const response of open) response.write(frames);
    },
    close: async () => {
      for (const response of open) response.end();
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}
