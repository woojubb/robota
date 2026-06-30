import { writeFile } from 'node:fs/promises';
import type { IDagDefinition, IDagNode } from '@robota-sdk/dag-core';
import { isWorkflowFileFormat, fromDagWorkflowFile } from '@robota-sdk/dag-builder';
import { buildFlowLayout, renderFlowLayout } from '../renderer/flow-lines.js';
import { buildNodeDefinitionAssembly } from '@robota-sdk/dag-node';
import type { IDagCliIo } from '../types.js';
import { USAGE_ERROR_EXIT_CODE, SUCCESS_EXIT_CODE, FAILURE_EXIT_CODE } from '../types.js';
import { parseDagMd, DAG_MD_SUFFIX } from '../dag-md-parser/parse-dag-md.js';
import { createCliNodeRegistry, LocalDagRunner } from '../local-runner/index.js';
import { applyEnvFile, extractFinalOutput } from './run.js';

const JSON_INDENT_SPACES = 2;
const OUTPUT_FORMAT_JSON = 'json';
const ANTHROPIC_KEY_ENV = 'ANTHROPIC_API_KEY';
const DEFAULT_ENV_FILE = '.dag/.env';
const LLM_NODE_TYPE = 'llm-text-anthropic';
const OUTPUT_FORMAT_PRETTY = 'pretty';
const OUTPUT_FORMAT_GITHUB_COMMENT = 'github-comment';

// Cost heuristics (re-used from cost.ts patterns)
const CHARS_PER_TOKEN = 4;
const ESTIMATED_INPUT_CHARS = 500;
const ESTIMATED_OUTPUT_TOKENS = 200;
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

export interface IExplainCommandOptions {
  readonly io: IDagCliIo;
}

type TParseResult =
  | {
      readonly ok: true;
      readonly file: string;
      readonly outputFormat: string;
      readonly format: string;
      readonly suggest: boolean;
      readonly ascii: boolean;
      readonly saveToFile: string | undefined;
    }
  | { readonly ok: false; readonly exitCode: number; readonly message: string };

function resolveErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parseExplainArgv(args: readonly string[]): TParseResult {
  const mutableArgs = [...args];

  // --output <format>
  const outputIndex = mutableArgs.indexOf('--output');
  let outputFormat = OUTPUT_FORMAT_PRETTY;
  if (outputIndex !== -1) {
    const outputValue = mutableArgs[outputIndex + 1];
    if (typeof outputValue !== 'string' || outputValue.startsWith('--')) {
      return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: '--output requires a value.' };
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

  // --suggest
  const suggestIndex = mutableArgs.indexOf('--suggest');
  const suggest = suggestIndex !== -1;
  if (suggest) mutableArgs.splice(suggestIndex, 1);

  // --ascii
  const asciiIndex = mutableArgs.indexOf('--ascii');
  const ascii = asciiIndex !== -1;
  if (ascii) mutableArgs.splice(asciiIndex, 1);

  // --format <format>
  const formatIndex = mutableArgs.indexOf('--format');
  let format = OUTPUT_FORMAT_PRETTY;
  if (formatIndex !== -1) {
    const formatValue = mutableArgs[formatIndex + 1];
    if (typeof formatValue !== 'string' || formatValue.startsWith('--')) {
      return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: '--format requires a value.' };
    }
    if (
      formatValue !== OUTPUT_FORMAT_PRETTY &&
      formatValue !== OUTPUT_FORMAT_JSON &&
      formatValue !== OUTPUT_FORMAT_GITHUB_COMMENT
    ) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: `--format must be "pretty", "json", or "github-comment".`,
      };
    }
    format = formatValue;
    mutableArgs.splice(formatIndex, 2);
  }

  // --save <filepath>
  const saveIndex = mutableArgs.indexOf('--save');
  let saveToFile: string | undefined;
  if (saveIndex !== -1) {
    const saveValue = mutableArgs[saveIndex + 1];
    if (typeof saveValue !== 'string' || saveValue.startsWith('--')) {
      return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: '--save requires a value.' };
    }
    saveToFile = saveValue;
    mutableArgs.splice(saveIndex, 2);
  }

  const unknownFlags = mutableArgs.filter((a) => a.startsWith('--'));
  if (unknownFlags.length > 0) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `explain received unexpected flags: ${unknownFlags.join(' ')}.`,
    };
  }

  const positional = mutableArgs.filter((a) => !a.startsWith('--'));
  const file = positional[0];
  if (!file) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message:
        'explain requires <file> argument (e.g. dag explain workflow.dag.json).\n\nUsage:\n  dag explain <file> [--output json|pretty] [--format pretty|json|github-comment]',
    };
  }
  if (positional.length > 1) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `explain received unexpected positional arguments: ${positional.slice(1).join(' ')}.`,
    };
  }

  return { ok: true, file, outputFormat, format, suggest, ascii, saveToFile };
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
    const companionPath = filePath.replace(/\.dag\.json$/, '.dag.robota.json');
    let companion: import('@robota-sdk/dag-core').IDagRobotaCompanion | undefined;
    if (companionPath !== filePath) {
      try {
        const companionText = await io.readTextFile(companionPath);
        companion = JSON.parse(companionText) as import('@robota-sdk/dag-core').IDagRobotaCompanion;
      } catch (_err) {
        // allow-fallback: companion file is optional
        companion = undefined;
      }
    }
    return { ok: true, value: fromDagWorkflowFile(parsed, companion) };
  }

  return { ok: true, value: parsed as IDagDefinition };
}

