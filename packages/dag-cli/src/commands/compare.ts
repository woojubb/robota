import type { IDagDefinition, TPortPayload } from '@robota-sdk/dag-core';
import type { IDagCliIo } from '../types.js';
import { USAGE_ERROR_EXIT_CODE, SUCCESS_EXIT_CODE, FAILURE_EXIT_CODE } from '../types.js';
import { createCliNodeRegistry } from '../local-runner/index.js';
import { LocalDagRunner } from '../local-runner/local-dag-runner.js';

const JSON_INDENT_SPACES = 2;
const OUTPUT_FORMAT_JSON = 'json';
const OUTPUT_FORMAT_PRETTY = 'pretty';

/** Map provider name → nodeType */
const PROVIDER_NODE_TYPE: Readonly<Record<string, string>> = {
  anthropic: 'llm-text-anthropic',
  openai: 'llm-text-openai',
  gemini: 'llm-text-gemini',
  deepseek: 'llm-text-deepseek',
  qwen: 'llm-text-qwen',
} as const;

export interface ICompareCommandOptions {
  readonly io: IDagCliIo;
}

interface IParsedCompareOptions {
  readonly providerA: string;
  readonly providerB: string;
  readonly pipeline: string | undefined;
  readonly inputs: Record<string, string>;
  readonly outputFormat: string;
  readonly decide: boolean;
}

type TParseResult =
  | { readonly ok: true; readonly value: IParsedCompareOptions }
  | { readonly ok: false; readonly exitCode: number; readonly message: string };

function resolveErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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

function parseCompareArgv(args: readonly string[]): TParseResult {
  let mutableArgs = [...args];

  // --output <format>
  const outputResult = takeSingleOption(mutableArgs, '--output');
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
  mutableArgs = [...outputResult.remaining];

  // --pipeline <string>
  const pipelineResult = takeSingleOption(mutableArgs, '--pipeline');
  if (pipelineResult.error) {
    return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: pipelineResult.error };
  }
  const pipeline = pipelineResult.value;
  mutableArgs = [...pipelineResult.remaining];

  // --input key=value (repeatable)
  const inputResult = collectStringOptions(mutableArgs, '--input');
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
  mutableArgs = [...inputResult.remaining];

  // --decide flag
  const decideIdx = mutableArgs.indexOf('--decide');
  const decide = decideIdx !== -1;
  if (decide) mutableArgs.splice(decideIdx, 1);

  // Unknown flags
  const unknownFlags = mutableArgs.filter((a) => a.startsWith('--'));
  if (unknownFlags.length > 0) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `compare received unexpected flags: ${unknownFlags.join(' ')}.`,
    };
  }

  // Positional: provider-a provider-b
  const positional = mutableArgs.filter((a) => !a.startsWith('--'));
  if (positional.length < 2) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message:
        'compare requires two provider arguments (e.g. dag compare anthropic openai).\n\nUsage:\n  dag compare <provider-a> <provider-b> [--pipeline "..."] [--input key=value] [--output json|pretty]\n\nAvailable providers: anthropic, openai, gemini, deepseek, qwen',
    };
  }
  if (positional.length > 2) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `compare received unexpected positional arguments: ${positional.slice(2).join(' ')}.`,
    };
  }

  const providerA = positional[0] as string;
  const providerB = positional[1] as string;

  for (const provider of [providerA, providerB]) {
    if (!(provider in PROVIDER_NODE_TYPE)) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: `Unknown provider "${provider}". Available providers: ${Object.keys(PROVIDER_NODE_TYPE).join(', ')}.`,
      };
    }
  }

  return {
    ok: true,
    value: { providerA, providerB, pipeline, inputs, outputFormat, decide },
  };
}

/**
 * Build a minimal linear DAG definition for a single LLM provider.
 * Parses the --pipeline string with {provider} placeholder, replacing with actual provider.
 */
