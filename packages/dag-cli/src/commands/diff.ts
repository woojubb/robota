import type {
  IDagDefinition,
  IDagNode,
  IDagEdgeDefinition,
  INodeConfigObject,
} from '@robota-sdk/dag-core';
import type { IDagCliIo } from '../types.js';
import { USAGE_ERROR_EXIT_CODE, SUCCESS_EXIT_CODE } from '../types.js';

const OUTPUT_FORMAT_PRETTY = 'pretty';
const OUTPUT_FORMAT_JSON = 'json';
const JSON_INDENT_SPACES = 2;

export interface IDiffCommandOptions {
  readonly io: IDagCliIo;
}

/** Parsed options from argv for the `diff` subcommand. */
interface IParsedDiffOptions {
  readonly fileA: string;
  readonly fileB: string;
  readonly outputFormat: string;
}

type TParseResult =
  | { readonly ok: true; readonly value: IParsedDiffOptions }
  | { readonly ok: false; readonly exitCode: number; readonly message: string };

function parseDiffArgv(args: readonly string[]): TParseResult {
  const mutableArgs = [...args];

  // --output <format>
  const outputIndex = mutableArgs.indexOf('--output');
  let outputFormat = OUTPUT_FORMAT_PRETTY;
  if (outputIndex !== -1) {
    const outputValue = mutableArgs[outputIndex + 1];
    if (typeof outputValue !== 'string' || outputValue.startsWith('--')) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: '--output requires a value.',
      };
    }
    if (outputValue !== OUTPUT_FORMAT_PRETTY && outputValue !== OUTPUT_FORMAT_JSON) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: `--output must be "json" or "pretty".`,
      };
    }
    outputFormat = outputValue;
    mutableArgs.splice(outputIndex, 2);
  }

  // Unknown flags
  const unknownFlags = mutableArgs.filter((a) => a.startsWith('--'));
  if (unknownFlags.length > 0) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `diff received unexpected flags: ${unknownFlags.join(' ')}.`,
    };
  }

  const positional = mutableArgs.filter((a) => !a.startsWith('--'));
  if (positional.length < 2) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: 'diff requires two file arguments (e.g. dag diff v1.dag.json v2.dag.json).',
    };
  }
  if (positional.length > 2) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `diff received unexpected positional arguments: ${positional.slice(2).join(' ')}.`,
    };
  }

  return {
    ok: true,
    value: { fileA: positional[0] as string, fileB: positional[1] as string, outputFormat },
  };
}

function resolveErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Read and parse a `.dag.json` file into an `IDagDefinition`. */
async function readDagFile(
  filePath: string,
  io: IDagCliIo,
): Promise<
  | { readonly ok: true; readonly value: IDagDefinition }
  | { readonly ok: false; readonly message: string }
