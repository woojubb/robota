import type { IDagDefinition, IDagRobotaCompanion, IDagNode } from '@robota-sdk/dag-core';
import type { IDagCliIo } from '../types.js';
import { FAILURE_EXIT_CODE, USAGE_ERROR_EXIT_CODE, SUCCESS_EXIT_CODE } from '../types.js';
import { createCliFailure } from '../json.js';
import { parseDagMd, DAG_MD_SUFFIX } from '../dag-md-parser/parse-dag-md.js';
import { isWorkflowFileFormat, fromDagWorkflowFile } from '@robota-sdk/dag-builder';

const JSON_INDENT_SPACES = 2;
const OUTPUT_FORMAT_JSON = 'json';
const OUTPUT_FORMAT_PRETTY = 'pretty';

// ---------------------------------------------------------------------------
// Pricing constants (USD per 1 000 tokens, May 2025 public prices)
// ---------------------------------------------------------------------------
const ANTHROPIC_HAIKU_INPUT_PER_1K = 0.00025;
const ANTHROPIC_HAIKU_OUTPUT_PER_1K = 0.00125;
const ANTHROPIC_SONNET_INPUT_PER_1K = 0.003;
const ANTHROPIC_SONNET_OUTPUT_PER_1K = 0.015;
const OPENAI_GPT4O_MINI_INPUT_PER_1K = 0.00015;
const OPENAI_GPT4O_MINI_OUTPUT_PER_1K = 0.0006;
const OPENAI_GPT4O_INPUT_PER_1K = 0.005;
const OPENAI_GPT4O_OUTPUT_PER_1K = 0.015;
const GEMINI_FLASH_INPUT_PER_1K = 0.000075;
const GEMINI_FLASH_OUTPUT_PER_1K = 0.0003;
const GEMINI_PRO_INPUT_PER_1K = 0.00125;
const GEMINI_PRO_OUTPUT_PER_1K = 0.005;
const CHARS_PER_TOKEN = 4;
const ESTIMATED_OUTPUT_TOKENS = 200;

export interface ICostCommandOptions {
  readonly io: IDagCliIo;
}

/** Parsed options from argv for the `cost estimate` subcommand. */
interface IParsedCostOptions {
  readonly file: string;
  readonly inputs: Record<string, string>;
  readonly outputFormat: string;
}

type TCostParseResult =
  | { readonly ok: true; readonly value: IParsedCostOptions }
  | { readonly ok: false; readonly exitCode: number; readonly message: string };

interface INodeCostEstimate {
  readonly nodeId: string;
  readonly nodeType: string;
  readonly estimatedUsd: number;
  readonly label: string;
  readonly note: string;
}

interface ICostEstimateResult {
  readonly dagId: string;
  readonly file: string;
  readonly nodeCount: number;
  readonly nodes: readonly INodeCostEstimate[];
  readonly totalUsd: number;
  readonly inputTextLength: number;
}

function resolveErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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