/**
 * Topologically sort DAG nodes using dependsOn relationships.
 * Returns nodes in execution order (dependencies first).
 */
function topoSort(nodes: readonly IDagNode[]): IDagNode[] {
  const nodeMap = new Map<string, IDagNode>();
  for (const node of nodes) {
    nodeMap.set(node.nodeId, node);
  }

  const visited = new Set<string>();
  const result: IDagNode[] = [];

  function visit(nodeId: string): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (!node) return;
    for (const dep of node.dependsOn) {
      visit(dep);
    }
    result.push(node);
  }

  for (const node of nodes) {
    visit(node.nodeId);
  }

  return result;
}

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

function getProviderFromNodeType(nodeType: string): string | null {
  if (nodeType === 'llm-text-anthropic') return 'anthropic';
  if (nodeType === 'llm-text-openai') return 'openai';
  if (nodeType === 'llm-text-gemini') return 'gemini';
  if (nodeType === 'llm-text-deepseek') return 'deepseek';
  if (nodeType === 'llm-text-qwen') return 'qwen';
  if (nodeType.startsWith('llm-')) return nodeType.replace('llm-text-', '').replace('llm-', '');
  return null;
}

function getInputPortNames(node: IDagNode): string[] {
  if (node.inputs && node.inputs.length > 0) {
    return node.inputs.map((p: { key: string }) => p.key);
  }
  // Infer from nodeType
  if (node.nodeType === 'input') return ['text'];
  if (node.nodeType === 'multi-input') return ['text'];
  if (node.nodeType === 'text-output') return ['text'];
  if (node.nodeType === 'ok-emitter') return [];
  return ['text'];
}

function getOutputPortNames(node: IDagNode): string[] {
  if (node.outputs && node.outputs.length > 0) {
    return node.outputs.map((p: { key: string }) => p.key);
  }
  if (node.nodeType === 'text-output') return [];
  if (node.nodeType === 'ok-emitter') return [];
  if (node.nodeType === 'input') return ['text'];
  return ['text'];
}

