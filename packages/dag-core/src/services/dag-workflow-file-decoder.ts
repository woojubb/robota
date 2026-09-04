/**
 * Total decoders for the `.dag.json` workflow file and its `.dag.robota.json` companion
 * (issue #2077 / DAG-005). The second on-disk DAG format, decoded field by field like the first.
 */

import {
  childPath,
  decodeArray,
  decodeLiteral,
  decodeNumber,
  decodeOptional,
  decodeRecord,
  decodeString,
  decodeStringArray,
  pushIssue,
  type IDagDecodeIssue,
  type TDagDecodeIssues,
  type TDecoded,
} from './dag-decode-primitives.js';
import { DAG_DEFINITION_STATUSES, decodeCostPolicy } from './dag-definition-decoder.js';

import type { TResult } from '../types/result.js';
import type {
  IDagRobotaCompanion,
  IDagRobotaCompanionNodeMeta,
  IDagWorkflowFile,
  IDagWorkflowNode,
  IDagWorkflowNodeInput,
  IDagWorkflowNodeOutput,
  TWorkflowLink,
} from '../types/workflow-file.js';

export type TDagWorkflowFileDecodeResult = TResult<IDagWorkflowFile, IDagDecodeIssue[]>;
export type TDagRobotaCompanionDecodeResult = TResult<IDagRobotaCompanion, IDagDecodeIssue[]>;

export function decodeDagWorkflowFile(value: unknown): TDagWorkflowFileDecodeResult {
  const issues: TDagDecodeIssues = [];
  const file = decodeWorkflowFile(value, '', issues);
  return file !== undefined && issues.length === 0
    ? { ok: true, value: file }
    : { ok: false, error: issues };
}

export function decodeDagRobotaCompanion(value: unknown): TDagRobotaCompanionDecodeResult {
  const issues: TDagDecodeIssues = [];
  const companion = decodeCompanion(value, '', issues);
  return companion !== undefined && issues.length === 0
    ? { ok: true, value: companion }
    : { ok: false, error: issues };
}

function decodeNumberPair(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
): TDecoded<[number, number]> {
  if (!Array.isArray(value) || value.length !== 2) {
    return pushIssue(issues, path, 'expected a [number, number] pair');
  }
  const a = decodeNumber(value[0], childPath(path, 0), issues);
  const b = decodeNumber(value[1], childPath(path, 1), issues);
  return a === undefined || b === undefined ? undefined : [a, b];
}

function decodeLink(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
): TDecoded<TWorkflowLink> {
  if (!Array.isArray(value) || value.length !== 6) {
    return pushIssue(
      issues,
      path,
      'expected a 6-tuple [linkId, srcId, srcSlot, tgtId, tgtSlot, type]',
    );
  }
  const numbers = [0, 1, 2, 3, 4].map((i) => decodeNumber(value[i], childPath(path, i), issues));
  const type = decodeString(value[5], childPath(path, 5), issues);
  if (numbers.some((n) => n === undefined) || type === undefined) return undefined;
  const [a, b, c, d, e] = numbers as [number, number, number, number, number];
  return [a, b, c, d, e, type];
}

function decodeNodeInput(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
): TDecoded<IDagWorkflowNodeInput> {
  const record = decodeRecord(value, path, issues);
  if (record === undefined) return undefined;
  const name = decodeString(record['name'], childPath(path, 'name'), issues);
  const type = decodeString(record['type'], childPath(path, 'type'), issues);
  const rawLink = record['link'];
  const link = rawLink === null ? null : decodeNumber(rawLink, childPath(path, 'link'), issues);
  return name === undefined || type === undefined || link === undefined
    ? undefined
    : { name, type, link };
}

function decodeNodeOutput(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
): TDecoded<IDagWorkflowNodeOutput> {
  const record = decodeRecord(value, path, issues);
  if (record === undefined) return undefined;
  const name = decodeString(record['name'], childPath(path, 'name'), issues);
  const type = decodeString(record['type'], childPath(path, 'type'), issues);
  const links = decodeArray(record['links'], childPath(path, 'links'), issues, decodeNumber);
  const slotIndex = decodeOptional(
    record['slot_index'],
    childPath(path, 'slot_index'),
    issues,
    decodeNumber,
  );
  if (name === undefined || type === undefined || links === undefined) return undefined;
  const output: IDagWorkflowNodeOutput = { name, type, links };
  if (slotIndex !== undefined) output.slot_index = slotIndex;
  return output;
}

function decodeWorkflowNode(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
): TDecoded<IDagWorkflowNode> {
  const record = decodeRecord(value, path, issues);
  if (record === undefined) return undefined;
  const at = (key: string): string => childPath(path, key);
  const id = decodeNumber(record['id'], at('id'), issues);
  const type = decodeString(record['type'], at('type'), issues);
  const pos = decodeNumberPair(record['pos'], at('pos'), issues);
  const size = decodeOptional(record['size'], at('size'), issues, decodeNumberPair);
  const flags = decodeOptional(record['flags'], at('flags'), issues, decodeRecord);
  const order = decodeOptional(record['order'], at('order'), issues, decodeNumber);
  const mode = decodeOptional(record['mode'], at('mode'), issues, decodeNumber);
  const inputs = decodeOptional(record['inputs'], at('inputs'), issues, (v, p, i) =>
    decodeArray(v, p, i, decodeNodeInput),
  );
  const outputs = decodeOptional(record['outputs'], at('outputs'), issues, (v, p, i) =>
    decodeArray(v, p, i, decodeNodeOutput),
  );
  const properties = decodeOptional(record['properties'], at('properties'), issues, decodeRecord);
  const widgetsValues = decodeOptional(
    record['widgets_values'],
    at('widgets_values'),
    issues,
    (v, p, i) => (Array.isArray(v) ? (v as unknown[]) : pushIssue(i, p, 'expected an array')),
  );
  if (id === undefined || type === undefined || pos === undefined) return undefined;
  const node: IDagWorkflowNode = { id, type, pos };
  if (size !== undefined) node.size = size;
  if (flags !== undefined) node.flags = flags;
  if (order !== undefined) node.order = order;
  if (mode !== undefined) node.mode = mode;
  if (inputs !== undefined) node.inputs = inputs;
  if (outputs !== undefined) node.outputs = outputs;
  if (properties !== undefined) node.properties = properties;
  if (widgetsValues !== undefined) node.widgets_values = widgetsValues;
  return node;
}

