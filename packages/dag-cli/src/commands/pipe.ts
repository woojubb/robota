import type { INodeConfigObject } from '@robota-sdk/dag-core';
import { buildNodeDefinitionAssembly } from '@robota-sdk/dag-node';
import type { IDagCliIo } from '../types.js';
import { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE, USAGE_ERROR_EXIT_CODE } from '../types.js';
import { createCliNodeRegistry, LocalDagRunner } from '../local-runner/index.js';
import { parsePipelineSpec } from '../pipeline-parser.js';
import { extractFinalOutput } from './run.js';

const NODE_X_SPACING = 300;
const PIPE_HELP = `Usage: dag pipe [<pipeline-spec>]

Pipe stdin text through a pipeline and write result to stdout.
If no spec is given, the default is "transform" (pass-through).

Examples:
  echo "Hello" | dag pipe "transform[prefix=→ ]"
  echo "Hello" | dag pipe "transform[prefix=STEP1: ]" | dag pipe "transform[prefix=STEP2: ]"
  cat notes.txt | dag pipe "llm-text-anthropic[model=claude-haiku-4-5-20251001]"
`;

export interface IPipeCommandOptions {
  readonly io: IDagCliIo;
}

async function readStdin(): Promise<string> {
  const parts: string[] = [];
  for await (const chunk of process.stdin) {
    parts.push(typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8'));
  }
  return parts.join('');
}

export async function pipeCommand(
  args: readonly string[],
  options: IPipeCommandOptions,
): Promise<number> {
  const { io } = options;

  if (args.includes('--help') || args.includes('-h')) {
    io.write(PIPE_HELP);
    return SUCCESS_EXIT_CODE;
  }

  const pipelineArg = args.filter((a) => !a.startsWith('--'))[0] ?? 'transform';

  if (args.some((a) => a.startsWith('--'))) {
    const unknownFlags = args.filter((a) => a.startsWith('--') && a !== '--help' && a !== '-h');
    if (unknownFlags.length > 0) {
      io.write(`Error: pipe received unexpected flags: ${unknownFlags.join(' ')}.\n`);
      return USAGE_ERROR_EXIT_CODE;
    }
  }

  // Read stdin
  const stdinText = await readStdin();
  if (!stdinText) {
    io.write('Error: pipe requires text on stdin.\n');
    return FAILURE_EXIT_CODE;
  }

  // Wrap spec: "input | <pipelineArg> | text-output"
  const fullSpec = `input | ${pipelineArg} | text-output`;
  const parseResult = parsePipelineSpec(fullSpec);
  if (!parseResult.ok) {
    io.write(`Error: ${parseResult.message}\n`);
    return USAGE_ERROR_EXIT_CODE;
  }

  // Build node registry
  const nodeDefinitions = createCliNodeRegistry();
  const assemblyResult = buildNodeDefinitionAssembly(nodeDefinitions);
  if (!assemblyResult.ok) {
    io.write(`Error: Failed to build node registry: ${assemblyResult.error.message}\n`);
    return FAILURE_EXIT_CODE;
  }

  const { manifests } = assemblyResult.value;
  const knownTypes = new Map(manifests.map((m) => [m.nodeType, m]));

  // Validate and resolve nodes
  const typeCounts = new Map<string, number>();
  const resolved: Array<{
    nodeId: string;
    nodeType: string;
    config: Record<string, string | number | boolean>;
  }> = [];
  for (const nodeSpec of parseResult.nodes) {
    const { nodeType, config } = nodeSpec;
    if (!knownTypes.has(nodeType)) {
      io.write(`Error: Unknown node type "${nodeType}".\n`);
      return USAGE_ERROR_EXIT_CODE;
    }
    const count = typeCounts.get(nodeType) ?? 0;
    typeCounts.set(nodeType, count + 1);
    const nodeId = count === 0 ? nodeType : `${nodeType}-${count}`;
    resolved.push({ nodeId, nodeType, config });
  }

  // Build edges and dependsOn
  const dependsOnMap = new Map<string, string[]>();
  for (const n of resolved) {
    dependsOnMap.set(n.nodeId, []);
  }
  const dagEdges = [];
  for (let i = 0; i < resolved.length - 1; i++) {
    const from = resolved[i]!;
    const to = resolved[i + 1]!;
    const fromManifest = knownTypes.get(from.nodeType);
    const toManifest = knownTypes.get(to.nodeType);
    const fromPort = fromManifest?.defaultOutputPort;
    const toPort = toManifest?.defaultInputPort;
    if (fromPort && toPort) {
      dagEdges.push({
        from: from.nodeId,
        to: to.nodeId,
        bindings: [{ outputKey: fromPort, inputKey: toPort }],
      });
    } else {
      dagEdges.push({ from: from.nodeId, to: to.nodeId });
    }
    const deps = dependsOnMap.get(to.nodeId) ?? [];
    if (!deps.includes(from.nodeId)) {
      deps.push(from.nodeId);
      dependsOnMap.set(to.nodeId, deps);
    }
  }

  const dagNodes = resolved.map((n, index) => ({
    nodeId: n.nodeId,
    nodeType: n.nodeType,
    dependsOn: dependsOnMap.get(n.nodeId) ?? [],
    config: n.config as unknown as INodeConfigObject,
    position: { x: index * NODE_X_SPACING, y: 0 },
  }));

  const dagDefinition = {
    dagId: 'pipe-inline',
    version: 1 as const,
    status: 'draft' as const,
    nodes: dagNodes,
    edges: dagEdges,
  };

  // Run with stdin text as input.text
  const runner = new LocalDagRunner(createCliNodeRegistry());
  let runResult;
  try {
    runResult = await runner.run(dagDefinition, { text: stdinText.trimEnd() }); // allow-fallback: run error reported as structured output and non-zero exit
  } catch (runErr) {
    // allow-fallback: run error reported as structured output and non-zero exit
    const msg = runErr instanceof Error ? runErr.message : String(runErr);
    io.write(`Error: ${msg}\n`);
    return FAILURE_EXIT_CODE;
  }

  if (runResult.dagRun.status !== 'success') {
    io.write(`Error: pipe run did not succeed (status: ${runResult.dagRun.status}).\n`);
    return FAILURE_EXIT_CODE;
  }

  const finalText = extractFinalOutput(runResult.taskRuns, dagDefinition.nodes);
  if (finalText === null) {
    io.write('Error: no text-output found in run result.\n');
    return FAILURE_EXIT_CODE;
  }

  io.write(finalText);
  return SUCCESS_EXIT_CODE;
}