function estimateTotalCostRange(dag: IDagDefinition): [number, number] {
  let minUsd = 0;
  let maxUsd = 0;
  const inputTokens = Math.ceil(ESTIMATED_INPUT_CHARS / CHARS_PER_TOKEN);

  for (const node of dag.nodes) {
    const { nodeType } = node;
    const model = getNodeModel(node);

    if (nodeType === 'llm-text-anthropic') {
      const isSonnet =
        (model ?? '').includes('sonnet') ||
        (model ?? '').includes('claude-3') ||
        (model ?? '').includes('opus');
      const inputRateHaiku = ANTHROPIC_HAIKU_INPUT_PER_1K;
      const outputRateHaiku = ANTHROPIC_HAIKU_OUTPUT_PER_1K;
      const inputRateSonnet = ANTHROPIC_SONNET_INPUT_PER_1K;
      const outputRateSonnet = ANTHROPIC_SONNET_OUTPUT_PER_1K;
      const low =
        (inputTokens / 1000) * inputRateHaiku + (ESTIMATED_OUTPUT_TOKENS / 1000) * outputRateHaiku;
      const high =
        (inputTokens / 1000) * inputRateSonnet +
        (ESTIMATED_OUTPUT_TOKENS / 1000) * outputRateSonnet;
      if (isSonnet) {
        minUsd += high * 0.5;
        maxUsd += high * 3;
      } else {
        minUsd += low * 0.5;
        maxUsd += low * 12;
      }
    } else if (nodeType === 'llm-text-openai') {
      const isGpt4o = (model ?? '').includes('gpt-4o') && !(model ?? '').includes('mini');
      const inputRate = isGpt4o ? OPENAI_GPT4O_INPUT_PER_1K : OPENAI_GPT4O_MINI_INPUT_PER_1K;
      const outputRate = isGpt4o ? OPENAI_GPT4O_OUTPUT_PER_1K : OPENAI_GPT4O_MINI_OUTPUT_PER_1K;
      const base = (inputTokens / 1000) * inputRate + (ESTIMATED_OUTPUT_TOKENS / 1000) * outputRate;
      minUsd += base * 0.5;
      maxUsd += base * 10;
    } else if (nodeType === 'llm-text-gemini') {
      const isPro = (model ?? '').includes('pro');
      const inputRate = isPro ? GEMINI_PRO_INPUT_PER_1K : GEMINI_FLASH_INPUT_PER_1K;
      const outputRate = isPro ? GEMINI_PRO_OUTPUT_PER_1K : GEMINI_FLASH_OUTPUT_PER_1K;
      const base = (inputTokens / 1000) * inputRate + (ESTIMATED_OUTPUT_TOKENS / 1000) * outputRate;
      minUsd += base * 0.5;
      maxUsd += base * 10;
    } else if (nodeType.startsWith('llm-')) {
      minUsd += 0.0005;
      maxUsd += 0.005;
    }
  }

  return [Math.round(minUsd * 10000) / 10000, Math.round(maxUsd * 10000) / 10000];
}

function estimateLatencyRange(dag: IDagDefinition): [number, number] {
  const llmCount = dag.nodes.filter((n: { nodeType: string }) =>
    n.nodeType.startsWith('llm-'),
  ).length;
  if (llmCount === 0) return [0.1, 0.5];
  // Rough heuristic: 1–5 seconds per sequential LLM call
  return [llmCount * 1, llmCount * 5];
}

interface IExplainResult {
  readonly dagId: string;
  readonly nodeCount: number;
  readonly providers: readonly string[];
  readonly requiredInputs: readonly string[];
  readonly estimatedCostRangeUsd: readonly [number, number];
  readonly estimatedLatencyRangeS: readonly [number, number];
  readonly nodes: readonly IExplainNodeInfo[];
}

interface IExplainNodeInfo {
  readonly step: number;
  readonly nodeId: string;
  readonly nodeType: string;
  readonly model: string | undefined;
  readonly provider: string | null;
  readonly inputPorts: readonly string[];
  readonly outputPorts: readonly string[];
  readonly dependsOn: readonly string[];
}

function buildExplainResult(dag: IDagDefinition): IExplainResult {
  const sorted = topoSort(dag.nodes);
  const providersSet = new Set<string>();
  const requiredInputsSet = new Set<string>();

  const nodes: IExplainNodeInfo[] = sorted.map((node, idx) => {
    const provider = getProviderFromNodeType(node.nodeType);
    if (provider !== null) providersSet.add(provider);

    const inputPorts = getInputPortNames(node);
    const outputPorts = getOutputPortNames(node);

    // Collect required inputs from the "input" node
    if (node.nodeType === 'input' || node.nodeType === 'multi-input') {
      for (const port of inputPorts) {
        requiredInputsSet.add(port);
      }
      // Also check config for port definitions
      const config = node.config as Record<string, unknown>;
      if (Array.isArray(config['ports'])) {
        for (const p of config['ports'] as Array<{ key?: string; required?: boolean }>) {
          if (typeof p.key === 'string') {
            requiredInputsSet.add(p.key);
          }
        }
      }
    }

    return {
      step: idx + 1,
      nodeId: node.nodeId,
      nodeType: node.nodeType,
      model: getNodeModel(node),
      provider,
      inputPorts,
      outputPorts,
      dependsOn: node.dependsOn,
    };
  });

  const [minCost, maxCost] = estimateTotalCostRange(dag);
  const [minLatency, maxLatency] = estimateLatencyRange(dag);

  return {
    dagId: dag.dagId,
    nodeCount: dag.nodes.length,
    providers: [...providersSet],
    requiredInputs: [...requiredInputsSet],
    estimatedCostRangeUsd: [minCost, maxCost],
    estimatedLatencyRangeS: [minLatency, maxLatency],
    nodes,
  };
}

