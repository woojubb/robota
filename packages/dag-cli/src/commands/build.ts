import { readFile, writeFile } from 'node:fs/promises';
import type {
  IDagDefinition,
  IDagEdgeDefinition,
  IDagNode,
  INodeConfigObject,
  TPortPayload,
} from '@robota-sdk/dag-core';
import { buildNodeDefinitionAssembly } from '@robota-sdk/dag-node';
import type { IDagCliIo } from '../types.js';
import { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE, USAGE_ERROR_EXIT_CODE } from '../types.js';
import { createCliNodeRegistry, LocalDagRunner } from '../local-runner/index.js';
import type { ILocalRunResult } from '../local-runner/index.js';
import { extractFinalOutput } from './run.js';
import type { IBuildSpec } from './convert.js';

const JSON_INDENT_SPACES = 2;
const NODE_X_SPACING = 300;

export interface IBuildCommandOptions {
  readonly io: IDagCliIo;
}

interface IParsedBuildOptions {
  readonly dagId: string;
  readonly spec: string;
  readonly outputPath: string | undefined;
  readonly fromStdin: boolean;
  readonly strict: boolean;
  readonly runAfterBuild: boolean;
  readonly inputs: ReadonlyArray<string>; // raw "key=value" strings
  readonly resultOnly: boolean;
}

type TParseResult =
  | { readonly ok: true; readonly value: IParsedBuildOptions }
  | { readonly ok: false; readonly exitCode: number; readonly message: string };

function parseBuildArgv(args: readonly string[]): TParseResult {
  let dagId: string | undefined;
  let spec: string | undefined;
  let outputPath: string | undefined;
  let fromStdin = false;
  let strict = false;
  let runAfterBuild = false;
  let resultOnly = false;
  const inputs: string[] = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--dagId') {
      const next = args[i + 1];
      if (typeof next !== 'string' || next.startsWith('--')) {
        return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: '--dagId requires a value.' };
      }
      dagId = next;
      i += 2;
    } else if (arg === '--spec') {
      const next = args[i + 1];
      if (typeof next !== 'string' || next.startsWith('--')) {
        return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: '--spec requires a value.' };
      }
      spec = next;
      i += 2;
    } else if (arg === '--output') {
      const next = args[i + 1];
      if (typeof next !== 'string' || next.startsWith('--')) {
        return {
          ok: false,
          exitCode: USAGE_ERROR_EXIT_CODE,
          message: '--output requires a value.',
        };
      }
      outputPath = next;
      i += 2;
    } else if (arg === '--input') {
      const next = args[i + 1];
      if (typeof next !== 'string' || next.startsWith('--')) {
        return {
          ok: false,
          exitCode: USAGE_ERROR_EXIT_CODE,
          message: '--input requires a key=value argument.',
        };
      }
      if (!next.includes('=')) {
        return {
          ok: false,
          exitCode: USAGE_ERROR_EXIT_CODE,
          message: `--input value must contain '=', got: "${next}".`,
        };
      }
      inputs.push(next);
      i += 2;
    } else if (arg === '--stdin') {
      fromStdin = true;
      i += 1;
    } else if (arg === '--strict') {
      strict = true;
      i += 1;
    } else if (arg === '--run') {
      runAfterBuild = true;
      i += 1;
    } else if (arg === '--result') {
      resultOnly = true;
      i += 1;
    } else if ((arg as string | undefined)?.startsWith('--')) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: `build received unexpected flag: ${arg}.`,
      };
    } else {
      i += 1;
    }
  }

  if (resultOnly && !runAfterBuild) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: '--result requires --run.',
    };
  }

  if (!dagId) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: '--dagId is required.',
    };
  }

  if (!spec && !fromStdin) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: '--spec is required (or use --stdin to read spec from stdin).',
    };
  }

  return {
    ok: true,
    value: {
      dagId,
      spec: spec ?? '',
      outputPath,
      fromStdin,
      strict,
      runAfterBuild,
      inputs,
      resultOnly,
    },
  };
}

/**
 * Read all bytes from stdin and return as UTF-8 string.
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function resolveErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Parse the IBuildSpec JSON string, accepting input from --spec or stdin.
 */