function decodeWorkflowFile(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
): TDecoded<IDagWorkflowFile> {
  const record = decodeRecord(value, path, issues);
  if (record === undefined) return undefined;
  const at = (key: string): string => childPath(path, key);
  if ('dagId' in record) {
    return pushIssue(
      issues,
      at('dagId'),
      'a workflow file carries no dagId — that is a definition file',
    );
  }
  const lastNodeId = decodeNumber(record['last_node_id'], at('last_node_id'), issues);
  const lastLinkId = decodeNumber(record['last_link_id'], at('last_link_id'), issues);
  const nodes = decodeArray(record['nodes'], at('nodes'), issues, decodeWorkflowNode);
  const links = decodeArray(record['links'], at('links'), issues, decodeLink);
  const version = decodeNumber(record['version'], at('version'), issues);
  const groups = decodeOptional(record['groups'], at('groups'), issues, (v, p, i) =>
    Array.isArray(v) ? (v as unknown[]) : pushIssue(i, p, 'expected an array'),
  );
  const config = decodeOptional(record['config'], at('config'), issues, decodeRecord);
  const extra = decodeOptional(record['extra'], at('extra'), issues, decodeRecord);
  if (
    lastNodeId === undefined ||
    lastLinkId === undefined ||
    nodes === undefined ||
    links === undefined ||
    version === undefined
  ) {
    return undefined;
  }
  const file: IDagWorkflowFile = {
    last_node_id: lastNodeId,
    last_link_id: lastLinkId,
    nodes,
    links,
    version,
  };
  if (groups !== undefined) file.groups = groups;
  if (config !== undefined) file.config = config;
  if (extra !== undefined) file.extra = extra;
  return file;
}

function decodeCompanionNodeMeta(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
): TDecoded<IDagRobotaCompanionNodeMeta> {
  const record = decodeRecord(value, path, issues);
  if (record === undefined) return undefined;
  const nodeId = decodeString(record['nodeId'], childPath(path, 'nodeId'), issues);
  const retryPolicy = decodeOptional(
    record['retryPolicy'],
    childPath(path, 'retryPolicy'),
    issues,
    decodeString,
  );
  const timeoutMs = decodeOptional(
    record['timeoutMs'],
    childPath(path, 'timeoutMs'),
    issues,
    decodeNumber,
  );
  const costPolicy = decodeOptional(
    record['costPolicy'],
    childPath(path, 'costPolicy'),
    issues,
    decodeCostPolicy,
  );
  if (nodeId === undefined) return undefined;
  const meta: IDagRobotaCompanionNodeMeta = { nodeId };
  if (retryPolicy !== undefined) meta.retryPolicy = retryPolicy;
  if (timeoutMs !== undefined) meta.timeoutMs = timeoutMs;
  if (costPolicy !== undefined) meta.costPolicy = costPolicy;
  return meta;
}

function decodeCompanion(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
): TDecoded<IDagRobotaCompanion> {
  const record = decodeRecord(value, path, issues);
  if (record === undefined) return undefined;
  const at = (key: string): string => childPath(path, key);
  const dagId = decodeString(record['dagId'], at('dagId'), issues);
  const version = decodeNumber(record['version'], at('version'), issues);
  const status = decodeLiteral(record['status'], DAG_DEFINITION_STATUSES, at('status'), issues);
  const costPolicy = decodeOptional(
    record['costPolicy'],
    at('costPolicy'),
    issues,
    decodeCostPolicy,
  );
  const inputSchema = decodeOptional(
    record['inputSchema'],
    at('inputSchema'),
    issues,
    decodeString,
  );
  const outputSchema = decodeOptional(
    record['outputSchema'],
    at('outputSchema'),
    issues,
    decodeString,
  );
  const nodeFiles = decodeOptional(record['nodeFiles'], at('nodeFiles'), issues, decodeStringArray);
  const nodesRecord = decodeRecord(record['nodes'], at('nodes'), issues);
  let nodes: Record<string, IDagRobotaCompanionNodeMeta> | undefined;
  if (nodesRecord !== undefined) {
    const before = issues.length;
    nodes = {};
    for (const [key, entry] of Object.entries(nodesRecord)) {
      const meta = decodeCompanionNodeMeta(entry, childPath(at('nodes'), key), issues);
      if (meta !== undefined) nodes[key] = meta;
    }
    if (issues.length !== before) nodes = undefined;
  }
  if (dagId === undefined || version === undefined || status === undefined || nodes === undefined) {
    return undefined;
  }
  const companion: IDagRobotaCompanion = { dagId, version, status, nodes };
  if (costPolicy !== undefined) companion.costPolicy = costPolicy;
  if (inputSchema !== undefined) companion.inputSchema = inputSchema;
  if (outputSchema !== undefined) companion.outputSchema = outputSchema;
  if (nodeFiles !== undefined) companion.nodeFiles = nodeFiles;
  return companion;
}
