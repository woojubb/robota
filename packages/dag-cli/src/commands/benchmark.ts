import { writeFile, mkdir, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { IDagDefinition, IDagRobotaCompanion } from '@robota-sdk/dag-core';
import type { IDagCliIo } from '../types.js';
import { FAILURE_EXIT_CODE, USAGE_ERROR_EXIT_CODE, SUCCESS_EXIT_CODE } from '../types.js';
import { createCliFailure } from '../json.js';
import { LocalDagRunner, createCliNodeRegistry } from '../local-runner/index.js';
import type { ILocalRunResult } from '../local-runner/index.js';
import { parseDagMd, DAG_MD_SUFFIX } from '../dag-md-parser/parse-dag-md.js';
import { isWorkflowFileFormat, fromDagWorkflowFile } from '@robota-sdk/dag-builder';

const JSON_INDENT_SPACES = 2;
const OUTPUT_FORMAT_JSON = 'json';
const OUTPUT_FORMAT_PRETTY = 'pretty';
const DEFAULT_RUNS = 5;
const OUTPUT_PREVIEW_CHARS = 120;

// ---------------------------------------------------------------------------
// Cost estimation constants (mirrors run.ts guardrail heuristics)
// ---------------------------------------------------------------------------
const CHARS_PER_TOKEN = 4;
const ESTIMATED_OUTPUT_TOKENS_HEURISTIC = 200;
const NO_API_NODE_TYPES = new Set([
  'input',
  'text-output',
  'text-template',
  'transform',
  'ok-emitter',
  'merge',
  'split',
  'passthrough',
]);

export interface IBenchmarkCommandOptions {
  readonly io: IDagCliIo;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface IParsedBenchmarkOptions {
  readonly file: string;
  readonly runs: number;
  readonly parallel: boolean;
  readonly budgetUsd: number | undefined;
  readonly showOutputs: boolean;
  readonly outputFormat: string;
  readonly inputs: Record<string, string>;
  readonly save: boolean;
  readonly baseline: string | undefined;
}

interface IBenchmarkHistoryEntry {
  date: string;
  runs: number;
  avgMs: number;
  p95Ms: number;
  costUsd: number;
}

interface IBenchmarkHistory {
  file: string;
  history: IBenchmarkHistoryEntry[];
}

type TBenchmarkParseResult =
  | { readonly ok: true; readonly value: IParsedBenchmarkOptions }
  | {
      readonly ok: false;
      readonly exitCode: number;
      readonly message: string;
      readonly isHelp?: boolean;
    };

const BENCHMARK_HELP_TEXT = `Usage: dag benchmark <file> [options]

Run a DAG workflow multiple times and report latency and cost statistics.

Arguments:
  <file>                         Path to a .dag.json or .dag.md workflow file

Options:
  --runs <N>                     Number of runs (default: ${DEFAULT_RUNS})
  --parallel                     Execute runs in parallel (default: sequential)
  --budget <usd>                 Stop early if cumulative cost exceeds this USD amount
  --show-outputs                 Print full output for each run
  --input <key=value>            Input value (repeatable)
  --output <pretty|json>         Output format (default: pretty)
  --save                         Save results to .dag/benchmark-history.json (cumulative trend)
  --baseline <file>              Compare against a saved benchmark JSON file
  --help                         Show this help message

Examples:
  dag benchmark workflow.dag.json --runs 10
  dag benchmark workflow.dag.json --runs 5 --input text="hello"
  dag benchmark workflow.dag.json --runs 20 --output json
`;

function collectStringOptions(
  args: readonly string[],
  optionName: string,
): { readonly values: readonly string[]; readonly remaining: readonly string[] } {
  const values: string[] = [];
  const remaining: string[] = [];
  let i = 0;
  while (i < args.length) {
    const current = args[i];
    if (current === optionName) {
      const next = args[i + 1];
      if (typeof next === 'string' && !next.startsWith('--')) {
        values.push(next);
        i += 2;
        continue;
      }
    }
    remaining.push(current as string);
    i += 1;
  }
  return { values, remaining };
}

function takeSingleOption(
  args: readonly string[],
  optionName: string,
): {
  readonly value: string | undefined;
  readonly remaining: readonly string[];
  readonly error?: string;
} {
  const remaining: string[] = [];
  let value: string | undefined;
  let i = 0;
  while (i < args.length) {
    const current = args[i];
    if (current === optionName) {
      if (value !== undefined) {
        return { value: undefined, remaining, error: `${optionName} can only be provided once.` };
      }
      const next = args[i + 1];
      if (typeof next !== 'string' || next.startsWith('--')) {
        return { value: undefined, remaining, error: `${optionName} requires a value.` };
      }
      value = next;
      i += 2;
      continue;
    }
    remaining.push(current as string);
    i += 1;
  }
  return { value, remaining };
}

function parseBenchmarkArgv(args: readonly string[]): TBenchmarkParseResult {
  const mutableArgs = [...args];

  // --help
  if (mutableArgs.includes('--help')) {
    return { ok: false, exitCode: SUCCESS_EXIT_CODE, message: BENCHMARK_HELP_TEXT, isHelp: true };
  }

  // --parallel flag
  const parallelIdx = mutableArgs.indexOf('--parallel');
  const parallel = parallelIdx !== -1;
  if (parallel) {
    mutableArgs.splice(parallelIdx, 1);
  }

  // --show-outputs flag
  const showOutputsIdx = mutableArgs.indexOf('--show-outputs');
  const showOutputs = showOutputsIdx !== -1;
  if (showOutputs) {
    mutableArgs.splice(mutableArgs.indexOf('--show-outputs'), 1);
  }

  // --runs <N>
  const runsResult = takeSingleOption(mutableArgs, '--runs');
  if (runsResult.error) {
    return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: runsResult.error };
  }
  let runs = DEFAULT_RUNS;
  if (runsResult.value !== undefined) {
    const parsed = Number(runsResult.value);
    if (!Number.isFinite(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: '--runs must be a positive integer.',
      };
    }
    runs = parsed;
  }

  // --budget <usd>
  const budgetResult = takeSingleOption(runsResult.remaining, '--budget');
  if (budgetResult.error) {
    return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: budgetResult.error };
  }
  let budgetUsd: number | undefined;
  if (budgetResult.value !== undefined) {
    const parsed = parseFloat(budgetResult.value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: '--budget must be a non-negative number.',
      };
    }
    budgetUsd = parsed;
  }

  // --output <format>
  const outputResult = takeSingleOption(budgetResult.remaining, '--output');
  if (outputResult.error) {
    return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: outputResult.error };
  }
  const outputFormat = outputResult.value ?? OUTPUT_FORMAT_PRETTY;
  if (outputFormat !== OUTPUT_FORMAT_PRETTY && outputFormat !== OUTPUT_FORMAT_JSON) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `--output must be "json" or "pretty".`,
    };
  }

  // --input key=value (repeatable)
  const inputResult = collectStringOptions(outputResult.remaining, '--input');
  const inputs: Record<string, string> = {};
  for (const pair of inputResult.values) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex <= 0) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: `--input value must be in key=value format, got: "${pair}".`,
      };
    }
    inputs[pair.slice(0, eqIndex)] = pair.slice(eqIndex + 1);
  }

  // --save flag
  const saveArgs = [...inputResult.remaining];
  const saveIdx = saveArgs.indexOf('--save');
  const save = saveIdx !== -1;
  if (save) saveArgs.splice(saveIdx, 1);

  // --baseline <file>
  const baselineResult = takeSingleOption(saveArgs, '--baseline');
  if (baselineResult.error) {
    return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: baselineResult.error };
  }
  const baseline = baselineResult.value;
  const afterBaseline = [...baselineResult.remaining];

  // Positional: file
  const positional = afterBaseline.filter((a) => !a.startsWith('--'));
  const unknownFlags = afterBaseline.filter((a) => a.startsWith('--'));

  if (unknownFlags.length > 0) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `benchmark received unexpected flags: ${unknownFlags.join(' ')}.`,
    };
  }

  const file = positional[0];
  if (!file) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: 'benchmark requires <file> argument (e.g. dag benchmark workflow.dag.json).',
    };
  }
  if (positional.length > 1) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `benchmark received unexpected positional arguments: ${positional.slice(1).join(' ')}.`,
    };
  }

  return {
    ok: true,
    value: { file, runs, parallel, budgetUsd, showOutputs, outputFormat, inputs, save, baseline },
  };
}