function buildProviderDag(
  provider: string,
  pipelineStr: string | undefined,
  inputs: Record<string, string>,
): IDagDefinition {
  const nodeType = PROVIDER_NODE_TYPE[provider] ?? `llm-text-${provider}`;
  const llmNodeId = `llm-${provider}`;

  // Default pipeline: input → llm → text-output
  if (!pipelineStr) {
    return {
      dagId: `compare-${provider}`,
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
        { nodeId: llmNodeId, nodeType, dependsOn: ['input'], config: {} },
        { nodeId: 'output', nodeType: 'text-output', dependsOn: [llmNodeId], config: {} },
      ],
      edges: [
        { from: 'input', to: llmNodeId },
        { from: llmNodeId, to: 'output' },
      ],
    };
  }

  // Parse pipeline string "input | llm-text-{provider} | text-output"
  const stages = pipelineStr
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/\{provider\}/g, provider));

  // Build nodes with sequential dependsOn
  const nodeIds = stages.map((s, i) => {
    // Use the stage as nodeType; also derive a nodeId
    return `node-${i}-${s.replace(/[^a-z0-9]/gi, '-')}`;
  });

  const nodes = stages.map((stage, i) => ({
    nodeId: nodeIds[i] as string,
    nodeType: stage,
    dependsOn: i === 0 ? [] : [nodeIds[i - 1] as string],
    config: {},
  }));

  const edges = stages.slice(0, -1).map((_, i) => ({
    from: nodeIds[i] as string,
    to: nodeIds[i + 1] as string,
  }));

  return {
    dagId: `compare-${provider}`,
    version: 1,
    status: 'draft',
    nodes,
    edges,
  };
}

interface IRunOutcome {
  readonly provider: string;
  readonly ok: boolean;
  readonly output: string;
  readonly latencyMs: number;
  readonly estimatedCostUsd: number;
  readonly error?: string;
  readonly skipped: boolean;
  readonly skipReason?: string;
}

function hasApiKey(provider: string): boolean {
  const envMap: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    gemini: 'GEMINI_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    qwen: 'QWEN_API_KEY',
  };
  const envVar = envMap[provider];
  if (!envVar) return false;
  const val = process.env[envVar];
  return typeof val === 'string' && val.trim().length > 0;
}

async function runProvider(
  provider: string,
  pipeline: string | undefined,
  inputs: Record<string, string>,
): Promise<IRunOutcome> {
  if (!hasApiKey(provider)) {
    return {
      provider,
      ok: false,
      output: '',
      latencyMs: 0,
      estimatedCostUsd: 0,
      skipped: true,
      skipReason: `No API key found (expected ${provider.toUpperCase()}_API_KEY or similar)`,
    };
  }

  const dag = buildProviderDag(provider, pipeline, inputs);
  const nodeDefinitions = createCliNodeRegistry();
  let runner: LocalDagRunner;
  try {
    runner = new LocalDagRunner(nodeDefinitions);
  } catch (err) {
    // allow-fallback: runner creation failure is returned as a structured error result
    return {
      provider,
      ok: false,
      output: '',
      latencyMs: 0,
      estimatedCostUsd: 0,
      skipped: false,
      error: `Failed to create runner: ${resolveErrorMessage(err)}`,
    };
  }

  const startMs = Date.now();
  try {
    const portPayload: TPortPayload = {};
    for (const [key, value] of Object.entries(inputs)) {
      portPayload[key] = value;
    }
    if (Object.keys(portPayload).length === 0) {
      portPayload['text'] = '';
    }

    const result = await runner.run(dag, portPayload);
    const latencyMs = Date.now() - startMs;

    // Extract output text from task runs
    let outputText = '';
    for (const taskRun of result.taskRuns) {
      const outputPayload = (taskRun as { outputPayload?: Record<string, unknown> }).outputPayload;
      if (outputPayload && typeof outputPayload === 'object') {
        for (const val of Object.values(outputPayload)) {
          if (
            typeof val === 'object' &&
            val !== null &&
            'value' in val &&
            typeof (val as { value: unknown }).value === 'string'
          ) {
            outputText = (val as { value: string }).value;
          }
        }
      }
    }

    // Rough cost estimate: assume haiku/gpt4o-mini level for comparison
    const inputChars = Object.values(inputs).reduce((s, v) => s + v.length, 0);
    const inputTokens = Math.ceil(inputChars / 4);
    const costPerInputK =
      provider === 'anthropic'
        ? 0.00025
        : provider === 'openai'
          ? 0.00015
          : provider === 'gemini'
            ? 0.000075
            : 0.0001;
    const costPerOutputK =
      provider === 'anthropic'
        ? 0.00125
        : provider === 'openai'
          ? 0.0006
          : provider === 'gemini'
            ? 0.0003
            : 0.0005;
    const estimatedCostUsd = (inputTokens / 1000) * costPerInputK + (200 / 1000) * costPerOutputK;

    return {
      provider,
      ok: result.dagRun.status === 'success',
      output: outputText,
      latencyMs,
      estimatedCostUsd,
      skipped: false,
      error:
        result.dagRun.status !== 'success'
          ? `Run ended with status: ${result.dagRun.status}`
          : undefined,
    };
  } catch (err) {
    // allow-fallback: run error is returned as a structured failed outcome
    const latencyMs = Date.now() - startMs;
    return {
      provider,
      ok: false,
      output: '',
      latencyMs,
      estimatedCostUsd: 0,
      skipped: false,
      error: resolveErrorMessage(err),
    };
  }
}

