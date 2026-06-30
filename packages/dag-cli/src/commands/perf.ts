import { writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
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

export interface IPerfCommandOptions {
  readonly io: IDagCliIo;
}

interface IPerfResult {
  version: string;
  timestamp: string;
  environment: {
    nodeVersion: string;
    platform: string;
  };
  nodeOverhead: Record<
    string,
    { p50ms: number; p95ms: number; p99ms: number; sampleCount: number }
  >;
  pipelineOverhead: Record<
    string,
    { p50ms: number; p95ms: number; p99ms: number; sampleCount: number }
  >;
  methodology: string;
}

const HELP_TEXT = `Usage: dag perf [options]

Measure in-process execution overhead for DAG nodes and pipelines.
No API calls are made — benchmarks use only local nodes.

Options:
  --runs <n>       Number of iterations per scenario (default: 100)
  --output <path>  Write JSON results to file (default: stdout)
  --save           Save to benchmarks/latest.json + benchmarks/<version>.json
  --output-format  Output format: pretty (default) or json
  --hints          Show optimization hints based on results
  --publish        Publish results to a GitHub Gist (requires GITHUB_TOKEN)

Examples:
  dag perf
  dag perf --runs 500 --save
  dag perf --hints
  dag perf --publish
`;

function parsePerfArgv(args: readonly string[]): {
  runs: number;
  outputPath: string | undefined;
  save: boolean;
  json: boolean;
  hints: boolean;
  publish: boolean;
} {
  const DEFAULT_RUNS = 100; // eslint-disable-line @typescript-eslint/no-magic-numbers
  let runs = DEFAULT_RUNS;
  let outputPath: string | undefined;
  let save = false;
  let json = false;
  let hints = false;
  let publish = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--runs' && args[i + 1]) {
      runs = parseInt(args[i + 1] ?? String(DEFAULT_RUNS), 10);
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[i + 1];
      i++;
    } else if (args[i] === '--save') {
      save = true;
    } else if (args[i] === '--output-format' && args[i + 1] === 'json') {
      json = true;
      i++;
    } else if (args[i] === '--hints') {
      hints = true;
    } else if (args[i] === '--publish') {
      publish = true;
    }
  }
  return { runs, outputPath, save, json, hints, publish };
}

/* eslint-disable @typescript-eslint/no-magic-numbers */
const P50 = 50;
const P95 = 95;
const P99 = 99;
const ROUND_FACTOR = 100;
const TABLE_WIDE = 62;
const TABLE_LABEL = 22;
const TABLE_COL = 8;
/* eslint-enable @typescript-eslint/no-magic-numbers */

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / ROUND_FACTOR) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

function computeStats(samples: number[]): {
  p50ms: number;
  p95ms: number;
  p99ms: number;
  sampleCount: number;
} {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50ms: Math.round(percentile(sorted, P50) * ROUND_FACTOR) / ROUND_FACTOR,
    p95ms: Math.round(percentile(sorted, P95) * ROUND_FACTOR) / ROUND_FACTOR,
    p99ms: Math.round(percentile(sorted, P99) * ROUND_FACTOR) / ROUND_FACTOR,
    sampleCount: samples.length,
  };
}

function buildLinearDag(
  nodeTypes: string[],
  manifests: ReadonlyArray<{
    nodeType: string;
    defaultInputPort?: string;
    defaultOutputPort?: string;
  }>,
): IDagDefinition {
  const knownTypes = new Map(manifests.map((m) => [m.nodeType, m]));

  const nodes: IDagNode[] = nodeTypes.map((type, idx) => ({
    nodeId: `${type}-${idx}`,
    nodeType: type,
    dependsOn: idx > 0 ? [`${nodeTypes[idx - 1] ?? ''}-${idx - 1}`] : [],
    config: {} as unknown as INodeConfigObject,
    position: { x: idx * 300, y: 0 },
  }));

  const edges: IDagEdgeDefinition[] = [];
  for (let i = 0; i < nodeTypes.length - 1; i++) {
    const fromType = nodeTypes[i] ?? '';
    const toType = nodeTypes[i + 1] ?? '';
    const fromManifest = knownTypes.get(fromType);
    const toManifest = knownTypes.get(toType);
    const fromId = `${fromType}-${i}`;
    const toId = `${toType}-${i + 1}`;
    if (fromManifest?.defaultOutputPort && toManifest?.defaultInputPort) {
      edges.push({
        from: fromId,
        to: toId,
        bindings: [
          {
            outputKey: fromManifest.defaultOutputPort,
            inputKey: toManifest.defaultInputPort,
          },
        ],
      });
    } else {
      edges.push({ from: fromId, to: toId });
    }
  }

  return {
    dagId: `perf-${nodeTypes.length}-node`,
    version: 1,
    status: 'draft' as const,
    nodes,
    edges,
  };
}