// ---------------------------------------------------------------------------
// DAG file loading
// ---------------------------------------------------------------------------

function resolveErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function tryReadCompanion(
  dagFilePath: string,
  io: IDagCliIo,
): Promise<IDagRobotaCompanion | null> {
  const companionPath = dagFilePath.replace(/\.dag\.json$/, '.dag.robota.json');
  if (companionPath === dagFilePath) return null;
  let text: string;
  try {
    // allow-fallback: companion file is optional — file-not-found is the expected case
    text = await io.readTextFile(companionPath);
  } catch (_err) {
    // allow-fallback: companion absent
    return null;
  }
  try {
    // allow-fallback: malformed companion JSON is silently skipped
    return JSON.parse(text) as IDagRobotaCompanion;
  } catch (_parseErr) {
    // allow-fallback: malformed companion
    return null;
  }
}

async function readDagFile(
  filePath: string,
  io: IDagCliIo,
): Promise<
  | { readonly ok: true; readonly value: IDagDefinition }
  | { readonly ok: false; readonly message: string; readonly exitCode: number }
> {
  let text: string;
  try {
    // allow-fallback: I/O error is converted to a structured error result
    text = await io.readTextFile(filePath);
  } catch (readErr) {
    // allow-fallback: file-not-found or permission error
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `Failed to read file "${filePath}": ${resolveErrorMessage(readErr)}`,
    };
  }

  if (filePath.endsWith(DAG_MD_SUFFIX)) {
    const mdResult = parseDagMd(text);
    if (!mdResult.ok) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: `Failed to parse "${filePath}": ${mdResult.error}`,
      };
    }
    return { ok: true, value: mdResult.definition };
  }

  let parsed: unknown;
  try {
    // allow-fallback: JSON parse error is converted to a structured error result
    parsed = JSON.parse(text) as unknown;
  } catch (parseErr) {
    // allow-fallback: malformed JSON
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `Failed to parse JSON from "${filePath}": ${resolveErrorMessage(parseErr)}`,
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `DAG file "${filePath}" must contain a JSON object.`,
    };
  }

  if (isWorkflowFileFormat(parsed)) {
    const companion = await tryReadCompanion(filePath, io);
    return { ok: true, value: fromDagWorkflowFile(parsed, companion ?? undefined) };
  }

  return { ok: true, value: parsed as IDagDefinition };
}

