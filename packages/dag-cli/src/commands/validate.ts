import { resolve } from 'node:path';
import type {
  INodePortSpec,
  IDagDefinition,
  IDagNode,
  INodeManifest,
  TPortValueType,
} from '@robota-sdk/dag-core';
import { buildNodeDefinitionAssembly } from '@robota-sdk/dag-node';
import type { IDagCliIo } from '../types.js';
import { FAILURE_EXIT_CODE, USAGE_ERROR_EXIT_CODE, SUCCESS_EXIT_CODE } from '../types.js';
import {
  createCliNodeRegistryWithLocalNodes,
  loadNodeFileExplicit,
} from '../local-runner/index.js';
import { resolveProvider } from '../providers/index.js';

const OUTPUT_FORMAT_PRETTY = 'pretty';
const OUTPUT_FORMAT_JSON = 'json';
const JSON_INDENT_SPACES = 2;

export interface IValidateCommandOptions {
  readonly io: IDagCliIo;
}

/** Parsed options from argv for the `validate` subcommand. */
interface IParsedValidateOptions {
  readonly file: string;
  readonly strict: boolean;
  readonly suggest: boolean;
  readonly suggestFix: boolean;
  readonly outputFormat: string;
  readonly nodeFile?: string;
  readonly provider?: string;
}

type TParseResult =
  | { readonly ok: true; readonly value: IParsedValidateOptions }
  | { readonly ok: false; readonly exitCode: number; readonly message: string };

function parseValidateArgv(args: readonly string[]): TParseResult {
  const mutableArgs = [...args];

  // --strict flag
  const strictIndex = mutableArgs.indexOf('--strict');
  const strict = strictIndex !== -1;
  if (strict) {
    mutableArgs.splice(strictIndex, 1);
  }

  // --suggest flag
  const suggestIndex = mutableArgs.indexOf('--suggest');
  const suggest = suggestIndex !== -1;
  if (suggest) {
    mutableArgs.splice(mutableArgs.indexOf('--suggest'), 1);
  }

  // --suggest-fix flag
  const suggestFixIndex = mutableArgs.indexOf('--suggest-fix');
  const suggestFix = suggestFixIndex !== -1;
  if (suggestFix) {
    mutableArgs.splice(mutableArgs.indexOf('--suggest-fix'), 1);
  }

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

  // --node-file <path>
  const nodeFileIndex = mutableArgs.indexOf('--node-file');
  let nodeFile: string | undefined;
  if (nodeFileIndex !== -1) {
    const nodeFileValue = mutableArgs[nodeFileIndex + 1];
    if (typeof nodeFileValue !== 'string' || nodeFileValue.startsWith('--')) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: '--node-file requires a value.',
      };
    }
    nodeFile = nodeFileValue;
    mutableArgs.splice(nodeFileIndex, 2);
  }

  // --provider <local>
  const providerIndex = mutableArgs.indexOf('--provider');
  let provider: string | undefined;
  if (providerIndex !== -1) {
    const providerValue = mutableArgs[providerIndex + 1];
    if (typeof providerValue !== 'string' || providerValue.startsWith('--')) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: '--provider requires a value.',
      };
    }
    provider = providerValue;
    mutableArgs.splice(providerIndex, 2);
  }

  // Unknown flags
  const unknownFlags = mutableArgs.filter((a) => a.startsWith('--'));
  if (unknownFlags.length > 0) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `validate received unexpected flags: ${unknownFlags.join(' ')}.`,
    };
  }

  const positional = mutableArgs.filter((a) => !a.startsWith('--'));

  const file = positional[0];
  if (!file) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: 'validate requires <file> argument (e.g. robota-dag validate workflow.dag.json).',
    };
  }
  if (positional.length > 1) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `validate received unexpected positional arguments: ${positional.slice(1).join(' ')}.`,
    };
  }

  return {
    ok: true,
    value: { file, strict, suggest, suggestFix, outputFormat, nodeFile, provider },
  };
}

function resolveErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Read and parse a `.dag.json` file into an `IDagDefinition`.
 */
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

/**
 * Detect cycles in the DAG using iterative DFS topological sort.
 * Returns the cycle node IDs if a cycle is found, or null if acyclic.
 */