async function runPipelineBenchmark(
  dagDef: IDagDefinition,
  input: Record<string, string>,
  runs: number,
): Promise<number[]> {
  const registry = createCliNodeRegistry();
  const samples: number[] = [];

  for (let i = 0; i < runs; i++) {
    const runner = new LocalDagRunner(registry);
    const t0 = performance.now();
    await runner.run(dagDef, input);
    samples.push(performance.now() - t0);
  }
  return samples;
}

function formatPerfTable(result: IPerfResult, io: IDagCliIo): void {
  const sampleCount = Object.values(result.pipelineOverhead)[0]?.sampleCount ?? 0;
  io.write(`dag perf — In-Process Execution Overhead\n`);
  io.write(`${'─'.repeat(TABLE_WIDE)}\n`);
  io.write(`Version: ${result.version}  |  ${result.timestamp}\n`);
  io.write(
    `Node.js: ${result.environment.nodeVersion}  Platform: ${result.environment.platform}\n`,
  );
  io.write(`Runs per scenario: ${sampleCount}\n\n`);

  io.write(`Pipeline Overhead (local nodes only, no API calls)\n`);
  io.write(`${'─'.repeat(TABLE_WIDE)}\n`);
  io.write(
    `${'Scenario'.padEnd(TABLE_LABEL)} ${'p50'.padStart(TABLE_COL)} ${'p95'.padStart(TABLE_COL)} ${'p99'.padStart(TABLE_COL)}\n`,
  );
  io.write(
    `${'─'.repeat(TABLE_LABEL)} ${'─'.repeat(TABLE_COL)} ${'─'.repeat(TABLE_COL)} ${'─'.repeat(TABLE_COL)}\n`,
  );

  for (const [label, stats] of Object.entries(result.pipelineOverhead)) {
    io.write(
      `${label.padEnd(TABLE_LABEL)} ${`${stats.p50ms}ms`.padStart(TABLE_COL)} ${`${stats.p95ms}ms`.padStart(TABLE_COL)} ${`${stats.p99ms}ms`.padStart(TABLE_COL)}\n`,
    );
  }

  io.write(`\nNote: LLM API latency is excluded. Overhead = pure DAG scheduling cost.\n`);
  io.write(`Methodology: ${result.methodology}\n`);
}

function resolveVersion(): string {
  const req = createRequire(import.meta.url);
  const pkg = req('../../package.json') as { version: string };
  return pkg.version;
}

const HINT_THRESHOLD_FAST_MS = 5;
const HINT_THRESHOLD_SLOW_MS = 20;

function printOptimizationHints(result: IPerfResult, io: IDagCliIo): void {
  const entries = Object.entries(result.pipelineOverhead);
  if (entries.length === 0) return;

  io.write(`\n[최적화 힌트]\n`);
  io.write(`${'─'.repeat(TABLE_WIDE)}\n`);

  let hasHint = false;
  for (const [label, stats] of entries) {
    if (stats.p95ms > HINT_THRESHOLD_SLOW_MS) {
      io.write(`⚠ ${label}: p95=${stats.p95ms}ms — 스케줄러 오버헤드가 높습니다.\n`);
      io.write(`   → 노드를 병렬화하거나 pipeline을 단순화하세요.\n`);
      hasHint = true;
    } else if (stats.p50ms < HINT_THRESHOLD_FAST_MS) {
      io.write(`✓ ${label}: p50=${stats.p50ms}ms — 최적 성능 범위입니다.\n`);
      hasHint = true;
    }
  }

  const twoNode = result.pipelineOverhead['2-node-linear'];
  const fiveNode = result.pipelineOverhead['5-node-linear'];
  if (twoNode && fiveNode && fiveNode.p50ms > twoNode.p50ms * 3) {
    // eslint-disable-line @typescript-eslint/no-magic-numbers
    io.write(`⚠ 노드 수에 따라 오버헤드가 비선형적으로 증가합니다.\n`);
    io.write(`   → 단순 pass-through 노드를 제거하거나 merge 노드로 압축하세요.\n`);
    hasHint = true;
  }

  if (!hasHint) {
    io.write(`✓ 모든 시나리오가 정상 범위 내에 있습니다.\n`);
  }
}