// ---------------------------------------------------------------------------
// Cost estimation (mirrors run.ts heuristics)
// ---------------------------------------------------------------------------

/**
 * Derive the LLM provider from a collapsed `llm-text` node's config (ARCH-PROVIDER-003):
 * the single-provider shorthand (`config.provider`) or the first routing entry
 * (`config.providers[0].provider`). Returns `undefined` when no provider is configured.
 */
function getNodeProvider(node: IDagDefinition['nodes'][0]): string | undefined {
  if (typeof node.config !== 'object' || node.config === null) return undefined;
  const config = node.config as Record<string, unknown>;
  const single = config['provider'];
  if (typeof single === 'string' && single.trim().length > 0) return single.trim();
  const providers = config['providers'];
  if (Array.isArray(providers) && providers.length > 0) {
    const first = providers[0] as Record<string, unknown>;
    if (typeof first['provider'] === 'string' && first['provider'].trim().length > 0) {
      return first['provider'].trim();
    }
  }
  return undefined;
}

function estimateNodeCostUsd(node: IDagDefinition['nodes'][0], inputTextChars: number): number {
  const { nodeType } = node;
  if (NO_API_NODE_TYPES.has(nodeType)) return 0;
  const inputTokens = Math.ceil(inputTextChars / CHARS_PER_TOKEN);
  const model =
    typeof node.config === 'object' &&
    node.config !== null &&
    'model' in node.config &&
    typeof (node.config as Record<string, unknown>)['model'] === 'string'
      ? ((node.config as Record<string, unknown>)['model'] as string)
      : undefined;
  const provider = nodeType === 'llm-text' ? getNodeProvider(node) : undefined;

  if (provider === 'anthropic') {
    const modelStr = model ?? 'claude-haiku-4-5';
    const isSonnet =
      modelStr.includes('sonnet') || modelStr.includes('claude-3') || modelStr.includes('opus');
    const inRate = isSonnet ? 0.003 : 0.00025;
    const outRate = isSonnet ? 0.015 : 0.00125;
    return (inputTokens / 1000) * inRate + (ESTIMATED_OUTPUT_TOKENS_HEURISTIC / 1000) * outRate;
  }
  if (provider === 'openai') {
    const modelStr = model ?? 'gpt-4o-mini';
    const isGpt4o = modelStr.includes('gpt-4o') && !modelStr.includes('mini');
    const inRate = isGpt4o ? 0.005 : 0.00015;
    const outRate = isGpt4o ? 0.015 : 0.0006;
    return (inputTokens / 1000) * inRate + (ESTIMATED_OUTPUT_TOKENS_HEURISTIC / 1000) * outRate;
  }
  if (provider === 'gemini') {
    const modelStr = model ?? 'gemini-1.5-flash';
    const isPro = modelStr.includes('pro');
    const inRate = isPro ? 0.00125 : 0.000075;
    const outRate = isPro ? 0.005 : 0.0003;
    return (inputTokens / 1000) * inRate + (ESTIMATED_OUTPUT_TOKENS_HEURISTIC / 1000) * outRate;
  }
  return 0.001;
}