function parseBuildSpec(
  raw: string,
):
  | { readonly ok: true; readonly value: IBuildSpec }
  | { readonly ok: false; readonly message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (parseErr) {
    // allow-fallback: JSON parse error returned as structured error
    return { ok: false, message: `Failed to parse spec JSON: ${resolveErrorMessage(parseErr)}` };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: 'Spec must be a JSON object.' };
  }

  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj['nodes'])) {
    return { ok: false, message: 'Spec must have a "nodes" array.' };
  }
  if (!Array.isArray(obj['edges'])) {
    return { ok: false, message: 'Spec must have an "edges" array.' };
  }

  return { ok: true, value: obj as unknown as IBuildSpec };
}

/**
 * Assign unique nodeIds from the spec nodes array.
 * - If id is provided, use it as-is.
 * - If id is omitted, use nodeType. If that collides, append index counter.
 */
function assignNodeIds(
  nodes: IBuildSpec['nodes'],
): Array<{ nodeId: string; nodeType: string; config: Record<string, unknown> }> {
  const typeCounts = new Map<string, number>();

  return nodes.map((node) => {
    if (node.id) {
      return { nodeId: node.id, nodeType: node.type, config: node.config ?? {} };
    }

    const count = typeCounts.get(node.type) ?? 0;
    typeCounts.set(node.type, count + 1);

    const nodeId = count === 0 ? node.type : `${node.type}-${count}`;
    return { nodeId, nodeType: node.type, config: node.config ?? {} };
  });
}

/**
 * Parse a single edge string into from/to node ids and optional port bindings.
 *
 * Formats:
 *   "nodeA→nodeB"              — default ports
 *   "nodeA.outputPort→nodeB.inputPort"  — explicit port binding
 */
function parseEdgeString(edge: string): {
  readonly from: string;
  readonly fromPort: string | undefined;
  readonly to: string;
  readonly toPort: string | undefined;
} | null {
  // Support both → (U+2192) and -> (ASCII)
  const arrowIndex = edge.indexOf('→');
  const separator = arrowIndex !== -1 ? '→' : '->';
  const sepIdx = edge.indexOf(separator);
  if (sepIdx === -1) return null;

  const leftPart = edge.slice(0, sepIdx).trim();
  const rightPart = edge.slice(sepIdx + separator.length).trim();

  function splitNodePort(part: string): { nodeId: string; port: string | undefined } {
    const dotIdx = part.indexOf('.');
    if (dotIdx === -1) return { nodeId: part, port: undefined };
    return { nodeId: part.slice(0, dotIdx), port: part.slice(dotIdx + 1) };
  }

  const left = splitNodePort(leftPart);
  const right = splitNodePort(rightPart);

  return { from: left.nodeId, fromPort: left.port, to: right.nodeId, toPort: right.port };
}

/**
 * Build an IDagDefinition from an IBuildSpec plus node manifests.
 */
