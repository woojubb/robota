import type { IDagCliIo } from '../types.js';
import { SUCCESS_EXIT_CODE, FAILURE_EXIT_CODE, USAGE_ERROR_EXIT_CODE } from '../types.js';
import { LocalDagRunner, createCliNodeRegistry } from '../local-runner/index.js';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import { parsePipelineSpec } from '../pipeline-parser.js';

const MS_PER_SECOND = 1000;
const DEFAULT_AAV_INPUT = 'What is a DAG? Answer in one sentence.';

export interface IAavCommandOptions {
  readonly io: IDagCliIo;
}

interface IParsedAavOptions {
  readonly pipeline: string;
  readonly input: string;
  readonly json: boolean;
}

type TParseResult =
  | { readonly ok: true; readonly value: IParsedAavOptions }
  | { readonly ok: false; readonly exitCode: number; readonly message: string };

const AAV_HELP = `Usage: dag aav [--pipeline <spec>] [--input <text>] [--json]

Measure Agent Authoring Velocity — time from pipeline spec to first result.

Options:
  --pipeline <spec>  Inline pipeline (default: "input | llm-text-anthropic | text-output")
  --input <text>     Input text (default: built-in test prompt)
  --json             JSON output

Example:
  dag aav --pipeline "input | llm-text-anthropic | text-output"
  dag aav --pipeline "input | llm-text-openai | text-output" --json
`;

function buildAavDag(spec: string): IDagDefinition | null {
  const parseResult = parsePipelineSpec(spec);
  if (!parseResult.ok || parseResult.nodes.length < 2) return null;

  const nodes = parseResult.nodes.map((nodeSpec, i) => ({
    nodeId:
      nodeSpec.nodeType
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || `node-${i}`,
    nodeType: nodeSpec.nodeType,
    dependsOn:
      i === 0
        ? []
        : [
            parseResult.nodes[i - 1]!.nodeType.replace(/[^a-z0-9]/g, '-')
              .replace(/-+/g, '-')
              .replace(/^-|-$/g, '') || `node-${i - 1}`,
          ],
    config: nodeSpec.config,
    position: { x: i * 250, y: 200 },
  }));

  const edges = nodes.slice(1).map((node, i) => ({
    from: nodes[i]!.nodeId,
    to: node.nodeId,
    bindings: [{ outputKey: 'text', inputKey: 'text' }],
  }));

  return {
    dagId: 'aav-benchmark',
    version: 1,
    status: 'draft' as const,
    nodes,
    edges,
  };
}

function parseAavArgv(args: readonly string[]): TParseResult {
  if (args.includes('--help') || args.includes('-h')) {
    return { ok: false, exitCode: SUCCESS_EXIT_CODE, message: AAV_HELP };
  }

  const mutableArgs = [...args];
  let pipeline = 'input | llm-text-anthropic | text-output';
  let input = DEFAULT_AAV_INPUT;
  let json = false;

  const jsonIdx = mutableArgs.indexOf('--json');
  if (jsonIdx !== -1) {
    json = true;
    mutableArgs.splice(jsonIdx, 1);
  }

  const pipelineIdx = mutableArgs.indexOf('--pipeline');
  if (pipelineIdx !== -1) {
    const val = mutableArgs[pipelineIdx + 1];
    if (typeof val !== 'string' || val.startsWith('--')) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: '--pipeline requires a value.',
      };
    }
    pipeline = val;
    mutableArgs.splice(pipelineIdx, 2);
  }

  const inputIdx = mutableArgs.indexOf('--input');
  if (inputIdx !== -1) {
    const val = mutableArgs[inputIdx + 1];
    if (typeof val !== 'string' || val.startsWith('--')) {
      return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: '--input requires a value.' };
    }
    input = val;
    mutableArgs.splice(inputIdx, 2);
  }

  const unknownFlags = mutableArgs.filter((a) => a.startsWith('--'));
  if (unknownFlags.length > 0) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `aav received unexpected flags: ${unknownFlags.join(' ')}.`,
    };
  }

  return { ok: true, value: { pipeline, input, json } };
}

/**
 * Execute the `dag aav` subcommand — Agent Authoring Velocity benchmark.
 *
 * Measures spec-to-first-result latency: how fast a pipeline spec can be
 * built and executed, representing the velocity an AI agent achieves.
 */
export async function aavCommand(
  args: readonly string[],
  options: IAavCommandOptions,
): Promise<number> {
  const { io } = options;

  const parseResult = parseAavArgv(args);
  if (!parseResult.ok) {
    io.write(
      parseResult.exitCode === SUCCESS_EXIT_CODE
        ? parseResult.message
        : `Error: ${parseResult.message}\n`,
    );
    return parseResult.exitCode;
  }

  const { pipeline, input, json } = parseResult.value;

  const dag = buildAavDag(pipeline);
  if (dag === null) {
    io.write(`Error: Pipeline spec must have at least 2 nodes separated by "|".\n`);
    return USAGE_ERROR_EXIT_CODE;
  }

  if (!json) {
    io.write(`\nAgent Authoring Velocity Benchmark\n`);
    io.write(`Pipeline: ${pipeline}\n`);
    io.write(`Input:    "${input}"\n\n`);
    io.write(`Building and running...\n`);
  }

  const t0 = Date.now();
  const nodeDefinitions = createCliNodeRegistry();
  const runner = new LocalDagRunner(nodeDefinitions);
  const tBuildMs = Date.now() - t0;

  let runResult: Awaited<ReturnType<typeof runner.run>>;
  try {
    runResult = await runner.run(dag, { text: input });
  } catch (runErr) {
    // allow-fallback: run failure is reported as a failed AAV measurement
    const msg = runErr instanceof Error ? runErr.message : String(runErr);
    io.write(`Error: Pipeline execution failed: ${msg}\n`);
    return FAILURE_EXIT_CODE;
  }
  const totalMs = Date.now() - t0;
  const totalS = (totalMs / MS_PER_SECOND).toFixed(2);

  const successNodes = runResult.taskRuns.filter((t) => t.status === 'success').length;
  const totalNodes = dag.nodes.length;

  if (json) {
    io.write(
      `${JSON.stringify(
        {
          pipeline,
          totalMs,
          buildMs: tBuildMs,
          runMs: totalMs - tBuildMs,
          totalS: parseFloat(totalS),
          nodes: totalNodes,
          successNodes,
          ok: successNodes === totalNodes,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    io.write(`\n`);
    io.write(`Results\n`);
    io.write(`  Total time:   ${totalS}s (${totalMs}ms)\n`);
    io.write(`  Build time:   ${tBuildMs}ms\n`);
    io.write(`  Run time:     ${totalMs - tBuildMs}ms\n`);
    io.write(`  Nodes:        ${successNodes}/${totalNodes} completed\n`);
    io.write(`\n`);
    if (successNodes === totalNodes) {
      io.write(`✓ AAV: ${totalS}s spec-to-result\n\n`);
    } else {
      io.write(`⚠ ${totalNodes - successNodes} node(s) did not complete\n\n`);
    }
  }

  return successNodes === totalNodes ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE;
}