function formatPrettySummary(result: IExplainResult, io: IDagCliIo): void {
  const DIVIDER = '─'.repeat(62);
  const {
    dagId,
    nodeCount,
    providers,
    requiredInputs,
    estimatedCostRangeUsd,
    estimatedLatencyRangeS,
    nodes,
  } = result;

  io.write(`\nPipeline: ${dagId} (${nodeCount} nodes)\n`);
  io.write(`${DIVIDER}\n`);

  // Summary sentence
  const llmCount = nodes.filter((n) => n.provider !== null).length;
  const nonLlm = nodeCount - llmCount;
  if (llmCount > 0) {
    io.write(
      `This pipeline receives input, processes it through ${llmCount} LLM provider${llmCount > 1 ? 's' : ''}, and returns the result.\n`,
    );
  } else {
    io.write(
      `This pipeline processes ${nonLlm} node${nonLlm !== 1 ? 's' : ''} and returns the result.\n`,
    );
  }

  io.write(`\nNode flow:\n`);
  const COL_ID = 20;
  for (const node of nodes) {
    const stepStr = `  ${node.step}. `;
    const idPadded = node.nodeId.padEnd(COL_ID);
    let detail = '';
    if (node.provider !== null) {
      const modelStr = node.model ?? `(${node.provider} default)`;
      detail = `runs ${modelStr} (${node.provider[0]!.toUpperCase() + node.provider.slice(1)})`;
    } else if (node.nodeType === 'input' || node.nodeType === 'multi-input') {
      detail = `receives "${node.inputPorts.join('", "')}" (required)`;
    } else if (node.nodeType === 'text-output' || node.nodeType === 'ok-emitter') {
      detail = `returns "${node.outputPorts.join('", "')}"`;
      if (node.inputPorts.length > 0) {
        detail = `returns "${node.inputPorts.join('", "')}"`;
      }
    } else {
      detail = `${node.nodeType}`;
    }
    io.write(`${stepStr}${idPadded}${detail}\n`);
    if (node.provider !== null && node.outputPorts.length > 0) {
      const indent = ' '.repeat(stepStr.length + COL_ID);
      io.write(`${indent}→ outputs "${node.outputPorts.join('", "')}"\n`);
    }
  }

  io.write(`\n`);
  io.write(
    `Required inputs:   ${requiredInputs.length > 0 ? requiredInputs.join(', ') : '(none)'}\n`,
  );
  io.write(`LLM providers:     ${providers.length > 0 ? providers.join(', ') : '(none)'}\n`);

  const [minCost, maxCost] = estimatedCostRangeUsd;
  if (minCost === 0 && maxCost === 0) {
    io.write(`Estimated cost:    $0 (no LLM calls)\n`);
  } else {
    io.write(`Estimated cost:    ~$${minCost.toFixed(4)}–$${maxCost.toFixed(4)} per run\n`);
  }

  const [minLat, maxLat] = estimatedLatencyRangeS;
  io.write(`Estimated time:    ${minLat}–${maxLat} seconds\n`);
  io.write(`\n`);
}

function formatJsonExplain(result: IExplainResult, io: IDagCliIo): void {
  const output = {
    dagId: result.dagId,
    nodeCount: result.nodeCount,
    providers: result.providers,
    requiredInputs: result.requiredInputs,
    estimatedCostRangeUsd: result.estimatedCostRangeUsd,
    estimatedLatencyRangeS: result.estimatedLatencyRangeS,
    nodes: result.nodes,
  };
  io.write(`${JSON.stringify(output, null, JSON_INDENT_SPACES)}\n`);
}

function buildMermaidFromNodes(nodes: readonly IExplainNodeInfo[]): string {
  const lines: string[] = ['flowchart LR'];
  for (const node of nodes) {
    const icon =
      node.provider !== null
        ? '🤖'
        : node.nodeType === 'input' || node.nodeType === 'multi-input'
          ? '📥'
          : '📤';
    const label = `${icon} ${node.nodeId}`;
    for (const dep of node.dependsOn) {
      lines.push(`  ${dep}-->${node.nodeId}["${label}"]`);
    }
  }
  return lines.join('\n');
}