function detectCycle(nodes: IDagNode[]): string[] | null {
  // Build adjacency: nodeId -> list of nodeIds it depends on
  const nodeIds = new Set(nodes.map((n) => n.nodeId));
  // visited state: 0=unvisited, 1=in-progress, 2=done
  const state = new Map<string, number>();
  for (const nodeId of nodeIds) {
    state.set(nodeId, 0);
  }

  const dependsOnMap = new Map<string, string[]>();
  for (const node of nodes) {
    // Only consider edges to known nodes
    dependsOnMap.set(
      node.nodeId,
      node.dependsOn.filter((dep) => nodeIds.has(dep)),
    );
  }

  // DFS with path tracking to find cycle members
  for (const startId of nodeIds) {
    if (state.get(startId) === 2) continue;

    const stack: Array<{ nodeId: string; index: number }> = [{ nodeId: startId, index: 0 }];
    const path: string[] = [startId];
    state.set(startId, 1);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      const deps = dependsOnMap.get(frame.nodeId) ?? [];

      if (frame.index >= deps.length) {
        state.set(frame.nodeId, 2);
        stack.pop();
        path.pop();
      } else {
        const dep = deps[frame.index];
        frame.index += 1;
        if (dep === undefined) continue;
        const depState = state.get(dep) ?? 0;
        if (depState === 1) {
          // Found cycle — return the cycle path
          const cycleStart = path.indexOf(dep);
          return path.slice(cycleStart);
        }
        if (depState === 0) {
          state.set(dep, 1);
          path.push(dep);
          stack.push({ nodeId: dep, index: 0 });
        }
      }
    }
  }

  return null;
}

interface IValidationError {
  readonly message: string;
  readonly code?: string;
  readonly nodeId?: string;
  readonly nodeType?: string;
  readonly key?: string;
}

interface IValidationWarning {
  message: string;
}

interface IValidationStats {
  nodeCount: number;
  edgeCount: number;
}

/**
 * Run all validation checks on a DAG definition.
 */
