/**
 * The one total decoder for a persisted `IDagDefinition` (issue #2077 / DAG-005).
 *
 * Every consumer that reads a definition off a boundary — a definition file, a run's definition
 * snapshot, a storage row, a workspace catalog entry, an instant-node's inner DAG — decodes through
 * here, so "it parsed as JSON" never again passes for "it is a definition". Lives in `dag-core` so a
 * package that depends on `dag-core` without depending on `dag-builder` can still reach it.
 */

import {
  childPath,
  dagDecodeIssuesToError,
  decodeArray,
  decodeBoolean,
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

import type {
  ICostPolicy,
  IDagDefinition,
  IDagEdgeDefinition,
  IDagNode,
  IEdgeBinding,
  INodeConfigObject,
  IPortDefinition,
  TBinaryKind,
  TDagDefinitionStatus,
  TNodeConfigValue,
  TPortValueType,
} from '../types/domain.js';
import type { IDagError } from '../types/error.js';
import type { TResult } from '../types/result.js';

export const DAG_DEFINITION_STATUSES: readonly TDagDefinitionStatus[] = [
  'draft',
  'published',
  'deprecated',
];
const PORT_VALUE_TYPES: readonly TPortValueType[] = [
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'binary',
];
const BINARY_KINDS: readonly TBinaryKind[] = ['image', 'video', 'audio', 'file'];

/**
 * Legacy-file allowances. A definition file written before DAG-002 has no `status`, and one written
 * before edges were required has no `edges`; the FILE boundary opts into a default for each, so an
 * absent field is not confused with a present wrong one. Snapshots and storage rows pass no options
 * and are decoded strictly.
 */
export interface IDagDefinitionDecodeOptions {
  readonly absentStatus?: TDagDefinitionStatus;
  readonly absentEdgesAsEmpty?: boolean;
}

export type TDagDefinitionDecodeResult = TResult<IDagDefinition, IDagDecodeIssue[]>;

export function decodeDagDefinition(
  value: unknown,
  options: IDagDefinitionDecodeOptions = {},
): TDagDefinitionDecodeResult {
  const issues: TDagDecodeIssues = [];
  const definition = decodeDefinition(value, '', issues, options);
  return definition !== undefined && issues.length === 0
    ? { ok: true, value: definition }
    : { ok: false, error: issues };
}

/** The same decode, folded into the `IDagError` every port and command already reports. */
export function decodeDagDefinitionAsDagError(
  value: unknown,
  code: string,
  message: string,
  context: Record<string, string | number | boolean> = {},
  options: IDagDefinitionDecodeOptions = {},
): TResult<IDagDefinition, IDagError> {
  const result = decodeDagDefinition(value, options);
  return result.ok
    ? result
    : { ok: false, error: dagDecodeIssuesToError(code, message, result.error, context) };
}

function decodeDefinition(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
  options: IDagDefinitionDecodeOptions,
): TDecoded<IDagDefinition> {
  const record = decodeRecord(value, path, issues);
  if (record === undefined) return undefined;
  const dagId = decodeString(record['dagId'], childPath(path, 'dagId'), issues);
  const version = decodeNumber(record['version'], childPath(path, 'version'), issues);
  const status =
    record['status'] === undefined && options.absentStatus !== undefined
      ? options.absentStatus
      : decodeLiteral(record['status'], DAG_DEFINITION_STATUSES, childPath(path, 'status'), issues);
  const nodes = decodeArray(record['nodes'], childPath(path, 'nodes'), issues, decodeDagNode);
  const edges =
    record['edges'] === undefined && options.absentEdgesAsEmpty
      ? []
      : decodeArray(record['edges'], childPath(path, 'edges'), issues, decodeEdge);
  const costPolicy = decodeOptional(
    record['costPolicy'],
    childPath(path, 'costPolicy'),
    issues,
    decodeCostPolicy,
  );
  const inputSchema = decodeOptional(
    record['inputSchema'],
    childPath(path, 'inputSchema'),
    issues,
    decodeString,
  );
  const outputSchema = decodeOptional(
    record['outputSchema'],
    childPath(path, 'outputSchema'),
    issues,
    decodeString,
  );
  if (
    dagId === undefined ||
    version === undefined ||
    status === undefined ||
    nodes === undefined ||
    edges === undefined
  ) {
    return undefined;
  }
  const definition: IDagDefinition = { dagId, version, status, nodes, edges };
  if (costPolicy !== undefined) definition.costPolicy = costPolicy;
  if (inputSchema !== undefined) definition.inputSchema = inputSchema;
  if (outputSchema !== undefined) definition.outputSchema = outputSchema;
  return definition;
}

export function decodeCostPolicy(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
): TDecoded<ICostPolicy> {
  const record = decodeRecord(value, path, issues);
  if (record === undefined) return undefined;
  const runCreditLimit = decodeNumber(
    record['runCreditLimit'],
    childPath(path, 'runCreditLimit'),
    issues,
  );
  const costPolicyVersion = decodeNumber(
    record['costPolicyVersion'],
    childPath(path, 'costPolicyVersion'),
    issues,
  );
  return runCreditLimit === undefined || costPolicyVersion === undefined
    ? undefined
    : { runCreditLimit, costPolicyVersion };
}

function decodePosition(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
): TDecoded<{ x: number; y: number }> {
  const record = decodeRecord(value, path, issues);
  if (record === undefined) return undefined;
  const x = decodeNumber(record['x'], childPath(path, 'x'), issues);
  const y = decodeNumber(record['y'], childPath(path, 'y'), issues);
  return x === undefined || y === undefined ? undefined : { x, y };
}

/** A config value is JSON: primitives, `null`, arrays and objects of the same, nothing else. */
export function decodeNodeConfigValue(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
): TDecoded<TNodeConfigValue> {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return value as TNodeConfigValue;
  }
  if (Array.isArray(value)) return decodeArray(value, path, issues, decodeNodeConfigValue);
  if (typeof value === 'object') return decodeNodeConfigObject(value, path, issues);
  return pushIssue(issues, path, `expected a JSON value, got ${typeof value}`);
}