export function buildDagFromSpec(
  dagId: string,
  spec: IBuildSpec,
  manifests: ReadonlyArray<{
    nodeType: string;
    defaultInputPort?: string;
    defaultOutputPort?: string;
  }>,
):
  | { readonly ok: true; readonly definition: IDagDefinition }
  | { readonly ok: false; readonly message: string } {
  const resolved = assignNodeIds(spec.nodes);

  const nodeById = new Map(resolved.map((n) => [n.nodeId, n]));
  const knownTypes = new Map(manifests.map((m) => [m.nodeType, m]));

  // Validate node types
  for (const n of resolved) {
    if (!knownTypes.has(n.nodeType)) {
      const available = manifests.map((m) => m.nodeType).join(', ');
      return {
        ok: false,
        message: `Unknown node type "${n.nodeType}". Available: ${available}`,
      };
    }
  }

  // Parse edges and build dependsOn map
  const dependsOnMap = new Map<string, string[]>();
  for (const n of resolved) {
    dependsOnMap.set(n.nodeId, []);
  }

  const dagEdges: IDagEdgeDefinition[] = [];

  for (const edgeStr of spec.edges) {
    const parsed = parseEdgeString(edgeStr);
    if (!parsed) {
      return {
        ok: false,
        message: `Invalid edge format: "${edgeStr}". Expected "from→to" or "from.port→to.port".`,
      };
    }

    const { from, fromPort, to, toPort } = parsed;

    if (!nodeById.has(from)) {
      return { ok: false, message: `Edge references unknown node id "${from}" in "${edgeStr}".` };
    }
    if (!nodeById.has(to)) {
      return { ok: false, message: `Edge references unknown node id "${to}" in "${edgeStr}".` };
    }

    // Resolve port keys
    const fromManifest = knownTypes.get(nodeById.get(from)?.nodeType ?? '');
    const toManifest = knownTypes.get(nodeById.get(to)?.nodeType ?? '');

    const resolvedFromPort = fromPort ?? fromManifest?.defaultOutputPort;
    const resolvedToPort = toPort ?? toManifest?.defaultInputPort;

    const edge: IDagEdgeDefinition = {
      from,
      to,
    };

    if (resolvedFromPort && resolvedToPort) {
      dagEdges.push({
        ...edge,
        bindings: [{ outputKey: resolvedFromPort, inputKey: resolvedToPort }],
      });
    } else {
      dagEdges.push(edge);
    }

    // Record dependency
    const deps = dependsOnMap.get(to) ?? [];
    if (!deps.includes(from)) {
      deps.push(from);
      dependsOnMap.set(to, deps);
    }
  }

  // Build IDagNode array with positions and dependsOn
  const dagNodes: IDagNode[] = resolved.map((n, index) => ({
    nodeId: n.nodeId,
    nodeType: n.nodeType,
    dependsOn: dependsOnMap.get(n.nodeId) ?? [],
    config: n.config as unknown as INodeConfigObject,
    position: {
      x: index * NODE_X_SPACING,
      y: 0,
    },
  }));

  const definition: IDagDefinition = {
    dagId,
    version: 1,
    status: 'draft',
    nodes: dagNodes,
    edges: dagEdges,
  };

  return { ok: true, definition };
}

/**
 * Port type compatibility rules for LLM prompts that generate DAG specs.
 * Include this text in any prompt that asks an LLM to produce node edges.
 */
export const PORT_TYPE_COMPATIBILITY_RULES = `PORT TYPE COMPATIBILITY RULES (CRITICAL):
- string → string: compatible ✓
- object → object: compatible ✓
- binary → binary: compatible ✓
- string → object: INCOMPATIBLE ✗ — do NOT create this edge
- object → string: INCOMPATIBLE ✗ — do NOT create this edge
Always verify that edge bindings connect ports of the same type.`;

/**
 * Execute the `dag build` subcommand.
 *
 * @param args    - argv slice after the `build` keyword.
 * @param options - IO abstraction.
 * @returns Exit code.
 */