function formatGithubComment(result: IExplainResult, io: IDagCliIo): void {
  const {
    dagId,
    nodeCount,
    providers,
    requiredInputs,
    estimatedCostRangeUsd,
    estimatedLatencyRangeS,
    nodes,
  } = result;
  const [minCost, maxCost] = estimatedCostRangeUsd;
  const [minLat, maxLat] = estimatedLatencyRangeS;

  const costStr =
    minCost === 0 && maxCost === 0
      ? '$0 (no LLM calls)'
      : `~$${minCost.toFixed(4)}–$${maxCost.toFixed(4)}`;

  io.write(`## DAG Pipeline — \`${dagId}\`\n\n`);
  io.write(`| Property | Value |\n`);
  io.write(`|----------|-------|\n`);
  io.write(`| Nodes | ${nodeCount} |\n`);
  io.write(`| Providers | ${providers.length > 0 ? providers.join(', ') : '(none)'} |\n`);
  io.write(
    `| Required inputs | ${requiredInputs.length > 0 ? requiredInputs.join(', ') : '(none)'} |\n`,
  );
  io.write(`| Est. cost | ${costStr} per run |\n`);
  io.write(`| Est. time | ${minLat}–${maxLat} seconds |\n`);
  io.write(`\n`);
  io.write(`\`\`\`mermaid\n${buildMermaidFromNodes(nodes)}\n\`\`\`\n\n`);
  io.write(`<details>\n<summary>Node details</summary>\n\n`);
  for (const node of nodes) {
    let detail = node.nodeType;
    if (node.provider !== null) {
      detail = `${node.model ?? `${node.provider} default`} (${node.provider})`;
    }
    io.write(`${node.step}. **${node.nodeId}** — ${detail}\n`);
  }
  io.write(`\n</details>\n\n`);
  io.write(`> Generated by \`dag explain --format github-comment\`\n`);
}