function validateDag(
  dag: IDagDefinition,
  manifests: INodeManifest[],
): { errors: IValidationError[]; warnings: IValidationWarning[]; stats: IValidationStats } {
  const errors: IValidationError[] = [];
  const warnings: IValidationWarning[] = [];

  const knownTypes = new Set(manifests.map((m) => m.nodeType));
  const nodes = dag.nodes ?? [];
  const edges = dag.edges ?? [];

  const nodeIdSet = new Set(nodes.map((n) => n.nodeId));

  // Check 1: Unknown node types
  for (const node of nodes) {
    if (!knownTypes.has(node.nodeType)) {
      errors.push({
        message: `Unknown node type "${node.nodeType}" at node "${node.nodeId}"`,
        code: 'UNKNOWN_NODE_TYPE',
        nodeId: node.nodeId,
        nodeType: node.nodeType,
      });
    }
  }

  // Check 1b: Edge source/target node existence
  for (const edge of edges) {
    if (!nodeIdSet.has(edge.from)) {
      errors.push({
        message: `Edge from "${edge.from}" to "${edge.to}": source node "${edge.from}" not found`,
        code: 'EDGE_NODE_NOT_FOUND',
        nodeId: edge.from,
      });
    }
    if (!nodeIdSet.has(edge.to)) {
      errors.push({
        message: `Edge from "${edge.from}" to "${edge.to}": target node "${edge.to}" not found`,
        code: 'EDGE_NODE_NOT_FOUND',
        nodeId: edge.to,
      });
    }
  }

  // Check 1c: Required config keys (based on manifest configSchema.required)
  const manifestMap = new Map(manifests.map((m) => [m.nodeType, m]));

  // Check 1d: Edge binding port type compatibility
  for (const edge of edges) {
    const sourceNode = nodes.find((n) => n.nodeId === edge.from);
    const targetNode = nodes.find((n) => n.nodeId === edge.to);
    if (!sourceNode || !targetNode) continue;
    const sourceManifest = manifestMap.get(sourceNode.nodeType);
    const targetManifest = manifestMap.get(targetNode.nodeType);
    if (!sourceManifest || !targetManifest) continue;
    for (const binding of edge.bindings ?? []) {
      const sourcePort = sourceManifest.outputs.find((p) => p.key === binding.outputKey);
      const targetPort = targetManifest.inputs.find((p) => p.key === binding.inputKey);
      if (sourcePort && targetPort && sourcePort.type !== targetPort.type) {
        errors.push({
          message: `Edge "${edge.from}" → "${edge.to}" binding "${binding.outputKey}"→"${binding.inputKey}": output type "${sourcePort.type}" is incompatible with input type "${targetPort.type}"`,
          code: 'DAG_VALIDATION_PORT_TYPE_MISMATCH',
          nodeId: edge.from,
        });
      }
    }
  }
  for (const node of nodes) {
    const manifest = manifestMap.get(node.nodeType);
    if (!manifest?.configSchema || typeof manifest.configSchema !== 'object') continue;
    const schema = manifest.configSchema as Record<string, unknown>;
    const required = schema['required'];
    if (!Array.isArray(required)) continue;
    for (const key of required as string[]) {
      if (!(key in (node.config as Record<string, unknown>))) {
        errors.push({
          message: `Node "${node.nodeId}" (${node.nodeType}): required config key "${key}" is missing`,
          code: 'REQUIRED_CONFIG_MISSING',
          nodeId: node.nodeId,
          nodeType: node.nodeType,
          key,
        });
      }
    }
  }

  // Check 2: Cycle detection
  if (nodes.length > 0) {
    const cycle = detectCycle(nodes);
    if (cycle !== null) {
      errors.push({
        message: `Cycle detected in DAG: ${cycle.join(' -> ')} -> ${cycle[0]}`,
      });
    }
  }

  // Check 3: No input node
  const INPUT_NODE_TYPES = ['input', 'multi-input'];
  const hasInputNode = nodes.some((n) => INPUT_NODE_TYPES.includes(n.nodeType));
  if (!hasInputNode) {
    errors.push({
      message:
        'No input node found (requires at least one node with nodeType "input" or "multi-input")',
    });
  }

  // Check 4: No output node
  // Output node types in this registry
  const OUTPUT_NODE_TYPES = ['text-output', 'ok-emitter'];
  const hasOutputNode = nodes.some((n) => OUTPUT_NODE_TYPES.includes(n.nodeType));
  if (!hasOutputNode) {
    errors.push({
      message: `No output node found (requires at least one node with nodeType: ${OUTPUT_NODE_TYPES.map((t) => `"${t}"`).join(', ')})`,
    });
  }

  const stats: IValidationStats = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
  };

  return { errors, warnings, stats };
}

// ---------------------------------------------------------------------------
// Suggestion engine
// ---------------------------------------------------------------------------

/**
 * Compute Levenshtein edit distance between two strings.
 * Used to find similarly-named nodeTypes when an unknown type is encountered.
 */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // Use two-row rolling array for space efficiency
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (curr[j - 1] as number) + 1,
        (prev[j] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n] as number;
}

/**
 * Find the closest known nodeType to an unknown input string.
 * First tries prefix/substring matching, then falls back to edit distance <= 3.
 */
function findSimilarNodeType(input: string, available: readonly string[]): string | undefined {
  const lower = input.toLowerCase();
  // 1. Substring match: available type contains the input or vice-versa
  const substringMatch = available.find(
    (a) => a.includes(lower) || lower.includes(a.split('-').pop() ?? ''),
  );
  if (substringMatch !== undefined) return substringMatch;
  // 2. Edit distance <= 3
  let best: string | undefined;
  let bestDist = 4; // anything > 3 is not a match
  for (const a of available) {
    const dist = editDistance(lower, a);
    if (dist < bestDist) {
      bestDist = dist;
      best = a;
    }
  }
  return best;
}

/**
 * Build human-readable fix suggestions for a list of validation errors.
 */