export async function buildCommand(
  args: readonly string[],
  options: IBuildCommandOptions,
): Promise<number> {
  const { io } = options;

  const parseResult = parseBuildArgv(args);
  if (!parseResult.ok) {
    io.write(`Error: ${parseResult.message}\n`);
    return parseResult.exitCode;
  }

  const { dagId, outputPath, fromStdin, strict, runAfterBuild, inputs, resultOnly } =
    parseResult.value;
  let specJson = parseResult.value.spec;

  // If --spec value looks like a file path (.json or .spec), read its contents
  if (specJson && (specJson.endsWith('.json') || specJson.endsWith('.spec'))) {
    try {
      specJson = await readFile(specJson, 'utf8');
    } catch (readErr) {
      // allow-fallback: file read failure is a terminal error surfaced to the user
      io.write(
        `Error: Could not read spec file "${parseResult.value.spec}": ${resolveErrorMessage(readErr)}\n`,
      );
      return FAILURE_EXIT_CODE;
    }
  }

  // If --stdin, read spec from stdin
  if (fromStdin) {
    specJson = await readStdin();
    if (!specJson.trim()) {
      io.write('Error: --stdin was set but no data was received on stdin.\n');
      return FAILURE_EXIT_CODE;
    }
  }

  const specResult = parseBuildSpec(specJson);
  if (!specResult.ok) {
    io.write(`Error: ${specResult.message}\n`);
    return FAILURE_EXIT_CODE;
  }

  // Build node registry and get manifests
  const nodeDefinitions = createCliNodeRegistry();
  const assemblyResult = buildNodeDefinitionAssembly(nodeDefinitions);
  if (!assemblyResult.ok) {
    io.write(`Error: Failed to build node registry: ${assemblyResult.error.message}\n`);
    return FAILURE_EXIT_CODE;
  }

  const { manifests } = assemblyResult.value;

  const buildResult = buildDagFromSpec(dagId, specResult.value, manifests);
  if (!buildResult.ok) {
    io.write(`Error: ${buildResult.message}\n`);
    return FAILURE_EXIT_CODE;
  }

  // Validate config keys against each node's configSchema
  const manifestsByType = new Map(manifests.map((m) => [m.nodeType, m]));
  for (const node of buildResult.definition.nodes) {
    const manifest = manifestsByType.get(node.nodeType);
    const schemaProps = manifest?.configSchema?.['properties'];
    if (schemaProps === null || schemaProps === undefined || typeof schemaProps !== 'object') {
      continue;
    }
    const knownKeys = new Set(Object.keys(schemaProps as Record<string, unknown>));
    for (const key of Object.keys(node.config)) {
      if (!knownKeys.has(key)) {
        const warning = `⚠ ${node.nodeId} (${node.nodeType}): unknown config key "${key}" — ignored at runtime\n`;
        io.write(warning);
        if (strict) {
          return FAILURE_EXIT_CODE;
        }
      }
    }
  }

  const dagDefinition = buildResult.definition;
  const dagJson = JSON.stringify(dagDefinition, null, JSON_INDENT_SPACES);

  if (outputPath) {
    try {
      await writeFile(outputPath, dagJson + '\n', 'utf8');
    } catch (writeErr) {
      // allow-fallback: file write failure returns structured error and non-zero exit
      io.write(
        `Error: Failed to write output file "${outputPath}": ${resolveErrorMessage(writeErr)}\n`,
      );
      return FAILURE_EXIT_CODE;
    }
    io.write(`Written: ${outputPath}\n`);
  } else if (!runAfterBuild) {
    io.write(dagJson + '\n');
  }

  if (!runAfterBuild) {
    return SUCCESS_EXIT_CODE;
  }

  // --run: execute the built DAG in-process
  const inputPayload: TPortPayload = {};
  for (const raw of inputs) {
    const eqIdx = raw.indexOf('=');
    const key = raw.slice(0, eqIdx);
    const val = raw.slice(eqIdx + 1);
    inputPayload[key] = val;
  }

  const runner = new LocalDagRunner(createCliNodeRegistry());
  let runResult: ILocalRunResult;
  try {
    runResult = await runner.run(dagDefinition, inputPayload); // allow-fallback: run error reported as structured output and non-zero exit
  } catch (runErr) {
    // allow-fallback: run error reported as structured output and non-zero exit
    io.write(`Error: DAG run failed: ${resolveErrorMessage(runErr)}\n`);
    return FAILURE_EXIT_CODE;
  }

  if (runResult.dagRun.status !== 'success') {
    io.write(`Error: DAG run did not succeed (status: ${runResult.dagRun.status}).\n`);
    return FAILURE_EXIT_CODE;
  }

  if (resultOnly) {
    const finalText = extractFinalOutput(runResult.taskRuns, dagDefinition.nodes);
    if (finalText !== null) {
      io.write(finalText);
    } else {
      io.write('Error: no text-output found in run result.\n');
      return FAILURE_EXIT_CODE;
    }
  } else {
    io.write(`✓ Run completed (${runResult.taskRuns.length} nodes)\n`);
    for (const taskRun of runResult.taskRuns) {
      io.write(`  ${taskRun.status === 'success' ? '✓' : '✗'} ${taskRun.nodeId}\n`);
    }
  }

  return SUCCESS_EXIT_CODE;
}