interface IDecisionResult {
  readonly speedWinner: string;
  readonly speedPct: number;
  readonly speedA: number;
  readonly speedB: number;
  readonly costWinner: string;
  readonly costPct: number;
  readonly costA: number;
  readonly costB: number;
  readonly recommendation: string;
  readonly runCommand: string;
}

function buildDecision(
  outcomes: readonly IRunOutcome[],
  pipeline: string | undefined,
): IDecisionResult | null {
  const runnable = outcomes.filter((o) => !o.skipped && o.ok);
  if (runnable.length < 2) return null;

  const [a, b] = runnable as [IRunOutcome, IRunOutcome];

  const fasterWinner = a.latencyMs <= b.latencyMs ? a : b;
  const slowerOne = fasterWinner === a ? b : a;
  const latPct =
    slowerOne.latencyMs > 0
      ? Math.round(((slowerOne.latencyMs - fasterWinner.latencyMs) / slowerOne.latencyMs) * 100)
      : 0;

  const cheaperWinner = a.estimatedCostUsd <= b.estimatedCostUsd ? a : b;
  const expensiveOne = cheaperWinner === a ? b : a;
  const costPct =
    expensiveOne.estimatedCostUsd > 0
      ? Math.round(
          ((expensiveOne.estimatedCostUsd - cheaperWinner.estimatedCostUsd) /
            expensiveOne.estimatedCostUsd) *
            100,
        )
      : 0;

  // Recommendation: prefer provider that wins both; if split, go by cost
  const recommendation =
    fasterWinner.provider === cheaperWinner.provider
      ? cheaperWinner.provider
      : cheaperWinner.provider; // cost-first tiebreak

  const pipelineStr = pipeline
    ? pipeline.replace(/\{provider\}/g, recommendation)
    : `input | llm-text-${recommendation} | text-output`;

  return {
    speedWinner: fasterWinner.provider,
    speedPct: latPct,
    speedA: a.latencyMs,
    speedB: b.latencyMs,
    costWinner: cheaperWinner.provider,
    costPct,
    costA: a.estimatedCostUsd,
    costB: b.estimatedCostUsd,
    recommendation,
    runCommand: `dag run --pipeline "${pipelineStr}" --input text="..."`,
  };
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + '...';
}

function formatCost(usd: number): string {
  if (usd < 0.001) return `$${usd.toFixed(5)}`;
  return `$${usd.toFixed(4)}`;
}

