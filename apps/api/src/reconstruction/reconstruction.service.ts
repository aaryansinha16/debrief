import {
  type Counterfactual,
  type Policy,
  PolicyParseError,
  SAMPLE_POLICIES,
  parsePolicy,
} from '@debrief/policy';
import {
  type AuthorityLineage,
  type BlastRadius,
  type CausalGraph,
  type DivergenceReport,
  GRAPH_VERSION,
  type Keyframe,
  LAYOUT_VERSION,
  type Layout,
  authorityLineage,
  blastRadius,
  counterfactual,
  direct,
  divergence,
  layout as layoutGraph,
  reconstructGraph,
} from '@debrief/reconstruct';
import type { Event } from '@debrief/schema';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { EventsRepository } from '../events/events.repository.js';
import { RunsRepository } from '../runs/runs.repository.js';
import { RunsService } from '../runs/runs.service.js';

export interface Reconstruction {
  runId: string;
  headSeq: number;
  events: Event[];
  graph: CausalGraph;
}

interface StoredLayout {
  layoutVersion: string;
  graphVersion: string;
  headSeq: number;
  seed: string;
  layout: Layout;
}

export interface GraphResponse {
  runId: string;
  headSeq: number;
  graph: CausalGraph;
  layout: Layout;
  keyframes: Keyframe[];
  divergence: DivergenceReport;
  cached: { events: boolean; layout: boolean };
}

export interface PolicyBody {
  policyId?: string;
  policy?: string;
}

const PAGE = 1000;

// ARCHITECTURE §13: reconstructions are cached per run and keyed by the run's head seq, so any new event invalidates them.
@Injectable()
export class ReconstructionService {
  private readonly cache = new Map<string, Reconstruction>();

  constructor(
    private readonly events: EventsRepository,
    private readonly runsRepository: RunsRepository,
    private readonly runs: RunsService,
  ) {}

  async load(tenantId: string, runId: string): Promise<Reconstruction & { fromCache: boolean }> {
    const headSeq = await this.events.headOfRun(tenantId, runId);
    if (headSeq === undefined) throw new NotFoundException('run not found');
    const key = `${tenantId}\t${runId}`;
    const cached = this.cache.get(key);
    if (cached?.headSeq === headSeq) return { ...cached, fromCache: true };
    const events: Event[] = [];
    let from = 0;
    for (;;) {
      const page = await this.events.listByRun(tenantId, runId, from, undefined, PAGE);
      events.push(...page);
      const last = page[page.length - 1];
      if (page.length < PAGE || last === undefined) break;
      from = last.seq + 1;
    }
    const reconstruction: Reconstruction = {
      runId,
      headSeq,
      events,
      graph: reconstructGraph(events, { runId }),
    };
    this.cache.set(key, reconstruction);
    return { ...reconstruction, fromCache: false };
  }

  async graph(
    tenantId: string,
    runId: string,
    policyId: string,
    seed?: string,
  ): Promise<GraphResponse> {
    const loaded = await this.load(tenantId, runId);
    const policy = this.resolvePolicy({ policyId });
    const report = divergence(loaded.events, policy, loaded.graph);
    const blast =
      report.freezeFrame?.nodeId === undefined
        ? undefined
        : blastRadius(loaded.graph, report.freezeFrame.nodeId, loaded.events);
    const { layout, cached } = await this.layoutFor(
      tenantId,
      loaded,
      seed ?? runId,
      seed === undefined,
    );
    return {
      runId,
      headSeq: loaded.headSeq,
      graph: loaded.graph,
      layout,
      keyframes: direct(loaded.graph, layout, report, blast),
      divergence: report,
      cached: { events: loaded.fromCache, layout: cached },
    };
  }

  // The layout is the expensive part: reused from `runs.layout` while the head seq and both versions still match.
  private async layoutFor(
    tenantId: string,
    loaded: Reconstruction,
    seed: string,
    persist: boolean,
  ): Promise<{ layout: Layout; cached: boolean }> {
    if (persist) {
      const run = await this.runs.get(tenantId, loaded.runId);
      const stored = run?.layout as StoredLayout | undefined;
      if (
        stored?.layoutVersion === LAYOUT_VERSION &&
        stored.graphVersion === GRAPH_VERSION &&
        stored.headSeq === loaded.headSeq &&
        stored.seed === seed
      ) {
        return { layout: stored.layout, cached: true };
      }
    }
    const layout = layoutGraph(loaded.graph, seed);
    if (persist) {
      const stored: StoredLayout = {
        layoutVersion: LAYOUT_VERSION,
        graphVersion: GRAPH_VERSION,
        headSeq: loaded.headSeq,
        seed,
        layout,
      };
      await this.runsRepository.storeLayout(
        tenantId,
        loaded.runId,
        { ...stored },
        Number(GRAPH_VERSION),
      );
    }
    return { layout, cached: false };
  }

  async blast(
    tenantId: string,
    runId: string,
    node: string,
    includeWeak: boolean,
  ): Promise<BlastRadius> {
    const loaded = await this.load(tenantId, runId);
    this.assertNode(loaded.graph, node);
    return blastRadius(loaded.graph, node, loaded.events, { includeWeak });
  }

  async lineage(tenantId: string, runId: string, node: string): Promise<AuthorityLineage> {
    const loaded = await this.load(tenantId, runId);
    this.assertNode(loaded.graph, node);
    return authorityLineage(loaded.graph, node, loaded.events);
  }

  async divergence(tenantId: string, runId: string, body: PolicyBody): Promise<DivergenceReport> {
    const loaded = await this.load(tenantId, runId);
    return divergence(loaded.events, this.resolvePolicy(body), loaded.graph);
  }

  async counterfactual(
    tenantId: string,
    runId: string,
    body: PolicyBody,
  ): Promise<Counterfactual & { runId: string }> {
    const loaded = await this.load(tenantId, runId);
    return counterfactual(loaded.events, this.resolvePolicy(body), loaded.graph);
  }

  resolvePolicy(body: PolicyBody): Policy {
    const text =
      body.policy ?? (body.policyId === undefined ? undefined : SAMPLE_POLICIES[body.policyId]);
    if (text === undefined) {
      throw new BadRequestException(
        `policy yaml or one of policyId ${Object.keys(SAMPLE_POLICIES).join(', ')} is required`,
      );
    }
    try {
      return parsePolicy(text);
    } catch (error) {
      if (error instanceof PolicyParseError) {
        throw new BadRequestException({ message: 'invalid policy', issues: error.issues });
      }
      throw error;
    }
  }

  private assertNode(graph: CausalGraph, node: string): void {
    if (!graph.nodes.some((candidate) => candidate.id === node)) {
      throw new NotFoundException('node not found in this run');
    }
  }
}