function estimateDagRunCostUsd(
  dagDefinition: IDagDefinition,
  inputs: Record<string, string>,
): number {
  const inputTextChars = Object.values(inputs).reduce((sum, v) => sum + v.length, 0);
  return dagDefinition.nodes.reduce(
    (sum, node) => sum + estimateNodeCostUsd(node, inputTextChars),
    0,
  );
}

// ---------------------------------------------------------------------------
// Output extraction
// ---------------------------------------------------------------------------

function extractOutputText(result: ILocalRunResult): string {
  const parts: string[] = [];
  for (const taskRun of result.taskRuns) {
    if (!taskRun.outputSnapshot) continue;
    let parsed: unknown;
    try {
      // allow-fallback: malformed outputSnapshot is advisory; skipped gracefully
      parsed = JSON.parse(taskRun.outputSnapshot) as unknown;
    } catch (_e) {
      // allow-fallback: malformed snapshot
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    for (const val of Object.values(parsed as Record<string, unknown>)) {
      if (typeof val === 'string') parts.push(val);
    }
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

interface IRunSample {
  readonly index: number;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly costUsd: number;
  readonly outputLength: number;
  readonly outputText: string;
}

interface IBenchmarkStats {
  readonly latencyAvgMs: number;
  readonly latencyMinMs: number;
  readonly latencyMaxMs: number;
  readonly latencyP95Ms: number;
  readonly costAvgUsd: number;
  readonly costMinUsd: number;
  readonly costMaxUsd: number;
  readonly costTotalUsd: number;
  readonly successCount: number;
  readonly totalCount: number;
  readonly outputLengthAvg: number;
  readonly outputLengthMin: number;
  readonly outputLengthMax: number;
}

function computeStats(samples: readonly IRunSample[]): IBenchmarkStats {
  const totalCount = samples.length;
  const successful = samples.filter((s) => s.ok);
  const successCount = successful.length;

  const durations = successful.map((s) => s.durationMs).sort((a, b) => a - b);
  const costs = successful.map((s) => s.costUsd);
  const lengths = successful.map((s) => s.outputLength);

  const avg = (arr: number[]): number =>
    arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
  const minVal = (arr: number[]): number => (arr.length === 0 ? 0 : Math.min(...arr));
  const maxVal = (arr: number[]): number => (arr.length === 0 ? 0 : Math.max(...arr));
  const p95 = (sorted: number[]): number => {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil(0.95 * sorted.length) - 1;
    return sorted[Math.max(0, idx)] ?? 0;
  };

  return {
    latencyAvgMs: avg(durations),
    latencyMinMs: minVal(durations),
    latencyMaxMs: maxVal(durations),
    latencyP95Ms: p95(durations),
    costAvgUsd: avg(costs),
    costMinUsd: minVal(costs),
    costMaxUsd: maxVal(costs),
    costTotalUsd: costs.reduce((a, b) => a + b, 0),
    successCount,
    totalCount,
    outputLengthAvg: avg(lengths),
    outputLengthMin: minVal(lengths),
    outputLengthMax: maxVal(lengths),
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function fmtUsd(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

function formatPrettyBenchmarkOutput(
  file: string,
  samples: readonly IRunSample[],
  stats: IBenchmarkStats,
  showOutputs: boolean,
  io: IDagCliIo,
): void {
  io.write('\n');

  const divider = '─'.repeat(53);
  io.write(`Benchmark Results: ${file} (${stats.totalCount} runs)\n`);
  io.write(`${divider}\n\n`);

  io.write('Latency\n');
  io.write(
    `  avg:  ${fmtMs(stats.latencyAvgMs).padEnd(8)}` +
      `min: ${fmtMs(stats.latencyMinMs).padEnd(8)}` +
      `max: ${fmtMs(stats.latencyMaxMs).padEnd(8)}` +
      `p95: ${fmtMs(stats.latencyP95Ms)}\n`,
  );
  io.write('\n');

  io.write('Cost\n');
  io.write(
    `  avg:  ${fmtUsd(stats.costAvgUsd).padEnd(10)}` +
      `min: ${fmtUsd(stats.costMinUsd).padEnd(10)}` +
      `max: ${fmtUsd(stats.costMaxUsd).padEnd(10)}` +
      `total: ${fmtUsd(stats.costTotalUsd)}\n`,
  );
  io.write('\n');

  const pct = stats.totalCount > 0 ? Math.round((stats.successCount / stats.totalCount) * 100) : 0;
  io.write(`Success rate: ${stats.successCount}/${stats.totalCount} (${pct}%)\n`);
  io.write('\n');

  if (stats.successCount > 0) {
    io.write('Output length (chars)\n');
    io.write(
      `  avg:  ${String(Math.round(stats.outputLengthAvg)).padEnd(8)}` +
        `min: ${String(stats.outputLengthMin).padEnd(8)}` +
        `max: ${stats.outputLengthMax}\n`,
    );
    io.write('\n');
  }

  if (showOutputs) {
    io.write('Run Outputs\n');
    for (const s of samples) {
      if (!s.ok) continue;
      const preview = s.outputText.slice(0, OUTPUT_PREVIEW_CHARS);
      const ellipsis = s.outputText.length > OUTPUT_PREVIEW_CHARS ? '...' : '';
      io.write(`  [${s.index}] ${preview}${ellipsis}\n`);
    }
    io.write('\n');
  }

  const tipRuns = Math.max(20, stats.totalCount * 2);
  io.write(`Tip: Use 'dag benchmark --runs ${tipRuns}' for more reliable statistics.\n`);
}

function formatJsonBenchmarkOutput(
  file: string,
  samples: readonly IRunSample[],
  stats: IBenchmarkStats,
  io: IDagCliIo,
): void {
  const output = {
    ok: true,
    file,
    runs: {
      total: stats.totalCount,
      success: stats.successCount,
      failed: stats.totalCount - stats.successCount,
    },
    latencyMs: {
      avg: Math.round(stats.latencyAvgMs),
      min: stats.latencyMinMs,
      max: stats.latencyMaxMs,
      p95: stats.latencyP95Ms,
    },
    costUsd: {
      avg: stats.costAvgUsd,
      min: stats.costMinUsd,
      max: stats.costMaxUsd,
      total: stats.costTotalUsd,
    },
    outputLength: {
      avg: Math.round(stats.outputLengthAvg),
      min: stats.outputLengthMin,
      max: stats.outputLengthMax,
    },
    samples: samples.map((s) => ({
      index: s.index,
      ok: s.ok,
      durationMs: s.durationMs,
      costUsd: s.costUsd,
      outputLength: s.outputLength,
    })),
  };
  io.write(`${JSON.stringify(output, null, JSON_INDENT_SPACES)}\n`);
}

// ---------------------------------------------------------------------------
// Command entry point
// ---------------------------------------------------------------------------

/**
 * Execute the `dag benchmark <file>` subcommand (ECO-011).
 *
 * @param args - The argv slice starting after the `benchmark` keyword.
 * @param options - IO abstraction.
 * @returns Exit code (0 = success, 1 = execution failure, 2 = usage error).
 */
export async function benchmarkCommand(
  args: readonly string[],
  options: IBenchmarkCommandOptions,
): Promise<number> {
  const { io } = options;

  const parseResult = parseBenchmarkArgv(args);
  if (!parseResult.ok) {
    if (parseResult.isHelp === true) {
      io.write(parseResult.message);
      return parseResult.exitCode;
    }
    const failure = createCliFailure('DAG_CLI_USAGE_ERROR', parseResult.message);
    io.write(`${JSON.stringify(failure, null, JSON_INDENT_SPACES)}\n`);
    return parseResult.exitCode;
  }

  const { file, runs, parallel, budgetUsd, showOutputs, outputFormat, inputs, save, baseline } =
    parseResult.value;

  const dagFileResult = await readDagFile(file, io);
  if (!dagFileResult.ok) {
    const failure = createCliFailure('DAG_CLI_USAGE_ERROR', dagFileResult.message);
    io.write(`${JSON.stringify(failure, null, JSON_INDENT_SPACES)}\n`);
    return dagFileResult.exitCode;
  }

  const dagDefinition = dagFileResult.value;
  const perRunCostUsd = estimateDagRunCostUsd(dagDefinition, inputs);
  const inputPayload: Record<string, string> = { ...inputs };

  if (outputFormat === OUTPUT_FORMAT_PRETTY) {
    io.write(`Benchmarking ${file} (${runs} runs)...\n`);
  }

  const samples: IRunSample[] = [];
  let cumulativeCostUsd = 0;

  const executeRun = async (index: number): Promise<IRunSample> => {
    const runner = new LocalDagRunner(createCliNodeRegistry());
    const startMs = Date.now();
    let result: ILocalRunResult | null = null;
    let ok = false;

    try {
      // allow-fallback: individual benchmark run failure is captured as a failed sample
      result = await runner.run(dagDefinition, inputPayload);
      ok = result.dagRun.status === 'success';
    } catch (_runErr) {
      // allow-fallback: run error is recorded as a failed sample
      ok = false;
    }

    const durationMs = Date.now() - startMs;
    const outputText = result !== null ? extractOutputText(result) : '';
    const outputLength = outputText.length;

    return { index, ok, durationMs, costUsd: perRunCostUsd, outputLength, outputText };
  };

  if (parallel) {
    // Parallel mode: launch all runs simultaneously.
    const runPromises = Array.from({ length: runs }, (_, i) => executeRun(i + 1));
    const results = await Promise.all(runPromises);
    for (const sample of results) {
      samples.push(sample);
      cumulativeCostUsd += sample.costUsd;
      if (outputFormat === OUTPUT_FORMAT_PRETTY) {
        const icon = sample.ok ? '✓' : '✗';
        const dStr = fmtMs(sample.durationMs);
        const cStr = fmtUsd(sample.costUsd);
        io.write(`[${sample.index}/${runs}] ${icon} ${dStr.padEnd(8)} ${cStr}\n`);
      }
    }
  } else {
    // Sequential mode: run one at a time.
    for (let i = 1; i <= runs; i++) {
      // Budget check before each run.
      if (budgetUsd !== undefined && cumulativeCostUsd + perRunCostUsd > budgetUsd) {
        if (outputFormat === OUTPUT_FORMAT_PRETTY) {
          io.write(
            `\nBudget limit reached (~$${cumulativeCostUsd.toFixed(4)} of $${budgetUsd.toFixed(2)}). Stopping after ${samples.length} run(s).\n`,
          );
        }
        break;
      }

      const sample = await executeRun(i);
      samples.push(sample);
      cumulativeCostUsd += sample.costUsd;

      if (outputFormat === OUTPUT_FORMAT_PRETTY) {
        const icon = sample.ok ? '✓' : '✗';
        const dStr = fmtMs(sample.durationMs);
        const cStr = fmtUsd(sample.costUsd);
        io.write(`[${i}/${runs}] ${icon} ${dStr.padEnd(8)} ${cStr}\n`);
      }
    }
  }

  if (samples.length === 0) {
    if (outputFormat === OUTPUT_FORMAT_PRETTY) {
      io.write('No runs completed.\n');
    }
    return FAILURE_EXIT_CODE;
  }

  const stats = computeStats(samples);

  if (outputFormat === OUTPUT_FORMAT_JSON) {
    formatJsonBenchmarkOutput(file, samples, stats, io);
  } else {
    formatPrettyBenchmarkOutput(file, samples, stats, showOutputs, io);
  }

  // --baseline: compare current stats against saved baseline
  if (baseline !== undefined) {
    await printBaselineComparison(baseline, stats, io);
  }

  // --save: append entry to .dag/benchmark-history.json and show trend
  if (save) {
    await saveBenchmarkHistory(file, runs, stats, io);
  }

  return stats.successCount > 0 ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE;
}

const HISTORY_FILE = join('.dag', 'benchmark-history.json');
const MAX_TREND_ENTRIES = 3; // eslint-disable-line @typescript-eslint/no-magic-numbers

async function loadHistory(file: string): Promise<IBenchmarkHistory> {
  try {
    const text = await readFile(HISTORY_FILE, 'utf8');
    const parsed = JSON.parse(text) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'file' in parsed &&
      'history' in parsed &&
      Array.isArray((parsed as IBenchmarkHistory).history)
    ) {
      return parsed as IBenchmarkHistory;
    }
  } catch (_err) {
    // allow-fallback: missing or corrupt history file starts fresh
    // no-op: start fresh
    void _err;
  }
  return { file, history: [] };
}

async function saveBenchmarkHistory(
  file: string,
  runs: number,
  stats: IBenchmarkStats,
  io: IDagCliIo,
): Promise<void> {
  const history = await loadHistory(file);
  const entry: IBenchmarkHistoryEntry = {
    date: new Date().toISOString(),
    runs,
    avgMs: Math.round(stats.latencyAvgMs),
    p95Ms: stats.latencyP95Ms,
    costUsd: stats.costAvgUsd,
  };
  const updated: IBenchmarkHistory = { file, history: [...history.history, entry] };
  await mkdir('.dag', { recursive: true });
  await writeFile(HISTORY_FILE, JSON.stringify(updated, null, JSON_INDENT_SPACES) + '\n', 'utf8');

  const count = updated.history.length;
  io.write(`\nSaved to ${HISTORY_FILE} (${count} ${count === 1 ? 'entry' : 'entries'})\n`);

  const recent = updated.history.slice(-MAX_TREND_ENTRIES).reverse();
  if (recent.length > 1) {
    io.write(`\n트렌드:\n`);
    for (let i = 0; i < recent.length; i++) {
      const e = recent[i];
      if (!e) continue;
      const dateStr = e.date.slice(0, 10);
      const prev = recent[i + 1];
      const diff = prev !== undefined ? e.avgMs - prev.avgMs : 0;
      const arrow = diff < 0 ? `↓ ${Math.abs(diff)}ms` : diff > 0 ? `↑ ${diff}ms` : '';
      const vsStr = prev !== undefined && diff !== 0 ? ` (${arrow} vs 이전)` : '';
      io.write(`  ${dateStr} avg ${e.avgMs}ms${vsStr}\n`);
    }
  }
}

async function printBaselineComparison(
  baselinePath: string,
  current: IBenchmarkStats,
  io: IDagCliIo,
): Promise<void> {
  let baselineText: string;
  try {
    baselineText = await readFile(baselinePath, 'utf8');
  } catch (readErr) {
    // allow-fallback: missing baseline file reports an error and continues
    io.write(`⚠ baseline 파일을 읽을 수 없습니다: ${baselinePath}\n`);
    void readErr;
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(baselineText);
  } catch (_parseErr) {
    // allow-fallback: malformed baseline JSON reports an error and continues
    io.write(`⚠ baseline 파일 파싱 실패: ${baselinePath}\n`);
    void _parseErr;
    return;
  }

  if (typeof parsed !== 'object' || parsed === null || !('latencyMs' in parsed)) {
    io.write(`⚠ baseline 파일 형식이 올바르지 않습니다: ${baselinePath}\n`);
    return;
  }

  const base = parsed as { latencyMs: { avg: number; p95: number }; costUsd: { avg: number } };
  const latencyDiff = Math.round(current.latencyAvgMs) - base.latencyMs.avg;
  const costDiff = current.costAvgUsd - base.costUsd.avg;
  const latencyArrow = latencyDiff > 0 ? '↑' : latencyDiff < 0 ? '↓' : '=';
  const DIVIDER = '──────────────────────────────────────';

  io.write(`\n[Baseline 비교: ${baselinePath}]\n`);
  io.write(`${DIVIDER}\n`);
  io.write(
    `지연 시간 (avg): ${Math.round(current.latencyAvgMs)}ms ${latencyArrow} ${latencyDiff > 0 ? '+' : ''}${latencyDiff}ms\n`,
  );
  io.write(
    `비용 (avg): ${current.costAvgUsd.toFixed(6)} USD ${costDiff > 0 ? '(+비용 증가)' : costDiff < 0 ? '(비용 감소)' : ''}\n`,
  );
  if (latencyDiff > 0) {
    io.write(`⚠ 성능 회귀 감지: baseline 대비 ${latencyDiff}ms 느림\n`);
  } else if (latencyDiff < 0) {
    io.write(`✓ 성능 개선: baseline 대비 ${Math.abs(latencyDiff)}ms 빠름\n`);
  }
  io.write(`${DIVIDER}\n`);
}