export function decodeNodeConfigObject(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
): TDecoded<INodeConfigObject> {
  const record = decodeRecord(value, path, issues);
  if (record === undefined) return undefined;
  const config: INodeConfigObject = {};
  const before = issues.length;
  for (const [key, entry] of Object.entries(record)) {
    const decoded = decodeNodeConfigValue(entry, childPath(path, key), issues);
    if (decoded !== undefined) config[key] = decoded;
  }
  return issues.length === before ? config : undefined;
}

export function decodePortDefinition(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
): TDecoded<IPortDefinition> {
  const record = decodeRecord(value, path, issues);
  if (record === undefined) return undefined;
  const at = (key: string): string => childPath(path, key);
  const key = decodeString(record['key'], at('key'), issues);
  const type = decodeLiteral(record['type'], PORT_VALUE_TYPES, at('type'), issues);
  const required = decodeBoolean(record['required'], at('required'), issues);
  const label = decodeOptional(record['label'], at('label'), issues, decodeString);
  const order = decodeOptional(record['order'], at('order'), issues, decodeNumber);
  const description = decodeOptional(
    record['description'],
    at('description'),
    issues,
    decodeString,
  );
  const binaryKind = decodeOptional(record['binaryKind'], at('binaryKind'), issues, (v, p, i) =>
    decodeLiteral(v, BINARY_KINDS, p, i),
  );
  const mimeTypes = decodeOptional(record['mimeTypes'], at('mimeTypes'), issues, decodeStringArray);
  const isList = decodeOptional(record['isList'], at('isList'), issues, decodeBoolean);
  const minItems = decodeOptional(record['minItems'], at('minItems'), issues, decodeNumber);
  const maxItems = decodeOptional(record['maxItems'], at('maxItems'), issues, decodeNumber);
  if (key === undefined || type === undefined || required === undefined) return undefined;
  const port: IPortDefinition = { key, type, required };
  if (label !== undefined) port.label = label;
  if (order !== undefined) port.order = order;
  if (description !== undefined) port.description = description;
  if (binaryKind !== undefined) port.binaryKind = binaryKind;
  if (mimeTypes !== undefined) port.mimeTypes = mimeTypes;
  if (isList !== undefined) port.isList = isList;
  if (minItems !== undefined) port.minItems = minItems;
  if (maxItems !== undefined) port.maxItems = maxItems;
  return port;
}

