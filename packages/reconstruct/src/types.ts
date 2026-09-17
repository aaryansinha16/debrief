export type NodeType =
  | 'principal'
  | 'human'
  | 'agent'
  | 'subagent'
  | 'grant'
  | 'llm'
  | 'tool'
  | 'system'
  | 'resource'
  | 'policy';

export type EdgeType =
  | 'triggers'
  | 'calls'
  | 'returns'
  | 'authorized_by'
  | 'delegates_to'
  | 'mutates'
  | 'observes'
  | 'messages';

export type Confidence = 'exact' | 'strong' | 'weak';

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  ts: string;
  eventIds: string[];
}

export interface GraphEdge {
  from: string;
  to: string;
  type: EdgeType;
  confidence: Confidence;
  eventIds: string[];
}

export interface CausalGraph {
  runId: string;
  version: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Bump when buildGraph's output for the same events changes; runs.graphVersion invalidates cached layouts.
export const GRAPH_VERSION = '1';

export const CONFIDENCE_RANK: Record<Confidence, number> = { weak: 0, strong: 1, exact: 2 };