> {
  let text: string;
  try {
    text = await io.readTextFile(filePath);
  } catch (readErr) {
    // allow-fallback: I/O error is returned as structured error
    return {
      ok: false,
      message: `Failed to read file "${filePath}": ${resolveErrorMessage(readErr)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (parseErr) {
    // allow-fallback: JSON parse error returned as structured error
    return {
      ok: false,
      message: `Failed to parse JSON from "${filePath}": ${resolveErrorMessage(parseErr)}`,
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      message: `DAG file "${filePath}" must contain a JSON object.`,
    };
  }

  return { ok: true, value: parsed as IDagDefinition };
}

// ---------------------------------------------------------------------------
// Config diffing helpers
// ---------------------------------------------------------------------------

/** Flatten a nested config object into dot-notation key paths. */
function flattenConfig(
  obj: INodeConfigObject,
  prefix = '',
): Map<string, string | number | boolean | null> {
  const result = new Map<string, string | number | boolean | null>();
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const nested = flattenConfig(value as INodeConfigObject, fullKey);
      for (const [k, v] of nested) {
        result.set(k, v);
      }
    } else if (Array.isArray(value)) {
      result.set(fullKey, JSON.stringify(value));
    } else {
      result.set(fullKey, value as string | number | boolean | null);
    }
  }
  return result;
}

interface IConfigChange {
  readonly key: string;
  readonly before: string;
  readonly after: string;
}

/** Compare two node config objects and return changed keys. */
function diffNodeConfig(before: INodeConfigObject, after: INodeConfigObject): IConfigChange[] {
  const flatBefore = flattenConfig(before);
  const flatAfter = flattenConfig(after);
  const changes: IConfigChange[] = [];

  const allKeys = new Set([...flatBefore.keys(), ...flatAfter.keys()]);
  for (const key of allKeys) {
    const bVal = flatBefore.get(key);
    const aVal = flatAfter.get(key);
    const bStr = bVal === undefined ? '(absent)' : JSON.stringify(bVal);
    const aStr = aVal === undefined ? '(absent)' : JSON.stringify(aVal);
    if (bStr !== aStr) {
      changes.push({ key, before: bStr, after: aStr });
    }
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Edge normalization
// ---------------------------------------------------------------------------

/** Normalize an edge to a canonical string for set comparison. */
function normalizeEdge(edge: IDagEdgeDefinition): string {
  const bindings = edge.bindings ?? [];
  if (bindings.length === 0) {
    return `${edge.from} → ${edge.to}`;
  }
  const bindStr = bindings.map((b) => `${b.outputKey}→${b.inputKey}`).join(',');
  return `${edge.from} → ${edge.to} (${bindStr})`;
}

// ---------------------------------------------------------------------------
// Diff result types
// ---------------------------------------------------------------------------

interface INodeChange {
  readonly nodeId: string;
  readonly changes: readonly IConfigChange[];
}

interface IDiffResult {
  readonly nodes: {
    readonly added: readonly string[];
    readonly removed: readonly string[];
    readonly changed: readonly INodeChange[];
  };
  readonly edges: {
    readonly added: readonly string[];
    readonly removed: readonly string[];
  };
  readonly identical: boolean;
}

// ---------------------------------------------------------------------------
// Core diff logic
// ---------------------------------------------------------------------------

function computeDiff(dagA: IDagDefinition, dagB: IDagDefinition): IDiffResult {
  // --- Nodes ---
  const nodesA = new Map<string, IDagNode>(dagA.nodes.map((n) => [n.nodeId, n]));
  const nodesB = new Map<string, IDagNode>(dagB.nodes.map((n) => [n.nodeId, n]));

  const addedNodes: string[] = [];
  const removedNodes: string[] = [];
  const changedNodes: INodeChange[] = [];

  for (const [nodeId, nodeB] of nodesB) {
    const nodeA = nodesA.get(nodeId);
    if (nodeA === undefined) {
      addedNodes.push(`${nodeId}  (${nodeB.nodeType})`);
    } else {
      // Both exist — compare config and nodeType
      const configChanges = diffNodeConfig(nodeA.config, nodeB.config);
      // Also detect nodeType change
      const allChanges: IConfigChange[] = [];
      if (nodeA.nodeType !== nodeB.nodeType) {
        allChanges.push({ key: 'nodeType', before: nodeA.nodeType, after: nodeB.nodeType });
      }
      allChanges.push(...configChanges);
      if (allChanges.length > 0) {
        changedNodes.push({ nodeId, changes: allChanges });
      }
    }
  }

  for (const [nodeId, nodeA] of nodesA) {
    if (!nodesB.has(nodeId)) {
      removedNodes.push(`${nodeId}  (${nodeA.nodeType})`);
    }
  }

  // --- Edges ---
  const edgeSetA = new Set<string>((dagA.edges ?? []).map(normalizeEdge));
  const edgeSetB = new Set<string>((dagB.edges ?? []).map(normalizeEdge));

  const addedEdges: string[] = [];
  const removedEdges: string[] = [];

  for (const e of edgeSetB) {
    if (!edgeSetA.has(e)) {
      addedEdges.push(e);
    }
  }
  for (const e of edgeSetA) {
    if (!edgeSetB.has(e)) {
      removedEdges.push(e);
    }
  }

  const identical =
    addedNodes.length === 0 &&
    removedNodes.length === 0 &&
    changedNodes.length === 0 &&
    addedEdges.length === 0 &&
    removedEdges.length === 0;

  return {
    nodes: { added: addedNodes, removed: removedNodes, changed: changedNodes },
    edges: { added: addedEdges, removed: removedEdges },
    identical,
  };
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------

function formatPrettyDiff(fileA: string, fileB: string, diff: IDiffResult, io: IDagCliIo): void {
  io.write(`Structure diff: ${fileA} → ${fileB}\n`);

  const hasNodeChanges =
    diff.nodes.added.length > 0 || diff.nodes.removed.length > 0 || diff.nodes.changed.length > 0;
  const hasEdgeChanges = diff.edges.added.length > 0 || diff.edges.removed.length > 0;

  if (!hasNodeChanges && !hasEdgeChanges) {
    io.write('\nNo structural difference\n');
    return;
  }

  if (hasNodeChanges) {
    io.write('\nNodes:\n');
    for (const nodeId of diff.nodes.added) {
      io.write(`  + ${nodeId}\n`);
    }
    for (const nodeId of diff.nodes.removed) {
      io.write(`  - ${nodeId}\n`);
    }
    for (const change of diff.nodes.changed) {
      for (const c of change.changes) {
        io.write(`  ~ ${change.nodeId}.${c.key}\n`);
        io.write(`      before: ${c.before}\n`);
        io.write(`      after:  ${c.after}\n`);
      }
    }
  }

  if (hasEdgeChanges) {
    io.write('\nEdges:\n');
    for (const edge of diff.edges.added) {
      io.write(`  + ${edge}\n`);
    }
    for (const edge of diff.edges.removed) {
      io.write(`  - ${edge}\n`);
    }
  }
}

function formatJsonDiff(diff: IDiffResult, io: IDagCliIo): void {
  // Re-shape for JSON output: strip the nodeType annotation from added/removed node labels
  const jsonResult = {
    nodes: {
      added: diff.nodes.added.map((label) => label.split('  ')[0] ?? label),
      removed: diff.nodes.removed.map((label) => label.split('  ')[0] ?? label),
      changed: diff.nodes.changed.map((nc) => ({
        nodeId: nc.nodeId,
        changes: nc.changes.map((c) => ({
          key: c.key,
          before: c.before,
          after: c.after,
        })),
      })),
    },
    edges: {
      added: diff.edges.added,
      removed: diff.edges.removed,
    },
    identical: diff.identical,
  };
  io.write(`${JSON.stringify(jsonResult, null, JSON_INDENT_SPACES)}\n`);
}

// ---------------------------------------------------------------------------
// Command entry point
// ---------------------------------------------------------------------------

/**
 * Execute the `dag diff <file-a> <file-b>` subcommand.
 *
 * @param args - The argv slice starting after the `diff` keyword.
 * @param options - IO abstraction.
 * @returns Exit code (0 = identical or diff shown, 1 = error, 2 = usage error).
 */
export async function diffCommand(
  args: readonly string[],
  options: IDiffCommandOptions,
): Promise<number> {
  const { io } = options;

  const parseResult = parseDiffArgv(args);
  if (!parseResult.ok) {
    io.write(`Error: ${parseResult.message}\n`);
    return parseResult.exitCode;
  }

  const { fileA, fileB, outputFormat } = parseResult.value;

  const [resultA, resultB] = await Promise.all([readDagFile(fileA, io), readDagFile(fileB, io)]);

  if (!resultA.ok) {
    io.write(`Error: ${resultA.message}\n`);
    return USAGE_ERROR_EXIT_CODE;
  }
  if (!resultB.ok) {
    io.write(`Error: ${resultB.message}\n`);
    return USAGE_ERROR_EXIT_CODE;
  }

  const diff = computeDiff(resultA.value, resultB.value);

  if (outputFormat === OUTPUT_FORMAT_JSON) {
    formatJsonDiff(diff, io);
  } else {
    formatPrettyDiff(fileA, fileB, diff, io);
  }

  return SUCCESS_EXIT_CODE;
}