function buildSuggestions(
  errors: IValidationError[],
  dag: IDagDefinition,
  manifests: INodeManifest[],
): string[] {
  const suggestions: string[] = [];
  const knownTypes = manifests.map((m) => m.nodeType);
  const nodes = dag.nodes ?? [];
  const nodeIds = new Set(nodes.map((n) => n.nodeId));

  for (const error of errors) {
    const msg = error.message;

    // No input node
    if (msg.includes('No input node found')) {
      suggestions.push(
        `Add an input node: {"nodeId":"input","nodeType":"input","dependsOn":[],"config":{}}`,
      );
      continue;
    }

    // Unknown node type
    const unknownTypeMatch = msg.match(/Unknown node type "([^"]+)" at node "([^"]+)"/);
    if (unknownTypeMatch !== null) {
      const badType = unknownTypeMatch[1] as string;
      const similar = findSimilarNodeType(badType, knownTypes);
      if (similar !== undefined) {
        suggestions.push(`Unknown nodeType '${badType}'. Did you mean: ${similar}?`);
      } else {
        suggestions.push(
          `Unknown nodeType '${badType}'. Run 'dag node list' to see available node types.`,
        );
      }
      continue;
    }

    // Cycle detected: "Cycle detected in DAG: A -> B -> A"
    if (msg.includes('Cycle detected in DAG:')) {
      suggestions.push(
        `${msg.replace('Cycle detected in DAG: ', 'Circular dependency detected: ')}`,
      );
      continue;
    }

    // dependsOn references non-existent nodeId (not currently emitted by validateDag,
    // but handle proactively for robustness)
    const missingDepMatch = msg.match(/Node '([^']+)' depends on '([^']+)' which does not exist/);
    if (missingDepMatch !== null) {
      suggestions.push(
        `Node '${missingDepMatch[1]}' depends on '${missingDepMatch[2]}' which does not exist.`,
      );
      continue;
    }

    // Nodes with no incoming edges (disconnected island detection)
    // Build incoming-edge set from edges array
    const incomingEdges = new Set<string>();
    for (const edge of dag.edges ?? []) {
      incomingEdges.add(edge.to);
    }
    // Nodes that are not an input type and have no incoming edges are likely disconnected
    const INPUT_NODE_TYPES_LOCAL = ['input', 'multi-input'];
    for (const node of nodes) {
      if (
        !INPUT_NODE_TYPES_LOCAL.includes(node.nodeType) &&
        !incomingEdges.has(node.nodeId) &&
        nodeIds.has(node.nodeId)
      ) {
        suggestions.push(`Node '${node.nodeId}' has no incoming edges. Connect it or remove it.`);
      }
    }
    // Only emit disconnected-node suggestions once (break after first error triggers this)
    break;
  }

  return suggestions;
}

interface IErrorFix {
  readonly fix: string;
  readonly snippet?: string;
}

/**
 * Return a fix suggestion with an optional JSON snippet for a single validation error.
 * Used when --suggest-fix is active for inline per-error output.
 */
function getFixForError(error: IValidationError, manifests: INodeManifest[]): IErrorFix | null {
  const knownTypes = manifests.map((m) => m.nodeType);

  if (error.code === 'UNKNOWN_NODE_TYPE' && error.nodeType) {
    const similar = findSimilarNodeType(error.nodeType, knownTypes);
    if (similar !== undefined) {
      return { fix: `Change nodeType to "${similar}".`, snippet: `"nodeType": "${similar}"` };
    }
    return { fix: `Run 'dag node list' to see available node types.` };
  }

  if (error.code === 'EDGE_NODE_NOT_FOUND' && error.nodeId) {
    return {
      fix: `Add the missing node "${error.nodeId}", or update the edge to reference an existing node.`,
      snippet: JSON.stringify(
        {
          nodeId: error.nodeId,
          nodeType: 'input',
          dependsOn: [],
          config: {},
          position: { x: 0, y: 0 },
        },
        null,
        JSON_INDENT_SPACES,
      ),
    };
  }

  if (error.code === 'REQUIRED_CONFIG_MISSING' && error.nodeType && error.key) {
    const manifest = manifests.find((m) => m.nodeType === error.nodeType);
    const schema = manifest?.configSchema as Record<string, unknown> | undefined;
    const props = schema?.['properties'] as Record<string, unknown> | undefined;
    const prop = props?.[error.key] as Record<string, unknown> | undefined;
    const defaultVal = prop?.['default'];
    const exampleVal = defaultVal !== undefined ? defaultVal : `<${error.key}-value>`;
    return {
      fix: `Add "${error.key}" to node config.`,
      snippet: `"config": { "${error.key}": ${JSON.stringify(exampleVal)} }`,
    };
  }

  if (error.message.includes('No input node found')) {
    return {
      fix: 'Add an input node to your DAG.',
      snippet: JSON.stringify(
        { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {}, position: { x: 0, y: 0 } },
        null,
        JSON_INDENT_SPACES,
      ),
    };
  }

  if (error.message.includes('No output node found')) {
    return {
      fix: 'Add a text-output node and connect it to the last node.',
      snippet: JSON.stringify(
        {
          nodeId: 'text-output',
          nodeType: 'text-output',
          dependsOn: ['<previous-nodeId>'],
          config: {},
          position: { x: 300, y: 0 },
        },
        null,
        JSON_INDENT_SPACES,
      ),
    };
  }

  if (error.message.includes('Cycle detected in DAG:')) {
    return { fix: 'Remove or redirect the circular dependency.' };
  }

  return null;
}

