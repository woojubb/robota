// DAG workflow file format types (.dag.json + .dag.robota.json pair)
//
// The primary .dag.json uses an open node-graph layout format. This makes the
// file compatible with visual graph tools and human-readable.
//
// Robota-specific extensions (dagId, string nodeIds, retry policies, etc.)
// that cannot be expressed in the base format go into the optional companion
// .dag.robota.json file.

import type { ICostPolicy, TDagDefinitionStatus } from './domain.js';

/**
 * A link between two nodes in the workflow file.
 * Tuple: [linkId, sourceNodeNumId, sourceSlotIndex, targetNodeNumId, targetSlotIndex, portType]
 */
export type TWorkflowLink = [number, number, number, number, number, string];

/** An input slot on a workflow node. */
export interface IDagWorkflowNodeInput {
  name: string;
  type: string;
  /** Null when the input is a widget (config value) rather than a node connection. */
  link: number | null;
}

/** An output slot on a workflow node. */
export interface IDagWorkflowNodeOutput {
  name: string;
  type: string;
  /** IDs of links that originate from this output slot. */
  links: number[];
  slot_index?: number;
}

/** A single node in a workflow file. */
export interface IDagWorkflowNode {
  /** Sequential numeric ID (1-based) unique within the workflow file. */
  id: number;
  /** Robota node type in PascalCase with `Robota` prefix (e.g. `RobotaLlmTextAnthropic`). */
  type: string;
  /** Canvas position [x, y]. */
  pos: [number, number];
  size?: [number, number];
  flags?: Record<string, unknown>;
  /** Execution order hint (informational only). */
  order?: number;
  mode?: number;
  /** Connection input slots (linked ports only; widget ports are omitted). */
  inputs?: IDagWorkflowNodeInput[];
  /** Output slots. */
  outputs?: IDagWorkflowNodeOutput[];
  properties?: Record<string, unknown>;
  /** Config values for display in visual editors. The authoritative config is in properties.robota_config. */
  widgets_values?: unknown[];
}

/** The primary DAG file format (.dag.json). */
export interface IDagWorkflowFile {
  last_node_id: number;
  last_link_id: number;
  nodes: IDagWorkflowNode[];
  links: TWorkflowLink[];
  groups?: unknown[];
  config?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  /** Format version. Current: 0.4 */
  version: number;
}

/** Per-node metadata in the companion file. Keyed by workflow numeric node ID (stringified). */
export interface IDagRobotaCompanionNodeMeta {
  /** Original Robota string nodeId (e.g. "input", "llm-1"). */
  nodeId: string;
  retryPolicy?: string;
  timeoutMs?: number;
  costPolicy?: ICostPolicy;
}

/** Optional companion file (.dag.robota.json) — Robota-specific extensions to a .dag.json. */
export interface IDagRobotaCompanion {
  dagId: string;
  version: number;
  status: TDagDefinitionStatus;
  costPolicy?: ICostPolicy;
  inputSchema?: string;
  outputSchema?: string;
  /** Relative paths (from this file) to local node files required by this DAG. */
  nodeFiles?: string[];
  /** Maps workflow numeric node ID (as string key) → Robota node metadata. */
  nodes: Record<string, IDagRobotaCompanionNodeMeta>;
}
