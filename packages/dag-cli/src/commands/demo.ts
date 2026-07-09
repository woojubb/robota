import type {
  IDagDefinition,
  IDagEdgeDefinition,
  IDagNode,
  INodeConfigObject,
} from '@robota-sdk/dag-core';
import { buildNodeDefinitionAssembly } from '@robota-sdk/dag-node';
import type { IDagCliIo } from '../types.js';
import { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE } from '../types.js';
import { LocalDagRunner, createCliNodeRegistry } from '../local-runner/index.js';

export interface IDemoCommandOptions {
  readonly io: IDagCliIo;
}

function resolveErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Build the demo DAG definition with proper port bindings:
 *   input → text-template → text-output
 */
function buildDemoDagDefinition(
  manifests: ReadonlyArray<{
    nodeType: string;
    defaultInputPort?: string;
    defaultOutputPort?: string;
  }>,
): IDagDefinition {
  const knownTypes = new Map(manifests.map((m) => [m.nodeType, m]));

  function makeEdge(
    fromNodeType: string,
    toNodeType: string,
    fromNodeId: string,
    toNodeId: string,
  ): IDagEdgeDefinition {
    const fromManifest = knownTypes.get(fromNodeType);
    const toManifest = knownTypes.get(toNodeType);
    const fromPort = fromManifest?.defaultOutputPort;
    const toPort = toManifest?.defaultInputPort;
    if (fromPort && toPort) {
      return {
        from: fromNodeId,
        to: toNodeId,
        bindings: [{ outputKey: fromPort, inputKey: toPort }],
      };
    }
    return { from: fromNodeId, to: toNodeId };
  }

  const dagNodes: IDagNode[] = [
    {
      nodeId: 'input',
      nodeType: 'input',
      dependsOn: [],
      config: {} as unknown as INodeConfigObject,
      position: { x: 0, y: 0 },
    },
    {
      nodeId: 'text-template',
      nodeType: 'text-template',
      dependsOn: ['input'],
      config: { template: 'Processing: {{text}}' } as unknown as INodeConfigObject,
      position: { x: 300, y: 0 },
    },
    {
      nodeId: 'text-output',
      nodeType: 'text-output',
      dependsOn: ['text-template'],
      config: {} as unknown as INodeConfigObject,
      position: { x: 600, y: 0 },
    },
  ];

  const dagEdges: IDagEdgeDefinition[] = [
    makeEdge('input', 'text-template', 'input', 'text-template'),
    makeEdge('text-template', 'text-output', 'text-template', 'text-output'),
  ];

  return {
    dagId: 'demo',
    version: 1,
    status: 'draft',
    nodes: dagNodes,
    edges: dagEdges,
  };
}

/**
 * Execute the `dag demo` subcommand.
 *
 * Runs a local demo pipeline (no API key required):
 *   input → text-template → text-output
 *
 * @param _args   - argv slice after the `demo` keyword (currently unused).
 * @param options - IO abstraction.
 * @returns Exit code.
 */
export async function demoCommand(
  _args: readonly string[],
  options: IDemoCommandOptions,
): Promise<number> {
  const { io } = options;

  io.write('Running demo pipeline — no API key required...\n\n');
  io.write('Pipeline: input → text-template → text-output\n\n');

  // Build node registry and get manifests for proper port binding resolution
  const nodeDefinitions = createCliNodeRegistry();
  const assemblyResult = buildNodeDefinitionAssembly(nodeDefinitions);
  if (!assemblyResult.ok) {
    io.write(`Error: Failed to initialize node registry: ${assemblyResult.error.code}\n`);
    return FAILURE_EXIT_CODE;
  }
  const { manifests } = assemblyResult.value;

  const dagDefinition = buildDemoDagDefinition(manifests);
  const input = { text: 'Hello from robota-dag!' };

  let runner: LocalDagRunner;
  try {
    runner = new LocalDagRunner(nodeDefinitions);
  } catch (err) {
    io.write(`Error: Failed to initialize runner: ${resolveErrorMessage(err)}\n`);
    return FAILURE_EXIT_CODE;
  }

  const startMs = Date.now();
  let result;
  try {
    result = await runner.run(dagDefinition, input);
  } catch (err) {
    io.write(`Error: Demo run failed: ${resolveErrorMessage(err)}\n`);
    return FAILURE_EXIT_CODE;
  }
  const endMs = Date.now();
  const durationMs = endMs - startMs;

  // Build a map of nodeId → output text for display
  const nodeOutputs = new Map<string, string>();
  for (const taskRun of result.taskRuns) {
    if (taskRun.outputSnapshot) {
      try {
        const snapshot = JSON.parse(taskRun.outputSnapshot) as unknown;
        if (typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot)) {
          const rec = snapshot as Record<string, unknown>;
          const textValue = rec['text'];
          if (typeof textValue === 'string') {
            nodeOutputs.set(taskRun.nodeId, textValue);
          } else {
            const firstValue = Object.values(rec).find((v) => typeof v === 'string');
            if (typeof firstValue === 'string') {
              nodeOutputs.set(taskRun.nodeId, firstValue);
            }
          }
        }
      } catch {
        // allow-fallback: skip unreadable output snapshots
      }
    }
  }

  // Display node-by-node results
  const nodeOrder = ['input', 'text-template', 'text-output'];
  const total = nodeOrder.length;

  for (let i = 0; i < nodeOrder.length; i++) {
    const nodeId = nodeOrder[i];
    const nodeOutput = nodeOutputs.get(nodeId) ?? input.text;
    const step = i + 1;
    const padded = nodeId.padEnd(14);
    io.write(`[${step}/${total}] ✓ ${padded} → "${nodeOutput}"\n`);
  }

  io.write(`\nCompleted in ${durationMs}ms (local only — no API calls made)\n`);
  io.write('\nReady to use LLM nodes? Set an API key first:\n');
  io.write('  dag doctor                              → check environment & API keys\n');
  io.write(
    '  dag run --pipeline "input | llm-text[provider=anthropic] | text-output" \\\n    --input text="Your question here"    → run a real LLM pipeline\n',
  );
  io.write('  dag tutorial                           → interactive 5-minute walkthrough\n');

  return result.dagRun.status === 'success' ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE;
}