export function decodeDagNode(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
): TDecoded<IDagNode> {
  const record = decodeRecord(value, path, issues);
  if (record === undefined) return undefined;
  const at = (key: string): string => childPath(path, key);
  const nodeId = decodeString(record['nodeId'], at('nodeId'), issues);
  const nodeType = decodeString(record['nodeType'], at('nodeType'), issues);
  const dependsOn = decodeStringArray(record['dependsOn'], at('dependsOn'), issues);
  const config = decodeNodeConfigObject(record['config'], at('config'), issues);
  const position = decodeOptional(record['position'], at('position'), issues, decodePosition);
  const triggerPolicy = decodeOptional(
    record['triggerPolicy'],
    at('triggerPolicy'),
    issues,
    decodeString,
  );
  const retryPolicy = decodeOptional(
    record['retryPolicy'],
    at('retryPolicy'),
    issues,
    decodeString,
  );
  const timeoutMs = decodeOptional(record['timeoutMs'], at('timeoutMs'), issues, decodeNumber);
  const inputs = decodeOptional(record['inputs'], at('inputs'), issues, (v, p, i) =>
    decodeArray(v, p, i, decodePortDefinition),
  );
  const outputs = decodeOptional(record['outputs'], at('outputs'), issues, (v, p, i) =>
    decodeArray(v, p, i, decodePortDefinition),
  );
  const costPolicy = decodeOptional(
    record['costPolicy'],
    at('costPolicy'),
    issues,
    decodeCostPolicy,
  );
  if (
    nodeId === undefined ||
    nodeType === undefined ||
    dependsOn === undefined ||
    config === undefined
  ) {
    return undefined;
  }
  const node: IDagNode = { nodeId, nodeType, dependsOn, config };
  if (position !== undefined) node.position = position;
  if (triggerPolicy !== undefined) node.triggerPolicy = triggerPolicy;
  if (retryPolicy !== undefined) node.retryPolicy = retryPolicy;
  if (timeoutMs !== undefined) node.timeoutMs = timeoutMs;
  if (inputs !== undefined) node.inputs = inputs;
  if (outputs !== undefined) node.outputs = outputs;
  if (costPolicy !== undefined) node.costPolicy = costPolicy;
  return node;
}

function decodeEdgeBinding(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
): TDecoded<IEdgeBinding> {
  const record = decodeRecord(value, path, issues);
  if (record === undefined) return undefined;
  const outputKey = decodeString(record['outputKey'], childPath(path, 'outputKey'), issues);
  const inputKey = decodeString(record['inputKey'], childPath(path, 'inputKey'), issues);
  return outputKey === undefined || inputKey === undefined ? undefined : { outputKey, inputKey };
}

export function decodeEdge(
  value: unknown,
  path: string,
  issues: TDagDecodeIssues,
): TDecoded<IDagEdgeDefinition> {
  const record = decodeRecord(value, path, issues);
  if (record === undefined) return undefined;
  const from = decodeString(record['from'], childPath(path, 'from'), issues);
  const to = decodeString(record['to'], childPath(path, 'to'), issues);
  const bindings = decodeOptional(
    record['bindings'],
    childPath(path, 'bindings'),
    issues,
    (v, p, i) => decodeArray(v, p, i, decodeEdgeBinding),
  );
  if (from === undefined || to === undefined) return undefined;
  const edge: IDagEdgeDefinition = { from, to };
  if (bindings !== undefined) edge.bindings = bindings;
  return edge;
}