const SUGGEST_LLM_DAG: import('@robota-sdk/dag-core').IDagDefinition = {
  dagId: 'explain-suggest-llm',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
    { nodeId: 'llm', nodeType: LLM_NODE_TYPE, dependsOn: ['input'], config: {} },
    { nodeId: 'output', nodeType: 'text-output', dependsOn: ['llm'], config: {} },
  ],
  edges: [
    { from: 'input', to: 'llm', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
    { from: 'llm', to: 'output', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
  ],
};

function buildSuggestPrompt(
  result: IExplainResult,
  manifests: ReadonlyArray<{ nodeType: string }>,
): string {
  const nodeFlow = result.nodes
    .map((n) => `  ${n.step}. ${n.nodeId} (${n.nodeType})${n.model ? ` — model: ${n.model}` : ''}`)
    .join('\n');
  const available = manifests.map((m) => m.nodeType).join(', ');

  return `You are a DAG pipeline advisor. Analyze this pipeline and give 2-4 concrete improvement suggestions.

Pipeline: ${result.dagId} (${result.nodeCount} nodes)
Node flow:
${nodeFlow}
Providers: ${result.providers.length > 0 ? result.providers.join(', ') : 'none'}
Est. cost: $${result.estimatedCostRangeUsd[0].toFixed(4)}–$${result.estimatedCostRangeUsd[1].toFixed(4)} per run
Available alternative nodes: ${available}

Give suggestions in these categories if applicable:
- ⚡ Performance: latency or throughput improvements
- 💡 Alternative: better node choices or simpler structure
- 💰 Cost: cheaper equivalent options

Format each suggestion as a single short paragraph starting with the emoji and category.
Output only the suggestions, no intro or outro.`;
}

async function fetchSuggestions(
  result: IExplainResult,
  manifests: ReadonlyArray<{ nodeType: string }>,
): Promise<string | null> {
  const prompt = buildSuggestPrompt(result, manifests);
  const runner = new LocalDagRunner(createCliNodeRegistry());
  try {
    const llmResult = await runner.run(SUGGEST_LLM_DAG, { text: prompt });
    if (llmResult.dagRun.status !== 'success') return null;
    return extractFinalOutput(llmResult.taskRuns, SUGGEST_LLM_DAG.nodes);
  } catch {
    // allow-fallback: LLM suggestion failure returns null (suggestions are optional)
    return null;
  }
}

/**
 * Execute the `dag explain <file>` command.
 *
 * Reads a DAG file, topologically sorts the nodes, and prints a
 * human-readable summary of the pipeline structure, providers, and cost.
 */
export async function explainCommand(
  args: readonly string[],
  options: IExplainCommandOptions,
): Promise<number> {
  const { io } = options;

  // Show help
  if (args.includes('--help') || args.includes('-h')) {
    io.write(
      [
        'Usage: dag explain <file> [--output json|pretty] [--suggest] [--ascii] [--save <file>]',
        '',
        'Explain a DAG workflow pipeline structure.',
        '',
        'Arguments:',
        '  <file>             Path to a .dag.json or .dag.md file',
        '',
        'Options:',
        '  --output pretty    Human-readable output (default)',
        '  --output json      Machine-readable JSON output',
        '  --format <fmt>     Output format: pretty (default), json, github-comment',
        '  --suggest          Append LLM improvement suggestions (requires ANTHROPIC_API_KEY)',
        '  --ascii            Append ASCII flow diagram after the explanation',
        '  --save <file>      Save the output to a file (combine with --format github-comment for .md)',
        '  --help             Show this help message',
        '',
      ].join('\n'),
    );
    return SUCCESS_EXIT_CODE;
  }

  const parseResult = parseExplainArgv(args);
  if (!parseResult.ok) {
    io.writeError(`Error: ${parseResult.message}\n`);
    return parseResult.exitCode;
  }

  const { file, outputFormat, format, suggest, ascii, saveToFile } = parseResult;

  const dagFileResult = await readDagFile(file, io);
  if (!dagFileResult.ok) {
    io.writeError(`Error: ${dagFileResult.message}\n`);
    return dagFileResult.exitCode;
  }

  const dag = dagFileResult.value;
  const result = buildExplainResult(dag);

  // Wrap io to capture output when --save is requested
  const captured: string[] = [];
  const capturingIo: IDagCliIo = saveToFile
    ? {
        ...io,
        write: (text) => {
          captured.push(text);
          io.write(text);
        },
      }
    : io;

  if (format === OUTPUT_FORMAT_GITHUB_COMMENT) {
    formatGithubComment(result, capturingIo);
  } else if (outputFormat === OUTPUT_FORMAT_JSON) {
    formatJsonExplain(result, capturingIo);
  } else {
    formatPrettySummary(result, capturingIo);
  }

  if (ascii) {
    const layout = buildFlowLayout(dag);
    const lines = renderFlowLayout(layout, new Map());
    capturingIo.write('\nFlow diagram:\n');
    for (const line of lines) {
      capturingIo.write(line + '\n');
    }
  }

  // Save captured output to file if --save was specified
  if (saveToFile) {
    try {
      await writeFile(saveToFile, captured.join(''), 'utf8');
      io.write(`\n✓ Saved to ${saveToFile}\n`);
    } catch (saveErr) {
      // allow-fallback: writeFile failure is non-fatal; output was already written to stdout and error is reported to user
      io.writeError(
        `⚠ Could not save to ${saveToFile}: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}\n`,
      );
    }
  }

  if (!suggest) {
    return SUCCESS_EXIT_CODE;
  }

  // --suggest: append LLM-generated improvement suggestions
  await applyEnvFile(DEFAULT_ENV_FILE);

  if (!process.env[ANTHROPIC_KEY_ENV]) {
    io.write(
      '\nℹ --suggest requires ANTHROPIC_API_KEY. Set it in .dag/.env to enable suggestions.\n',
    );
    return SUCCESS_EXIT_CODE;
  }

  const assemblyResult = buildNodeDefinitionAssembly(createCliNodeRegistry());
  if (!assemblyResult.ok) {
    io.writeError(`\nError: Failed to build node registry: ${assemblyResult.error.message}\n`);
    return FAILURE_EXIT_CODE;
  }

  io.write('\nFetching suggestions...\n');
  const suggestions = await fetchSuggestions(result, assemblyResult.value.manifests);

  if (!suggestions) {
    io.write('⚠ Could not fetch suggestions.\n');
    return SUCCESS_EXIT_CODE;
  }

  const DIVIDER = '─'.repeat(62);
  io.write(`\nSuggestions:\n${DIVIDER}\n${suggestions}\n`);

  return SUCCESS_EXIT_CODE;
}