const GITHUB_GIST_API_URL = 'https://api.github.com/gists';

async function publishToGist(result: IPerfResult, io: IDagCliIo): Promise<void> {
  const token = process.env['GITHUB_TOKEN'];
  if (!token) {
    io.write(`Error: GITHUB_TOKEN 환경변수가 없습니다. Gist 게시를 건너뜁니다.\n`);
    return;
  }

  const jsonStr = JSON.stringify(result, null, 2);
  const fileName = `dag-perf-${result.version}-${result.timestamp.slice(0, 10)}.json`;

  try {
    const response = await fetch(GITHUB_GIST_API_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        description: `dag perf results — v${result.version} ${result.timestamp.slice(0, 10)}`,
        public: true,
        files: { [fileName]: { content: jsonStr } },
      }),
    });

    if (!response.ok) {
      io.write(`Error: Gist 게시 실패 (HTTP ${response.status})\n`);
      return;
    }

    const gist = (await response.json()) as { html_url: string };
    io.write(`\n✓ 결과가 GitHub Gist에 게시되었습니다:\n`);
    io.write(`  ${gist.html_url}\n`);
  } catch (publishErr) {
    // allow-fallback: network error on publish is non-fatal
    io.write(
      `Error: Gist 게시 중 오류 발생: ${publishErr instanceof Error ? publishErr.message : String(publishErr)}\n`,
    );
  }
}

export async function perfCommand(
  args: readonly string[],
  options: IPerfCommandOptions,
): Promise<number> {
  const { io } = options;

  if (args.includes('--help') || args.includes('-h')) {
    io.write(HELP_TEXT);
    return SUCCESS_EXIT_CODE;
  }

  const { runs, outputPath, save, json: jsonOutput, hints, publish } = parsePerfArgv(args);

  io.write(`Running in-process benchmarks (${runs} iterations each)...\n`);

  const registry = createCliNodeRegistry();
  const assemblyResult = buildNodeDefinitionAssembly(registry);
  if (!assemblyResult.ok) {
    io.write(`Error: Failed to initialize node registry\n`);
    return FAILURE_EXIT_CODE;
  }
  const { manifests } = assemblyResult.value;

  const scenarios: Array<{ label: string; nodeTypes: string[] }> = [
    { label: '2-node-linear', nodeTypes: ['input', 'text-output'] },
    {
      label: '3-node-linear',
      nodeTypes: ['input', 'text-template', 'text-output'],
    },
    {
      label: '5-node-linear',
      nodeTypes: ['input', 'text-template', 'transform', 'text-template', 'text-output'],
    },
  ];

  const pipelineOverhead: IPerfResult['pipelineOverhead'] = {};

  for (const scenario of scenarios) {
    io.write(`  Benchmarking ${scenario.label}...`);
    const dagDef = buildLinearDag(scenario.nodeTypes, manifests);
    const samples = await runPipelineBenchmark(dagDef, { text: 'perf-test' }, runs);
    const stats = computeStats(samples);
    pipelineOverhead[scenario.label] = stats;
    io.write(` p50=${stats.p50ms}ms\n`);
  }

  const version = resolveVersion();

  const result: IPerfResult = {
    version,
    timestamp: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
    },
    nodeOverhead: {},
    pipelineOverhead,
    methodology: `${runs} runs per scenario, no LLM API calls, local in-process execution only`,
  };

  if (jsonOutput || outputPath) {
    const jsonStr = JSON.stringify(result, null, 2);
    if (outputPath) {
      await mkdir(join(outputPath, '..'), { recursive: true });
      await writeFile(outputPath, jsonStr, 'utf8');
      io.write(`\nResults written to: ${outputPath}\n`);
    } else {
      io.write(`\n${jsonStr}\n`);
    }
  } else {
    io.write('\n');
    formatPerfTable(result, io);
  }

  if (hints) {
    printOptimizationHints(result, io);
  }

  if (save) {
    const benchDir = 'benchmarks';
    await mkdir(benchDir, { recursive: true });
    const latest = join(benchDir, 'latest.json');
    const versioned = join(benchDir, `${version}.json`);
    const jsonStr = JSON.stringify(result, null, 2);
    await writeFile(latest, jsonStr, 'utf8');
    await writeFile(versioned, jsonStr, 'utf8');
    io.write(`\nSaved to:\n  ${latest}\n  ${versioned}\n`);
  }

  if (publish) {
    await publishToGist(result, io);
  }

  return SUCCESS_EXIT_CODE;
}