function parseCostArgv(args: readonly string[]): TCostParseResult {
  const mutableArgs = [...args];

  // First positional must be the subcommand "estimate"
  const subcommand = mutableArgs[0];
  if (subcommand !== 'estimate') {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `Unknown cost subcommand "${subcommand ?? ''}". Usage: dag cost estimate <file>`,
    };
  }
  mutableArgs.splice(0, 1);

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
    const key = pair.slice(0, eqIndex);
    const value = pair.slice(eqIndex + 1);
    inputs[key] = value;
  }

  // Positional: file
  const positional = inputResult.remaining.filter((a) => !a.startsWith('--'));
  const unknownFlags = inputResult.remaining.filter((a) => a.startsWith('--'));

  if (unknownFlags.length > 0) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `cost estimate received unexpected flags: ${unknownFlags.join(' ')}.`,
    };
  }

  const file = positional[0];
  if (!file) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: 'cost estimate requires <file> argument (e.g. dag cost estimate workflow.dag.json).',
    };
  }
  if (positional.length > 1) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `cost estimate received unexpected positional arguments: ${positional.slice(1).join(' ')}.`,
    };
  }

  return { ok: true, value: { file, inputs, outputFormat } };
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
    text = await io.readTextFile(filePath);
  } catch (readErr) {
    // allow-fallback: I/O error is converted to a structured error result and returned
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
    parsed = JSON.parse(text) as unknown;
  } catch (parseErr) {
    // allow-fallback: JSON parse error is converted to a structured error result and returned
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

async function tryReadCompanion(
  dagFilePath: string,
  io: IDagCliIo,
): Promise<IDagRobotaCompanion | null> {
  const companionPath = dagFilePath.replace(/\.dag\.json$/, '.dag.robota.json');
  if (companionPath === dagFilePath) return null;
  let text: string;
  try {
    text = await io.readTextFile(companionPath);
  } catch (_err) {
    // allow-fallback: companion file is optional — file-not-found is the expected case
    return null;
  }
  try {
    return JSON.parse(text) as IDagRobotaCompanion;
  } catch (_parseErr) {
    // allow-fallback: malformed companion JSON is silently skipped
    return null;
  }
}

/** Derive the model string from a node config object, if present. */
function getNodeModel(node: IDagNode): string | undefined {
  if (
    typeof node.config === 'object' &&
    node.config !== null &&
    'model' in node.config &&
    typeof (node.config as Record<string, unknown>)['model'] === 'string'
  ) {
    return (node.config as Record<string, unknown>)['model'] as string;
  }
  return undefined;
}

/** Estimate cost for a single node given the total input text character count. */
function estimateNodeCost(node: IDagNode, inputTextChars: number): INodeCostEstimate {
  const nodeType = node.nodeType;
  const inputTokens = Math.ceil(inputTextChars / CHARS_PER_TOKEN);
  const model = getNodeModel(node);

  // No-API nodes
  const noApiTypes = new Set([
    'input',
    'text-output',
    'text-template',
    'transform',
    'ok-emitter',
    'merge',
    'split',
    'passthrough',
  ]);
  if (noApiTypes.has(nodeType)) {
    return {
      nodeId: node.nodeId,
      nodeType,
      estimatedUsd: 0,
      label: '$0.000',
      note: '(no API call)',
    };
  }

  if (nodeType === 'llm-text-anthropic') {
    const modelStr = model ?? 'claude-haiku-4-5';
    const isSonnet =
      modelStr.includes('sonnet') || modelStr.includes('claude-3') || modelStr.includes('opus');
    const inputRate = isSonnet ? ANTHROPIC_SONNET_INPUT_PER_1K : ANTHROPIC_HAIKU_INPUT_PER_1K;
    const outputRate = isSonnet ? ANTHROPIC_SONNET_OUTPUT_PER_1K : ANTHROPIC_HAIKU_OUTPUT_PER_1K;
    const usd = (inputTokens / 1000) * inputRate + (ESTIMATED_OUTPUT_TOKENS / 1000) * outputRate;
    const modelLabel = isSonnet ? 'claude-sonnet' : 'claude-haiku-4-5';
    return {
      nodeId: node.nodeId,
      nodeType,
      estimatedUsd: usd,
      label: `~$${usd.toFixed(4)}`,
      note: `${modelLabel} | ~${inputTokens} tokens in / ~${ESTIMATED_OUTPUT_TOKENS} tokens out (estimated)`,
    };
  }

  if (nodeType === 'llm-text-openai') {
    const modelStr = model ?? 'gpt-4o-mini';
    const isGpt4o = modelStr.includes('gpt-4o') && !modelStr.includes('mini');
    const inputRate = isGpt4o ? OPENAI_GPT4O_INPUT_PER_1K : OPENAI_GPT4O_MINI_INPUT_PER_1K;
    const outputRate = isGpt4o ? OPENAI_GPT4O_OUTPUT_PER_1K : OPENAI_GPT4O_MINI_OUTPUT_PER_1K;
    const usd = (inputTokens / 1000) * inputRate + (ESTIMATED_OUTPUT_TOKENS / 1000) * outputRate;
    const modelLabel = isGpt4o ? 'gpt-4o' : 'gpt-4o-mini';
    return {
      nodeId: node.nodeId,
      nodeType,
      estimatedUsd: usd,
      label: `~$${usd.toFixed(4)}`,
      note: `${modelLabel} | ~${inputTokens} tokens in / ~${ESTIMATED_OUTPUT_TOKENS} tokens out (estimated)`,
    };
  }

  if (nodeType === 'llm-text-gemini') {
    const modelStr = model ?? 'gemini-1.5-flash';
    const isPro = modelStr.includes('pro');
    const inputRate = isPro ? GEMINI_PRO_INPUT_PER_1K : GEMINI_FLASH_INPUT_PER_1K;
    const outputRate = isPro ? GEMINI_PRO_OUTPUT_PER_1K : GEMINI_FLASH_OUTPUT_PER_1K;
    const usd = (inputTokens / 1000) * inputRate + (ESTIMATED_OUTPUT_TOKENS / 1000) * outputRate;
    const modelLabel = isPro ? 'gemini-pro' : 'gemini-flash';
    return {
      nodeId: node.nodeId,
      nodeType,
      estimatedUsd: usd,
      label: `~$${usd.toFixed(4)}`,
      note: `${modelLabel} | ~${inputTokens} tokens in / ~${ESTIMATED_OUTPUT_TOKENS} tokens out (estimated)`,
    };
  }

  // Other AI nodes — unknown pricing
  return {
    nodeId: node.nodeId,
    nodeType,
    estimatedUsd: 0.001,
    label: '~$0.001',
    note: '(varies — pricing not available for this node type)',
  };
}

function buildCostEstimate(
  dagDefinition: IDagDefinition,
  inputs: Record<string, string>,
  filePath: string,
): ICostEstimateResult {
  const inputTextLength = Object.values(inputs).reduce((sum, v) => sum + v.length, 0);
  const nodes = dagDefinition.nodes.map((node) => estimateNodeCost(node, inputTextLength));
  const totalUsd = nodes.reduce((sum, n) => sum + n.estimatedUsd, 0);
  return {
    dagId: dagDefinition.dagId,
    file: filePath,
    nodeCount: dagDefinition.nodes.length,
    nodes,
    totalUsd,
    inputTextLength,
  };
}

function formatPrettyCostOutput(estimate: ICostEstimateResult, io: IDagCliIo): void {
  const { file, nodeCount, nodes, totalUsd, inputTextLength } = estimate;

  io.write(`DAG: ${file} (${nodeCount} nodes)\n`);
  if (inputTextLength > 0) {
    io.write(`Input text: ${inputTextLength} chars\n`);
  }
  io.write(`\nCost Estimate:\n`);

  const COL_ID = 18;
  const COL_LABEL = 10;
  for (const n of nodes) {
    const id = n.nodeId.padEnd(COL_ID);
    const label = n.label.padEnd(COL_LABEL);
    io.write(`  ${id}${label}${n.note}\n`);
  }

  const divider = '─'.repeat(45);
  io.write(`  ${divider}\n`);

  const totalLabel = totalUsd === 0 ? '$0.000' : `~$${totalUsd.toFixed(4)}`;
  const totalId = 'Total'.padEnd(COL_ID);
  io.write(
    `  ${totalId}${totalLabel.padEnd(COL_LABEL)}(±50% estimate — actual depends on response length)\n`,
  );
  io.write(
    `\nTip: dag run ${file} --max-cost-usd ${(totalUsd * 2 || 0.01).toFixed(2)}  to set a hard limit.\n`,
  );
}

function formatJsonCostOutput(estimate: ICostEstimateResult, io: IDagCliIo): void {
  const output = {
    ok: true,
    dagId: estimate.dagId,
    file: estimate.file,
    nodeCount: estimate.nodeCount,
    inputTextLength: estimate.inputTextLength,
    totalUsd: estimate.totalUsd,
    nodes: estimate.nodes.map((n) => ({
      nodeId: n.nodeId,
      nodeType: n.nodeType,
      estimatedUsd: n.estimatedUsd,
      note: n.note,
    })),
  };
  io.write(`${JSON.stringify(output, null, JSON_INDENT_SPACES)}\n`);
}

/**
 * Execute the `dag cost <subcommand>` command.
 *
 * Currently supports: `cost estimate <file>`
 */
export async function runCostCommand(
  args: readonly string[],
  options: ICostCommandOptions,
): Promise<number> {
  const { io } = options;

  const parseResult = parseCostArgv(args);
  if (!parseResult.ok) {
    const failure = createCliFailure('DAG_CLI_USAGE_ERROR', parseResult.message);
    io.write(`${JSON.stringify(failure, null, JSON_INDENT_SPACES)}\n`);
    return parseResult.exitCode;
  }

  const { file, inputs, outputFormat } = parseResult.value;

  const dagFileResult = await readDagFile(file, io);
  if (!dagFileResult.ok) {
    const failure = createCliFailure('DAG_CLI_USAGE_ERROR', dagFileResult.message);
    io.write(`${JSON.stringify(failure, null, JSON_INDENT_SPACES)}\n`);
    return dagFileResult.exitCode;
  }

  const estimate = buildCostEstimate(dagFileResult.value, inputs, file);

  if (outputFormat === OUTPUT_FORMAT_JSON) {
    formatJsonCostOutput(estimate, io);
  } else {
    formatPrettyCostOutput(estimate, io);
  }

  return SUCCESS_EXIT_CODE;
}