/**
 * Execute the `robota-dag validate <file>` subcommand.
 *
 * @param args - The argv slice starting after the `validate` keyword.
 * @param options - IO abstraction.
 * @returns Exit code (0 = valid, 1 = validation errors, 2 = usage/parse error).
 */
export async function validateCommand(
  args: readonly string[],
  options: IValidateCommandOptions,
): Promise<number> {
  const { io } = options;

  const parseResult = parseValidateArgv(args);
  if (!parseResult.ok) {
    io.writeError(`Error: ${parseResult.message}\n`);
    return parseResult.exitCode;
  }

  const { file, suggest, suggestFix, outputFormat, nodeFile, provider } = parseResult.value;

  // Read and parse the DAG file.
  const dagFileResult = await readDagFile(file, io);
  if (!dagFileResult.ok) {
    if (outputFormat === OUTPUT_FORMAT_JSON) {
      io.write(
        `${JSON.stringify({ valid: false, file, errors: [{ message: dagFileResult.message }], warnings: [], stats: { nodeCount: 0, edgeCount: 0 } }, null, JSON_INDENT_SPACES)}\n`,
      );
    } else {
      io.writeError(`Error: ${dagFileResult.message}\n`);
    }
    return USAGE_ERROR_EXIT_CODE;
  }

  // Build assembly to get manifests. DATA-002 P3: local-aware so DAGs using `.dag/nodes/` code
  // nodes validate without a manual `--node-file`.
  const nodeDefinitions = [...(await createCliNodeRegistryWithLocalNodes(process.cwd()))];
  if (nodeFile !== undefined) {
    let localDef;
    try {
      localDef = await loadNodeFileExplicit(resolve(nodeFile)); // allow-fallback: node file load error is surfaced as structured error
    } catch (loadErr) {
      // allow-fallback: node file load error is surfaced to the user and exits non-zero
      const msg = loadErr instanceof Error ? loadErr.message : String(loadErr);
      if (outputFormat === OUTPUT_FORMAT_JSON) {
        io.write(
          `${JSON.stringify({ valid: false, file, errors: [{ message: msg }], warnings: [], stats: { nodeCount: 0, edgeCount: 0 } }, null, JSON_INDENT_SPACES)}\n`,
        );
      } else {
        io.writeError(`Error: Failed to load node file: ${msg}\n`);
      }
      return USAGE_ERROR_EXIT_CODE;
    }
    nodeDefinitions.unshift(localDef);
  }
  const assemblyResult = buildNodeDefinitionAssembly(nodeDefinitions);
  if (!assemblyResult.ok) {
    const msg = assemblyResult.error.message;
    if (outputFormat === OUTPUT_FORMAT_JSON) {
      io.write(
        `${JSON.stringify({ valid: false, file, errors: [{ message: msg }], warnings: [], stats: { nodeCount: 0, edgeCount: 0 } }, null, JSON_INDENT_SPACES)}\n`,
      );
    } else {
      io.writeError(`Error: Failed to build node registry: ${msg}\n`);
    }
    return USAGE_ERROR_EXIT_CODE;
  }

  let { manifests } = assemblyResult.value;

  // PROVIDER-009: when a non-local provider is selected, validate against
  // that provider's catalog instead of the in-process node registry.
  if (provider !== undefined && provider !== 'local') {
    try {
      const runtimeProvider = await resolveProvider({ provider });
      const remoteCatalog = await runtimeProvider.listNodes();
      manifests = remoteCatalog.map((m) => ({
        nodeType: m.nodeType,
        displayName: m.nodeType,
        category: m.category,
        inputs: Object.entries(m.input.required ?? {}).map(([key, spec]) => ({
          key,
          type: portSpecToInternalType(spec),
          required: true,
        })),
        outputs: (m.output_name ?? m.output).map((key, i) => ({
          key,
          type: catalogTypeToInternal(m.output[i] ?? 'STRING'),
          required: true,
        })),
      }));
    } catch (providerErr) {
      // allow-fallback: provider catalog fetch failure is surfaced as a structured validation error; CLI cannot proceed without a catalog
      const msg = providerErr instanceof Error ? providerErr.message : String(providerErr);
      if (outputFormat === OUTPUT_FORMAT_JSON) {
        io.write(
          `${JSON.stringify({ valid: false, file, errors: [{ message: `Provider catalog fetch failed: ${msg}` }], warnings: [], stats: { nodeCount: 0, edgeCount: 0 } }, null, JSON_INDENT_SPACES)}\n`,
        );
      } else {
        io.writeError(`Error: Provider catalog fetch failed: ${msg}\n`);
      }
      return USAGE_ERROR_EXIT_CODE;
    }
  }

  const dag = dagFileResult.value;
  const { errors, warnings, stats } = validateDag(dag, manifests);

  const valid = errors.length === 0;

  // Build suggestions when --suggest is active and there are errors.
  const suggestions: string[] = suggest && !valid ? buildSuggestions(errors, dag, manifests) : [];

  if (outputFormat === OUTPUT_FORMAT_JSON) {
    const jsonResult: Record<string, unknown> = {
      valid,
      file,
      errors: errors.map((e) => e.message),
      warnings: warnings.map((w) => w.message),
      stats,
    };
    if (suggest) {
      jsonResult['suggestions'] = suggestions;
    }
    if (suggestFix) {
      jsonResult['fixes'] = errors.map((e) => {
        const fix = getFixForError(e, manifests);
        return fix ?? null;
      });
    }
    io.write(`${JSON.stringify(jsonResult, null, JSON_INDENT_SPACES)}\n`);
  } else {
    if (valid) {
      io.write(`✓ ${file} is valid\n`);
      io.write(`  Nodes: ${stats.nodeCount}  |  Edges: ${stats.edgeCount}\n`);
    } else {
      io.writeError(`✗ ${file} has ${errors.length} error(s)\n\n`);
      errors.forEach((error, index) => {
        io.writeError(`  Error ${index + 1}: ${error.message}\n`);
        if (suggestFix) {
          const fix = getFixForError(error, manifests);
          if (fix) {
            io.writeError(`    Fix: ${fix.fix}\n`);
            if (fix.snippet) {
              io.writeError(`    Suggested JSON:\n`);
              const indented = fix.snippet
                .split('\n')
                .map((line) => `      ${line}`)
                .join('\n');
              io.writeError(`${indented}\n`);
            }
          }
        }
      });
      if (suggestions.length > 0) {
        io.writeError('\nSuggestions:\n');
        suggestions.forEach((s) => {
          io.writeError(`  • ${s}\n`);
        });
      }
    }
  }

  return valid ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE;
}

// ---------------------------------------------------------------------------
// PROVIDER-009: catalog port-type → internal port type mapping helpers
// ---------------------------------------------------------------------------

const CATALOG_TO_INTERNAL_TYPE: Record<string, TPortValueType> = {
  STRING: 'string',
  INT: 'number',
  FLOAT: 'number',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  JSON: 'object',
  OBJECT: 'object',
  IMAGE: 'binary',
  LATENT: 'binary',
  MODEL: 'binary',
};

function catalogTypeToInternal(catalogType: string): TPortValueType {
  return CATALOG_TO_INTERNAL_TYPE[catalogType] ?? 'string';
}

function portSpecToInternalType(spec: INodePortSpec): TPortValueType {
  const first = spec[0];
  if (typeof first === 'string') return catalogTypeToInternal(first);
  return 'string';
}