function formatLatency(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatPrettyCompare(
  outcomes: readonly IRunOutcome[],
  inputs: Record<string, string>,
  io: IDagCliIo,
  decide: boolean,
  pipeline: string | undefined,
): void {
  const [a, b] = outcomes as [IRunOutcome, IRunOutcome];
  const promptStr = Object.values(inputs).join(' ').trim().slice(0, 60) || '(no input provided)';

  io.write(`\nComparing: ${a.provider} vs ${b.provider}\n`);
  io.write(`Prompt: "${truncate(promptStr, 60)}"\n\n`);

  // Box drawing
  const COL_PROVIDER = 13;
  const COL_COST = 10;
  const COL_LATENCY = 9;
  const COL_OUTPUT = 33;

  const topBorder = `┌${'─'.repeat(COL_PROVIDER)}┬${'─'.repeat(COL_COST)}┬${'─'.repeat(COL_LATENCY)}┬${'─'.repeat(COL_OUTPUT)}┐`;
  const headerRow = `│ ${'Provider'.padEnd(COL_PROVIDER - 2)} │ ${'Cost'.padEnd(COL_COST - 2)} │ ${'Latency'.padEnd(COL_LATENCY - 2)} │ ${'Output (first 30 chars)'.padEnd(COL_OUTPUT - 2)} │`;
  const midBorder = `├${'─'.repeat(COL_PROVIDER)}┼${'─'.repeat(COL_COST)}┼${'─'.repeat(COL_LATENCY)}┼${'─'.repeat(COL_OUTPUT)}┤`;
  const botBorder = `└${'─'.repeat(COL_PROVIDER)}┴${'─'.repeat(COL_COST)}┴${'─'.repeat(COL_LATENCY)}┴${'─'.repeat(COL_OUTPUT)}┘`;

  io.write(`${topBorder}\n`);
  io.write(`${headerRow}\n`);
  io.write(`${midBorder}\n`);

  for (const outcome of outcomes) {
    let costCell: string;
    let latencyCell: string;
    let outputCell: string;

    if (outcome.skipped) {
      costCell = 'skipped';
      latencyCell = '-';
      outputCell = outcome.skipReason ?? 'No API key';
    } else if (!outcome.ok) {
      costCell = 'error';
      latencyCell = formatLatency(outcome.latencyMs);
      outputCell = truncate(outcome.error ?? 'failed', 30);
    } else {
      costCell = formatCost(outcome.estimatedCostUsd);
      latencyCell = formatLatency(outcome.latencyMs);
      outputCell = `"${truncate(outcome.output.replace(/\n/g, ' '), 28)}"`;
    }

    const row = `│ ${outcome.provider.padEnd(COL_PROVIDER - 2)} │ ${costCell.padEnd(COL_COST - 2)} │ ${latencyCell.padEnd(COL_LATENCY - 2)} │ ${outputCell.padEnd(COL_OUTPUT - 2)} │`;
    io.write(`${row}\n`);
  }

  io.write(`${botBorder}\n\n`);

  // Winner analysis
  const runnable = outcomes.filter((o) => !o.skipped && o.ok);
  if (runnable.length === 2) {
    const [first, second] = runnable as [IRunOutcome, IRunOutcome];
    const cheaperWinner = first.estimatedCostUsd <= second.estimatedCostUsd ? first : second;
    const fasterWinner = first.latencyMs <= second.latencyMs ? first : second;
    const expensive = cheaperWinner === first ? second : first;
    const slower = fasterWinner === first ? second : first;

    const costPct =
      expensive.estimatedCostUsd > 0
        ? Math.round(
            ((expensive.estimatedCostUsd - cheaperWinner.estimatedCostUsd) /
              expensive.estimatedCostUsd) *
              100,
          )
        : 0;
    const latPct =
      slower.latencyMs > 0
        ? Math.round(((slower.latencyMs - fasterWinner.latencyMs) / slower.latencyMs) * 100)
        : 0;

    io.write(`Winner by cost:    ${cheaperWinner.provider} (${costPct}% cheaper)\n`);
    io.write(`Winner by latency: ${fasterWinner.provider} (${latPct}% faster)\n`);
  } else if (runnable.length === 1) {
    io.write(
      `Only ${runnable[0]!.provider} produced a result (other provider was skipped or errored).\n`,
    );
  } else {
    const skipped = outcomes.filter((o) => o.skipped);
    if (skipped.length > 0) {
      io.write(`Note: ${skipped.map((s) => s.provider).join(', ')} skipped — no API key found.\n`);
    } else {
      io.write(`Both providers encountered errors.\n`);
    }
  }

  const skipped = outcomes.filter((o) => o.skipped);
  if (skipped.length > 0) {
    io.write(`\n`);
    for (const s of skipped) {
      io.write(`Note: ${s.provider} — ${s.skipReason}\n`);
    }
  }

  io.write(`\n`);

  // --decide section
  if (decide) {
    const decision = buildDecision(outcomes, pipeline);
    if (decision !== null) {
      const DECIDE_DIVIDER = '──────────────────────────────────────';
      io.write(`[추천]\n`);
      io.write(`${DECIDE_DIVIDER}\n`);
      io.write(
        `속도 우선: ${decision.speedWinner} (${formatLatency(decision.speedA)} vs ${formatLatency(decision.speedB)} — ${decision.speedPct}% 빠름)\n`,
      );
      io.write(
        `비용 우선: ${decision.costWinner} (${formatCost(decision.costA)} vs ${formatCost(decision.costB)} — ${decision.costPct}% 저렴)\n`,
      );
      io.write(`           → ${decision.recommendation} 사용을 권장합니다\n`);
      io.write(`\n`);
      io.write(`바로 실행:\n`);
      io.write(`  ${decision.runCommand}\n`);
      io.write(`${DECIDE_DIVIDER}\n`);
    }
  }
}

function formatJsonCompare(
  outcomes: readonly IRunOutcome[],
  inputs: Record<string, string>,
  io: IDagCliIo,
  decide: boolean,
  pipeline: string | undefined,
): void {
  const decisionObj = decide ? buildDecision(outcomes, pipeline) : null;
  const output: Record<string, unknown> = {
    ok: true,
    inputs,
    results: outcomes.map((o) => ({
      provider: o.provider,
      skipped: o.skipped,
      skipReason: o.skipReason,
      ok: o.ok,
      latencyMs: o.latencyMs,
      estimatedCostUsd: o.estimatedCostUsd,
      output: o.output,
      error: o.error,
    })),
  };
  if (decisionObj !== null) {
    output['decision'] = {
      speedWinner: decisionObj.speedWinner,
      costWinner: decisionObj.costWinner,
      recommendation: decisionObj.recommendation,
      runCommand: decisionObj.runCommand,
    };
  }
  io.write(`${JSON.stringify(output, null, JSON_INDENT_SPACES)}\n`);
}

/**
 * Execute the `dag compare <provider-a> <provider-b>` command.
 *
 * Runs the same pipeline with two different LLM providers and compares
 * cost, latency, and output quality side by side.
 */
export async function compareCommand(
  args: readonly string[],
  options: ICompareCommandOptions,
): Promise<number> {
  const { io } = options;

  // Show help
  if (args.includes('--help') || args.includes('-h')) {
    io.write(
      [
        'Usage: dag compare <provider-a> <provider-b> [options]',
        '',
        'Run the same pipeline with two LLM providers and compare cost, latency, and output.',
        '',
        'Arguments:',
        '  <provider-a>    First provider (anthropic, openai, gemini, deepseek, qwen)',
        '  <provider-b>    Second provider',
        '',
        'Options:',
        '  --pipeline      Pipeline string with {provider} placeholder',
        '                  e.g. "input | llm-text-{provider} | text-output"',
        '  --input         Input key=value pair (repeatable)',
        '  --output        Output format: pretty (default) or json',
        '  --decide        Show recommendation section with winner and run command',
        '  --help          Show this help message',
        '',
        'Environment variables required per provider:',
        '  ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY,',
        '  DEEPSEEK_API_KEY, QWEN_API_KEY',
        '',
        'Example:',
        '  dag compare anthropic openai --input text="Write a haiku about TypeScript"',
        '',
      ].join('\n'),
    );
    return SUCCESS_EXIT_CODE;
  }

  const parseResult = parseCompareArgv(args);
  if (!parseResult.ok) {
    io.write(`Error: ${parseResult.message}\n`);
    return parseResult.exitCode;
  }

  const { providerA, providerB, pipeline, inputs, outputFormat, decide } = parseResult.value;

  if (outputFormat === OUTPUT_FORMAT_PRETTY) {
    io.write(`Running ${providerA} and ${providerB} in parallel...\n`);
  }

  // Run both providers in parallel
  let outcomes: readonly IRunOutcome[];
  try {
    outcomes = await Promise.all([
      runProvider(providerA, pipeline, inputs),
      runProvider(providerB, pipeline, inputs),
    ]);
  } catch (err) {
    // allow-fallback: parallel execution failure is a terminal error
    io.write(`Error: Parallel execution failed: ${resolveErrorMessage(err)}\n`);
    return FAILURE_EXIT_CODE;
  }

  if (outputFormat === OUTPUT_FORMAT_JSON) {
    formatJsonCompare(outcomes, inputs, io, decide, pipeline);
  } else {
    formatPrettyCompare(outcomes, inputs, io, decide, pipeline);
  }

  return SUCCESS_EXIT_CODE;
}
