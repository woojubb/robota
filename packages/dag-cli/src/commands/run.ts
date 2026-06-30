import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { watch } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import type {
  IDagDefinition,
  IDagEdgeDefinition,
  IDagNode,
  IDagNodeDefinition,
  IDagRobotaCompanion,
  INodeConfigObject,
  INodeManifest,
  TPortPayload,
} from '@robota-sdk/dag-core';
import type { IDagCliIo } from '../types.js';
import { FAILURE_EXIT_CODE, USAGE_ERROR_EXIT_CODE, SUCCESS_EXIT_CODE } from '../types.js';
import { createCliFailure } from '../json.js';
import {
  LocalDagRunner,
  createCliNodeRegistry,
  loadNodeFileExplicit,
  loadLocalNodeDefinitions,
} from '../local-runner/index.js';
import type { ILocalRunResult } from '../local-runner/index.js';
import { computeLineDiff, getMainOutput, WATCH_DIFF_MAX_CHANGED_LINES } from '../lib/line-diff.js';
import { RunProgressRenderer } from '../progress/run-progress-renderer.js';
import { PlainLogRenderer } from '../progress/plain-log-renderer.js';
import { StreamLogRenderer } from '../progress/stream-log-renderer.js';
import { TuiRenderer } from '../progress/tui-renderer.js';
import { parseDagMd, DAG_MD_SUFFIX } from '../dag-md-parser/parse-dag-md.js';
import { isWorkflowFileFormat, fromDagWorkflowFile } from '@robota-sdk/dag-builder';
import { buildNodeDefinitionAssembly } from '@robota-sdk/dag-node';
import { validateFrozenRun } from './lock.js';
import { parsePipelineSpec } from '../pipeline-parser.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const OUTPUT_FORMAT_PRETTY = 'pretty';
const OUTPUT_FORMAT_JSON = 'json';
const OUTPUT_FORMAT_RESULT = 'result';
const JSON_INDENT_SPACES = 2;
const UTF8_ENCODING = 'utf8';
const NODE_X_SPACING = 300;

export interface IRunCommandOptions {
  readonly io: IDagCliIo;
  /** Optional factory override for testing. Defaults to LocalDagRunner with default registry. */
  readonly createRunner?: () => LocalDagRunner;
}

/** Parsed options from argv for the `run` subcommand. */
interface IParsedRunOptions {
  readonly file: string | undefined;
  readonly pipeline: string | undefined;
  readonly stdinMode: boolean;
  readonly inputs: Record<string, string>;
  readonly outputFormat: string;
  readonly timeoutMs: number;
  readonly envFilePath: string | undefined;
  readonly dryRun: boolean;
  readonly noProgress: boolean;
  readonly watchMode: boolean;
  readonly stream: boolean;
  readonly confirmCost: boolean;
  readonly maxCostUsd: number | undefined;
  readonly noCostWarning: boolean;
  readonly noDiff: boolean;
  readonly showFull: boolean;
  readonly reportFile: string | undefined;
  readonly frozen: boolean;
  readonly noCta: boolean;
  readonly showAliases: boolean;
  readonly nodeConfigs: ReadonlyArray<string>; // raw "nodeId.key=value" strings
  readonly outputKeys: ReadonlyArray<string>; // raw "nodeId.portKey" strings for --output-key
  readonly saveAsName: string | undefined;
  readonly saveAsDraft: boolean;
  readonly nodeFiles: ReadonlyArray<string>;
  readonly noAutoNodes: boolean;
  readonly tuiMode: boolean;
  readonly provider: string | undefined;
  readonly serverUrl: string | undefined;
}

type TParseResult =
  | { readonly ok: true; readonly value: IParsedRunOptions }
  | {
      readonly ok: false;
      readonly exitCode: number;
      readonly message: string;
      readonly isHelp?: boolean;
    };

/**
 * Collect all values for a repeatable option like `--input key=value`.
 * Removes matched option flag+value pairs from the remaining args.
 */
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

/**
 * Take a single-valued option from args. Returns `undefined` if not present,
 * or an error string if the flag appears but has no following value.
 */
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
        return {
          value: undefined,
          remaining,
          error: `${optionName} can only be provided once.`,
        };
      }
      const next = args[i + 1];
      if (typeof next !== 'string' || next.startsWith('--')) {
        return {
          value: undefined,
          remaining,
          error: `${optionName} requires a value.`,
        };
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

const PIPELINE_EXAMPLES_TEXT = `Pipeline examples (no file needed):

  Simple Q&A:
    dag run --pipeline "input | llm-text-anthropic | text-output" \\
      --input text="What is a DAG?"

  Multi-provider draft-review:
    dag run --pipeline "input | llm-text-openai | llm-text-anthropic | text-output" \\
      --input text="Review this idea: ..."

  Text transform:
    dag run --pipeline "input | text-template | text-output" \\
      --input text="hello" --input template="Translate to French: {{text}}"

  Provider comparison (run separately):
    dag run --pipeline "input | llm-text-anthropic | text-output" --input text="..."
    dag run --pipeline "input | llm-text-openai | text-output" --input text="..."

  Cost check first:
    dag cost estimate --pipeline "input | llm-text-anthropic | text-output" --input text="..."
`;

const RUN_HELP_TEXT = `Usage: dag run <file|url> [options]
       dag run --pipeline "<node> | <node> | ..." [options]
       dag run -p "<node> | <node> | ..." [options]
       dag node example <type> | dag run --stdin [options]

Run a DAG workflow file locally, or run an inline pipeline without a file.

Arguments:
  <file|url>                     Path or URL to a .dag.json or .dag.md workflow file

Pipeline Options:
  --pipeline, -p "<pipe>"        Run an inline pipeline (no file needed)
                                 Example: "input | llm-text-anthropic | text-output"
  --pipeline-examples            Show pipeline usage examples and exit
  --aliases                      List saved pipeline aliases and exit

Options:
  --stdin                        Read the DAG definition from stdin instead of a file
  --input <key=value>            Input value (repeatable)
  --node-config <nodeId.key=value>  Override node config (repeatable)
  --output <pretty|json>         Output format (default: pretty)
  --result                       Print only the final text-output value to stdout
  --timeout <ms>                 Execution timeout in milliseconds (default: 120000)
  --env-file <path>              Load environment variables from file (default: .env)
  --dry-run                      Validate and print the workflow without executing
  --no-progress                  Disable the interactive progress renderer
  --watch                        Re-run automatically when the file changes
  --stream                       Print each node's output immediately as it completes
  --confirm-cost                 Confirm and proceed past the cost guardrail warning
  --max-cost-usd <amount>        Abort if estimated cost exceeds this USD amount
  --no-cost-warning              Skip the cost estimation check entirely
  --no-diff                      In watch mode, disable output diff between runs
  --show-full                    In watch mode, show full diff even when it exceeds ${WATCH_DIFF_MAX_CHANGED_LINES} changed lines
  --frozen                       Abort if any node model differs from dag.lock
  --report-file <path>           Write a Markdown run report to <path> (stdout if omitted)
  --no-cta                       Suppress the post-run next-steps prompt
  --node-file <path>             Load a local node file (.js). Repeatable.
  --no-auto-nodes                Disable automatic *.dag.node.js scanning
  --provider <local>             Runtime backend (default: local; only 'local' is supported).
  --help                         Show this help message

Notes:
  --stream and --output json cannot be used together.
  --watch and --dry-run cannot be used together.
  --watch cannot be combined with --pipeline or --stdin.
  --stdin reads JSON from stdin; comment lines (starting with #) are stripped.
  Cost guardrail: if estimated cost exceeds $0.10 (or --max-cost-usd), the run
  aborts unless --confirm-cost or --no-cost-warning is provided.
  Pipeline aliases are stored in ~/.dag/aliases.json or .dag/aliases.json.
`;

function parseRunArgv(args: readonly string[]): TParseResult {
  const mutableArgs = [...args];

  // --help flag: return early with help text (not a parse error)
  const helpIndex = mutableArgs.indexOf('--help');
  if (helpIndex !== -1) {
    return {
      ok: false,
      exitCode: SUCCESS_EXIT_CODE,
      message: RUN_HELP_TEXT,
      isHelp: true,
    };
  }

  // --pipeline-examples flag: print examples and exit
  const pipelineExamplesIndex = mutableArgs.indexOf('--pipeline-examples');
  if (pipelineExamplesIndex !== -1) {
    return {
      ok: false,
      exitCode: SUCCESS_EXIT_CODE,
      message: PIPELINE_EXAMPLES_TEXT,
      isHelp: true,
    };
  }

  // --dry-run flag
  const dryRunIndex = mutableArgs.indexOf('--dry-run');
  const dryRun = dryRunIndex !== -1;
  if (dryRun) {
    mutableArgs.splice(dryRunIndex, 1);
  }

  // --no-progress flag
  const noProgressIndex = mutableArgs.indexOf('--no-progress');
  const noProgress = noProgressIndex !== -1;
  if (noProgress) {
    mutableArgs.splice(mutableArgs.indexOf('--no-progress'), 1);
  }

  // --watch flag
  const watchIndex = mutableArgs.indexOf('--watch');
  const watchMode = watchIndex !== -1;
  if (watchMode) {
    mutableArgs.splice(mutableArgs.indexOf('--watch'), 1);
  }

  // --stream flag
  const streamIndex = mutableArgs.indexOf('--stream');
  const stream = streamIndex !== -1;
  if (stream) {
    mutableArgs.splice(mutableArgs.indexOf('--stream'), 1);
  }

  // --stdin flag
  const stdinIndex = mutableArgs.indexOf('--stdin');
  const stdinMode = stdinIndex !== -1;
  if (stdinMode) {
    mutableArgs.splice(mutableArgs.indexOf('--stdin'), 1);
  }

  // --confirm-cost flag
  const confirmCostIndex = mutableArgs.indexOf('--confirm-cost');
  const confirmCost = confirmCostIndex !== -1;
  if (confirmCost) {
    mutableArgs.splice(mutableArgs.indexOf('--confirm-cost'), 1);
  }

  // --no-cost-warning flag
  const noCostWarningIndex = mutableArgs.indexOf('--no-cost-warning');
  const noCostWarning = noCostWarningIndex !== -1;
  if (noCostWarning) {
    mutableArgs.splice(mutableArgs.indexOf('--no-cost-warning'), 1);
  }

  // --no-diff flag
  const noDiffIndex = mutableArgs.indexOf('--no-diff');
  const noDiff = noDiffIndex !== -1;
  if (noDiff) {
    mutableArgs.splice(mutableArgs.indexOf('--no-diff'), 1);
  }

  // --show-full flag
  const showFullIndex = mutableArgs.indexOf('--show-full');
  const showFull = showFullIndex !== -1;
  if (showFull) {
    mutableArgs.splice(mutableArgs.indexOf('--show-full'), 1);
  }

  // --frozen flag
  const frozenIndex = mutableArgs.indexOf('--frozen');
  const frozen = frozenIndex !== -1;
  if (frozen) {
    mutableArgs.splice(mutableArgs.indexOf('--frozen'), 1);
  }

  // --no-cta flag
  const noCtaIndex = mutableArgs.indexOf('--no-cta');
  const noCta = noCtaIndex !== -1;
  if (noCta) {
    mutableArgs.splice(mutableArgs.indexOf('--no-cta'), 1);
  }

  // --aliases flag
  const showAliasesIndex = mutableArgs.indexOf('--aliases');
  const showAliases = showAliasesIndex !== -1;
  if (showAliases) {
    mutableArgs.splice(mutableArgs.indexOf('--aliases'), 1);
  }

  // -p short alias for --pipeline (expand to --pipeline before further processing)
  const shortPIndex = mutableArgs.indexOf('-p');
  if (shortPIndex !== -1) {
    mutableArgs.splice(shortPIndex, 1, '--pipeline');
  }

  if (watchMode && dryRun) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: '--watch and --dry-run cannot be used together.',
    };
  }

  // --report-file <path>
  const reportFileResult = takeSingleOption(mutableArgs, '--report-file');
  if (reportFileResult.error) {
    return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: reportFileResult.error };
  }

  // --result flag (shorthand: print only the final text-output value)
  const afterReportFile = reportFileResult.remaining.filter((a) => a !== '--result');
  const resultFlag = afterReportFile.length < reportFileResult.remaining.length;

  // --output <format>
  const outputResult = takeSingleOption(afterReportFile, '--output');
  if (outputResult.error) {
    return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: outputResult.error };
  }
  let outputFormat = outputResult.value ?? OUTPUT_FORMAT_PRETTY;
  if (outputFormat !== OUTPUT_FORMAT_PRETTY && outputFormat !== OUTPUT_FORMAT_JSON) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `--output must be "json" or "pretty".`,
    };
  }
  // --result overrides outputFormat (mutually exclusive with --output json)
  if (resultFlag && outputFormat === OUTPUT_FORMAT_JSON) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: '--result and --output json cannot be used together.',
    };
  }
  if (resultFlag) {
    outputFormat = OUTPUT_FORMAT_RESULT;
  }

  if (stream && outputFormat === OUTPUT_FORMAT_JSON) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: '--stream and --output json cannot be used together.',
    };
  }

  // --timeout <ms>
  const timeoutResult = takeSingleOption(outputResult.remaining, '--timeout');
  if (timeoutResult.error) {
    return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: timeoutResult.error };
  }
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (timeoutResult.value !== undefined) {
    const parsed = Number(timeoutResult.value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: '--timeout must be a positive number.',
      };
    }
    timeoutMs = parsed;
  }

  // --env-file <path>
  const envFileResult = takeSingleOption(timeoutResult.remaining, '--env-file');
  if (envFileResult.error) {
    return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: envFileResult.error };
  }

  // --pipeline <string>
  const pipelineResult = takeSingleOption(envFileResult.remaining, '--pipeline');
  if (pipelineResult.error) {
    return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: pipelineResult.error };
  }
  const pipeline = pipelineResult.value;

  if (pipeline !== undefined && watchMode) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: '--watch cannot be combined with --pipeline.',
    };
  }

  // --max-cost-usd <amount>
  const maxCostResult = takeSingleOption(pipelineResult.remaining, '--max-cost-usd');
  if (maxCostResult.error) {
    return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: maxCostResult.error };
  }
  let maxCostUsd: number | undefined;
  if (maxCostResult.value !== undefined) {
    const parsedCost = parseFloat(maxCostResult.value);
    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: '--max-cost-usd must be a non-negative number.',
      };
    }
    maxCostUsd = parsedCost;
  }

  // --input key=value (repeatable)
  const inputResult = collectStringOptions(maxCostResult.remaining, '--input');
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

  // --node-config nodeId.key=value (repeatable)
  const nodeConfigResult = collectStringOptions(inputResult.remaining, '--node-config');
  for (const raw of nodeConfigResult.values) {
    const dotIndex = raw.indexOf('.');
    const eqIndex = raw.indexOf('=');
    if (dotIndex <= 0 || eqIndex <= dotIndex) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: `--node-config value must be in nodeId.key=value format, got: "${raw}".`,
      };
    }
  }
  const nodeConfigs: ReadonlyArray<string> = nodeConfigResult.values;

  // --output-key nodeId.portKey (repeatable)
  const outputKeyResult = collectStringOptions(nodeConfigResult.remaining, '--output-key');
  for (const raw of outputKeyResult.values) {
    if (!raw.includes('.')) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: `--output-key value must be in nodeId.portKey format, got: "${raw}".`,
      };
    }
  }
  const outputKeys: ReadonlyArray<string> = outputKeyResult.values;

  // --save-as <name>
  const saveAsResult = takeSingleOption(outputKeyResult.remaining, '--save-as');
  if (saveAsResult.error) {
    return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: saveAsResult.error };
  }
  const saveAsName = saveAsResult.value;
  if (saveAsName !== undefined && !/^[a-zA-Z0-9_-]+$/.test(saveAsName)) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `--save-as name must contain only letters, numbers, hyphens, and underscores.`,
    };
  }

  // --save-as-draft flag
  const saveAsDraftIdx = saveAsResult.remaining.indexOf('--save-as-draft');
  const saveAsDraft = saveAsDraftIdx !== -1;
  const afterSaveAsDraft = saveAsDraft
    ? saveAsResult.remaining.filter((a) => a !== '--save-as-draft')
    : saveAsResult.remaining;

  // --no-auto-nodes flag
  const noAutoNodesIdx = afterSaveAsDraft.indexOf('--no-auto-nodes');
  const noAutoNodes = noAutoNodesIdx !== -1;
  const afterNoAutoNodes = noAutoNodes
    ? afterSaveAsDraft.filter((a) => a !== '--no-auto-nodes')
    : afterSaveAsDraft;

  // --tui flag
  const tuiIdx = afterNoAutoNodes.indexOf('--tui');
  const tuiMode = tuiIdx !== -1;
  const afterTui = tuiMode ? afterNoAutoNodes.filter((a) => a !== '--tui') : afterNoAutoNodes;

  // --node-file <path> (repeatable)
  const nodeFileResult = collectStringOptions(afterTui, '--node-file');

  // --provider <local>
  const providerResult = takeSingleOption(nodeFileResult.remaining, '--provider');
  if (providerResult.error) {
    return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: providerResult.error };
  }

  // --server-url <url>
  const serverUrlResult = takeSingleOption(providerResult.remaining, '--server-url');
  if (serverUrlResult.error) {
    return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: serverUrlResult.error };
  }

  // Positional: file (first non-flag argument)
  const positional = serverUrlResult.remaining.filter((a) => !a.startsWith('--'));
  const unknownFlags = serverUrlResult.remaining.filter((a) => a.startsWith('--'));

  if (unknownFlags.length > 0) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `run received unexpected flags: ${unknownFlags.join(' ')}.`,
    };
  }

  if (stdinMode && watchMode) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: '--stdin and --watch cannot be used together.',
    };
  }

  if (stdinMode && pipeline !== undefined) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: '--stdin and --pipeline cannot be used together.',
    };
  }

  // Require either a file positional, --pipeline, or --stdin
  if (pipeline === undefined && !stdinMode) {
    const file = positional[0];
    if (!file) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: `run requires <file|url>, --pipeline, or --stdin.\n\nQuick start:\n  dag run --pipeline "input | llm-text-anthropic | text-output" --input text="Hello"\n  dag run --pipeline-examples`,
      };
    }
    if (positional.length > 1) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: `run received unexpected positional arguments: ${positional.slice(1).join(' ')}.`,
      };
    }
    return {
      ok: true,
      value: {
        file,
        pipeline: undefined,
        stdinMode,
        inputs,
        outputFormat,
        timeoutMs,
        envFilePath: envFileResult.value,
        dryRun,
        noProgress,
        watchMode,
        stream,
        confirmCost,
        maxCostUsd,
        noCostWarning,
        noDiff,
        showFull,
        reportFile: reportFileResult.value,
        frozen,
        noCta,
        showAliases,
        nodeConfigs,
        outputKeys,
        saveAsName,
        saveAsDraft,
        nodeFiles: nodeFileResult.values,
        noAutoNodes,
        tuiMode,
        provider: providerResult.value,
        serverUrl: serverUrlResult.value,
      },
    };
  }

  if (stdinMode) {
    // stdin mode: no positional file expected
    if (positional.length > 0) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: `run received unexpected positional arguments when --stdin is set: ${positional.join(' ')}.`,
      };
    }
    return {
      ok: true,
      value: {
        file: undefined,
        pipeline: undefined,
        stdinMode,
        inputs,
        outputFormat,
        timeoutMs,
        envFilePath: envFileResult.value,
        dryRun,
        noProgress,
        watchMode,
        stream,
        confirmCost,
        maxCostUsd,
        noCostWarning,
        noDiff,
        showFull,
        reportFile: reportFileResult.value,
        frozen,
        noCta,
        showAliases,
        nodeConfigs,
        outputKeys,
        saveAsName,
        saveAsDraft,
        nodeFiles: nodeFileResult.values,
        noAutoNodes,
        tuiMode,
        provider: providerResult.value,
        serverUrl: serverUrlResult.value,
      },
    };
  }

  // pipeline mode: no positional file expected
  if (positional.length > 0) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `run received unexpected positional arguments when --pipeline is set: ${positional.join(' ')}.`,
    };
  }

  return {
    ok: true,
    value: {
      file: undefined,
      pipeline,
      stdinMode,
      inputs,
      outputFormat,
      timeoutMs,
      envFilePath: envFileResult.value,
      dryRun,
      noProgress,
      watchMode,
      stream,
      confirmCost,
      maxCostUsd,
      noCostWarning,
      noDiff,
      showFull,
      reportFile: reportFileResult.value,
      frozen,
      noCta,
      showAliases,
      nodeConfigs,
      outputKeys,
      saveAsName,
      saveAsDraft,
      nodeFiles: nodeFileResult.values,
      noAutoNodes,
      tuiMode,
      provider: providerResult.value,
      serverUrl: serverUrlResult.value,
    },
  };
}

/**
 * Infer the value type from a raw string.
 * "true"/"false" → boolean, numeric strings → number, else string.
 */
function inferConfigValue(raw: string): string | number | boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const n = Number(raw);
  if (!Number.isNaN(n) && raw.trim() !== '') return n;
  return raw;
}

/** Shape of a configSchema's properties map as used for unknown-key validation. */
interface IConfigSchemaWithProperties {
  readonly properties?: Record<string, unknown>;
}

/**
 * Apply `--node-config nodeId.key=value` overrides to the matching nodes in a DAG definition.
 * Warns on unknown node IDs and unknown config keys; unknown keys are ignored.
 * Returns a new IDagDefinition with the updated nodes array.
 */
function applyNodeConfigs(
  definition: IDagDefinition,
  nodeConfigs: ReadonlyArray<string>,
  manifests: ReadonlyMap<string, IConfigSchemaWithProperties>,
  io: IDagCliIo,
): IDagDefinition {
  if (nodeConfigs.length === 0) return definition;

  // Build a mutable map of nodeId → config overrides.
  const overridesMap = new Map<string, Record<string, unknown>>();

  for (const raw of nodeConfigs) {
    const dotIndex = raw.indexOf('.');
    const eqIndex = raw.indexOf('=');
    // Format already validated in parseRunArgv; defensive guard here.
    if (dotIndex <= 0 || eqIndex <= dotIndex) continue;

    const nodeId = raw.slice(0, dotIndex);
    const key = raw.slice(dotIndex + 1, eqIndex);
    const valueRaw = raw.slice(eqIndex + 1);

    // Warn if node not found in definition.
    const nodeExists = definition.nodes.some((n) => n.nodeId === nodeId);
    if (!nodeExists) {
      io.writeError(`⚠ --node-config: node "${nodeId}" not found — skipped\n`);
      continue;
    }

    // Validate key against configSchema if manifest is available.
    const nodeType = definition.nodes.find((n) => n.nodeId === nodeId)?.nodeType;
    if (nodeType !== undefined) {
      const manifest = manifests.get(nodeType);
      if (manifest?.properties !== undefined) {
        const knownKeys = Object.keys(manifest.properties);
        if (!knownKeys.includes(key)) {
          io.writeError(`⚠ ${nodeId}: unknown config key "${key}" — ignored\n`);
          continue;
        }
      }
    }

    const existing = overridesMap.get(nodeId) ?? {};
    existing[key] = inferConfigValue(valueRaw);
    overridesMap.set(nodeId, existing);
  }

  if (overridesMap.size === 0) return definition;

  const updatedNodes: IDagNode[] = definition.nodes.map((node) => {
    const overrides = overridesMap.get(node.nodeId);
    if (overrides === undefined) return node;
    return {
      ...node,
      config: { ...(node.config as Record<string, unknown>), ...overrides } as INodeConfigObject,
    };
  });

  return { ...definition, nodes: updatedNodes };
}

/**
 * Convert a pipeline string like "input | llm-text-anthropic | text-output"
 * into an IDagDefinition ready for LocalDagRunner.
 *
 * Pipe syntax: nodes separated by " | " or "|" with optional spaces.
 */
function buildDagFromPipeline(
  pipelineStr: string,
  manifests: ReadonlyArray<{
    nodeType: string;
    defaultInputPort?: string;
    defaultOutputPort?: string;
  }>,
):
  | { readonly ok: true; readonly definition: IDagDefinition }
  | { readonly ok: false; readonly message: string } {
  const parseResult = parsePipelineSpec(pipelineStr);
  if (!parseResult.ok) {
    return { ok: false, message: parseResult.message };
  }

  const knownTypes = new Map(manifests.map((m) => [m.nodeType, m]));
  const typeCounts = new Map<string, number>();

  const resolved: Array<{
    nodeId: string;
    nodeType: string;
    config: Record<string, string | number | boolean>;
  }> = [];
  for (const nodeSpec of parseResult.nodes) {
    const { nodeType, config } = nodeSpec;
    if (!knownTypes.has(nodeType)) {
      const available = manifests.map((m) => m.nodeType).join(', ');
      return { ok: false, message: `Unknown node type "${nodeType}". Available: ${available}` };
    }
    const count = typeCounts.get(nodeType) ?? 0;
    typeCounts.set(nodeType, count + 1);
    const nodeId = count === 0 ? nodeType : `${nodeType}-${count}`;
    resolved.push({ nodeId, nodeType, config });
  }

  const dagEdges: IDagEdgeDefinition[] = [];
  const dependsOnMap = new Map<string, string[]>();
  for (const n of resolved) {
    dependsOnMap.set(n.nodeId, []);
  }

  for (let i = 0; i < resolved.length - 1; i++) {
    const from = resolved[i];
    const to = resolved[i + 1];
    const fromManifest = knownTypes.get(from.nodeType);
    const toManifest = knownTypes.get(to.nodeType);
    const resolvedFromPort = fromManifest?.defaultOutputPort;
    const resolvedToPort = toManifest?.defaultInputPort;

    if (resolvedFromPort && resolvedToPort) {
      dagEdges.push({
        from: from.nodeId,
        to: to.nodeId,
        bindings: [{ outputKey: resolvedFromPort, inputKey: resolvedToPort }],
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

  const dagNodes: IDagNode[] = resolved.map((n, index) => ({
    nodeId: n.nodeId,
    nodeType: n.nodeType,
    dependsOn: dependsOnMap.get(n.nodeId) ?? [],
    config: n.config as unknown as INodeConfigObject,
    position: { x: index * NODE_X_SPACING, y: 0 },
  }));

  const definition: IDagDefinition = {
    dagId: 'pipeline-inline',
    version: 1,
    status: 'draft',
    nodes: dagNodes,
    edges: dagEdges,
  };

  return { ok: true, definition };
}

/**
 * Parse a `.env`-style file and apply entries to process.env.
 * Silently skips if the file does not exist.
 * Only sets keys that are not already present in process.env.
 */
export async function applyEnvFile(filePath: string): Promise<void> {
  let content: string;
  try {
    content = await readFile(filePath, UTF8_ENCODING);
  } catch {
    // allow-fallback: env file is optional; missing file is silently skipped
    return;
  }

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    const rawValue = line.slice(eqIndex + 1).trim();
    // Strip surrounding quotes if present.
    const value =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;

    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function resolveErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Read all bytes from stdin and return them as a UTF-8 string.
 * Used when `--stdin` flag is provided.
 */
async function readStdin(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', (stdinErr: Error) => reject(stdinErr));
    process.stdin.resume();
  });
}

type TDagLoadResult =
  | { readonly ok: true; readonly value: IDagDefinition }
  | { readonly ok: false; readonly message: string; readonly exitCode: number };

/**
 * Parse a DAG definition from raw JSON text (used for stdin input).
 * Strips comment lines (lines starting with `#`) before parsing —
 * this lets output from `dag node example` be piped directly.
 */
function parseDagJsonText(text: string, source: string): TDagLoadResult {
  const stripped = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped) as unknown;
  } catch (parseErr) {
    // allow-fallback: JSON parse error is converted to a structured error result
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `Failed to parse JSON from ${source}: ${resolveErrorMessage(parseErr)}`,
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `DAG from ${source} must be a JSON object.`,
    };
  }

  if (isWorkflowFileFormat(parsed)) {
    return { ok: true, value: fromDagWorkflowFile(parsed, undefined) };
  }

  return { ok: true, value: parsed as IDagDefinition };
}

/**
 * Fetch a DAG definition from a remote URL (http/https).
 * Parses the response body as JSON; does not support the .dag.md format.
 */
async function fetchDagFromUrl(url: string): Promise<TDagLoadResult> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (fetchErr) {
    // allow-fallback: network error is converted to a structured error result
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `Failed to fetch "${url}": ${resolveErrorMessage(fetchErr)}`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `Failed to fetch "${url}": HTTP ${response.status} ${response.statusText}`,
    };
  }

  let text: string;
  try {
    text = await response.text();
  } catch (bodyErr) {
    // allow-fallback: response body read error is converted to a structured error result
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `Failed to read response from "${url}": ${resolveErrorMessage(bodyErr)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (parseErr) {
    // allow-fallback: JSON parse error is converted to a structured error result
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `Failed to parse JSON from "${url}": ${resolveErrorMessage(parseErr)}`,
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `DAG from "${url}" must be a JSON object.`,
    };
  }

  // New workflow file format: auto-detect and convert (no companion for remote URLs).
  if (isWorkflowFileFormat(parsed)) {
    return { ok: true, value: fromDagWorkflowFile(parsed, undefined) };
  }

  // Legacy IDagDefinition format -- use as-is.
  return { ok: true, value: parsed as IDagDefinition };
}

/**
 * Read and parse a `.dag.json` or `.dag.md` file into an `IDagDefinition`.
 */
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

  // New workflow file format: auto-detect and convert, reading companion if present.
  if (isWorkflowFileFormat(parsed)) {
    const companion = await tryReadCompanion(filePath, io);
    return { ok: true, value: fromDagWorkflowFile(parsed, companion ?? undefined) };
  }

  // Legacy IDagDefinition format -- use as-is.
  return { ok: true, value: parsed as IDagDefinition };
}

/** Derive the companion path for a .dag.json file and try to read it. Returns null on any error. */
async function tryReadCompanion(
  dagFilePath: string,
  io: IDagCliIo,
): Promise<IDagRobotaCompanion | null> {
  const companionPath = dagFilePath.replace(/\.dag\.json$/, '.dag.robota.json');
  if (companionPath === dagFilePath) return null;
  let text: string;
  try {
    // allow-fallback: companion file is optional -- file-not-found is the expected case
    text = await io.readTextFile(companionPath);
  } catch (_err) {
    // allow-fallback: companion absent
    return null;
  }
  try {
    return JSON.parse(text) as IDagRobotaCompanion;
  } catch (err) {
    // allow-fallback: DX-001 — malformed companion JSON is non-fatal; warn and skip overrides
    io.writeError(
      `⚠ companion file "${companionPath}" contains invalid JSON — overrides skipped\n` +
        `  ${(err as Error).message}\n`,
    );
    return null;
  }
}

/**
 * Build a `TPortPayload` from the flat string map produced by `--input key=value` flags.
 * Each value is stored under its key directly as a string.
 */
function buildInputPayload(inputs: Record<string, string>): TPortPayload {
  const payload: TPortPayload = {};
  for (const [key, value] of Object.entries(inputs)) {
    payload[key] = value;
  }
  return payload;
}

/**
 * Attempt to parse a task run's outputSnapshot JSON.
 * Returns an empty object if the snapshot is absent or malformed.
 */
function parseOutputSnapshot(snapshot: string | undefined): Record<string, unknown> {
  if (!snapshot) return {};
  try {
    const parsed = JSON.parse(snapshot) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    // allow-fallback: outputSnapshot is advisory display data; malformed values are skipped gracefully
    return {};
  }
}

function collectOutputs(result: ILocalRunResult): Record<string, unknown> {
  const outputs: Record<string, unknown> = {};
  for (const taskRun of result.taskRuns) {
    const snapshot = parseOutputSnapshot(taskRun.outputSnapshot);
    for (const [k, v] of Object.entries(snapshot)) {
      outputs[`${taskRun.nodeId}.${k}`] = v;
    }
  }
  return outputs;
}

const PORT_ERROR_PATTERNS: RegExp[] = [
  /required input port/i,
  /input port .+ is missing/i,
  /type mismatch/i,
];

/** Returns true when `message` describes a port-level error. */
export function parsePortError(message: string): boolean {
  return PORT_ERROR_PATTERNS.some((p) => p.test(message));
}

function printPortErrorHint(nodeType: string, manifest: INodeManifest, io: IDagCliIo): void {
  io.writeError(`\n  → ${nodeType} expects:\n`);
  if (manifest.inputs.length > 0) {
    io.writeError(`      Inputs:\n`);
    for (const port of manifest.inputs) {
      const req = port.required ? ', required' : ', optional';
      io.writeError(`        ${port.key} (${port.type}${req})\n`);
    }
  }
  if (manifest.outputs.length > 0) {
    io.writeError(`      Outputs:\n`);
    for (const port of manifest.outputs) {
      const req = port.required ? ', required' : ', optional';
      io.writeError(`        ${port.key} (${port.type}${req})\n`);
    }
  }
  io.writeError(`    Tip: dag node info ${nodeType}  for full details\n`);
  io.writeError(
    `    Tip: run 'dag validate <file>' to catch port type mismatches before running.\n`,
  );
}

function formatPrettyOutput(
  filePath: string,
  result: ILocalRunResult,
  startMs: number,
  endMs: number,
  io: IDagCliIo,
  dagDefinition?: IDagDefinition,
): void {
  const totalMs = endMs - startMs;
  const CHECK = '✓';
  const CROSS = '✗';

  // Build manifest map once if dagDefinition is provided (for port error hints)
  let manifestMap: Map<string, INodeManifest> | null = null;
  if (dagDefinition) {
    const assemblyResult = buildNodeDefinitionAssembly(createCliNodeRegistry()); // allow-fallback: uses built-in registry for display-only hints; local nodes already loaded
    if (assemblyResult.ok) {
      manifestMap = new Map(assemblyResult.value.manifests.map((m) => [m.nodeType, m]));
    }
  }

  const nodeTypeById = dagDefinition
    ? new Map(dagDefinition.nodes.map((n) => [n.nodeId, n.nodeType]))
    : null;

  io.write(`Running: ${filePath}\n`);
  for (const taskRun of result.taskRuns) {
    const isOk = taskRun.status === 'success' || taskRun.status === 'skipped';
    const icon = isOk ? CHECK : CROSS;
    io.write(`  ${icon} ${taskRun.nodeId}   [${taskRun.status}]\n`);
    if (!isOk && taskRun.errorMessage) {
      io.writeError(`    Error: ${taskRun.errorMessage}\n`);
      if (manifestMap && nodeTypeById && parsePortError(taskRun.errorMessage)) {
        const nodeType = nodeTypeById.get(taskRun.nodeId);
        const manifest = nodeType ? manifestMap.get(nodeType) : undefined;
        if (nodeType && manifest) {
          printPortErrorHint(nodeType, manifest, io);
        }
      }
    }
  }

  io.write(`\nCompleted in ${totalMs}ms\n`);

  const outputs = collectOutputs(result);
  if (Object.keys(outputs).length > 0) {
    io.write('\nOutputs:\n');
    for (const [key, value] of Object.entries(outputs)) {
      const displayValue = typeof value === 'string' ? value : JSON.stringify(value);
      io.write(`  ${key}: ${displayValue}\n`);
    }
  }
}

/**
 * Extract the final text output from a run result.
 * Returns the `text` port value of the last `text-output` node,
 * or the last successful node's default output port value, or null.
 */
export function extractFinalOutput(
  taskRuns: ILocalRunResult['taskRuns'],
  nodes: IDagDefinition['nodes'],
): string | null {
  const textOutputNodeIds = nodes.filter((n) => n.nodeType === 'text-output').map((n) => n.nodeId);

  for (let i = textOutputNodeIds.length - 1; i >= 0; i--) {
    const nodeId = textOutputNodeIds[i];
    if (nodeId === undefined) continue;
    const taskRun = taskRuns.find((t) => t.nodeId === nodeId && t.status === 'success');
    if (!taskRun) continue;
    const snapshot = parseOutputSnapshot(taskRun.outputSnapshot);
    const text = snapshot['text'];
    if (typeof text === 'string') return text;
  }

  // Fallback: last successful node's first string output
  for (let i = taskRuns.length - 1; i >= 0; i--) {
    const taskRun = taskRuns[i];
    if (!taskRun || taskRun.status !== 'success') continue;
    const snapshot = parseOutputSnapshot(taskRun.outputSnapshot);
    for (const val of Object.values(snapshot)) {
      if (typeof val === 'string' && !val.startsWith('Input:') && !val.startsWith('Output:')) {
        return val;
      }
    }
  }
  return null;
}

function formatJsonRunOutput(
  result: ILocalRunResult,
  startMs: number,
  endMs: number,
  dag: IDagDefinition,
  io: IDagCliIo,
): void {
  const durationMs = endMs - startMs;
  const outputs = collectOutputs(result);
  const finalOutput = extractFinalOutput(result.taskRuns, dag.nodes);

  const jsonResult = {
    ok: result.dagRun.status === 'success',
    dagRunId: result.dagRun.dagRunId,
    durationMs,
    finalOutput,
    outputs,
    nodes: result.taskRuns.map((tr) => ({
      nodeId: tr.nodeId,
      status: tr.status,
    })),
  };

  io.write(`${JSON.stringify(jsonResult, null, JSON_INDENT_SPACES)}\n`);
}

// ---------------------------------------------------------------------------
// Cost estimation helpers (heuristic, same model as cost.ts)
// ---------------------------------------------------------------------------

const CHARS_PER_TOKEN = 4;
const ESTIMATED_OUTPUT_TOKENS_HEURISTIC = 200;
const DEFAULT_MAX_COST_USD = 0.1;

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

function getNodeModelString(node: IDagNode): string | undefined {
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

function estimateNodeCostUsd(node: IDagNode, inputTextChars: number): number {
  const { nodeType } = node;
  if (NO_API_NODE_TYPES.has(nodeType)) return 0;
  const inputTokens = Math.ceil(inputTextChars / CHARS_PER_TOKEN);
  const model = getNodeModelString(node);
  if (nodeType === 'llm-text-anthropic') {
    const modelStr = model ?? 'claude-haiku-4-5';
    const isSonnet =
      modelStr.includes('sonnet') || modelStr.includes('claude-3') || modelStr.includes('opus');
    const inRate = isSonnet ? 0.003 : 0.00025;
    const outRate = isSonnet ? 0.015 : 0.00125;
    return (inputTokens / 1000) * inRate + (ESTIMATED_OUTPUT_TOKENS_HEURISTIC / 1000) * outRate;
  }
  if (nodeType === 'llm-text-openai') {
    const modelStr = model ?? 'gpt-4o-mini';
    const isGpt4o = modelStr.includes('gpt-4o') && !modelStr.includes('mini');
    const inRate = isGpt4o ? 0.005 : 0.00015;
    const outRate = isGpt4o ? 0.015 : 0.0006;
    return (inputTokens / 1000) * inRate + (ESTIMATED_OUTPUT_TOKENS_HEURISTIC / 1000) * outRate;
  }
  if (nodeType === 'llm-text-gemini') {
    const modelStr = model ?? 'gemini-1.5-flash';
    const isPro = modelStr.includes('pro');
    const inRate = isPro ? 0.00125 : 0.000075;
    const outRate = isPro ? 0.005 : 0.0003;
    return (inputTokens / 1000) * inRate + (ESTIMATED_OUTPUT_TOKENS_HEURISTIC / 1000) * outRate;
  }
  // Unknown API node — conservative heuristic.
  return 0.001;
}

interface ICostGuardrailInfo {
  readonly totalUsd: number;
  readonly llmNodeCount: number;
}

function estimateDagCost(
  dagDefinition: IDagDefinition,
  inputs: Record<string, string>,
): ICostGuardrailInfo {
  const inputTextChars = Object.values(inputs).reduce((sum, v) => sum + v.length, 0);
  let totalUsd = 0;
  let llmNodeCount = 0;
  for (const node of dagDefinition.nodes) {
    const cost = estimateNodeCostUsd(node, inputTextChars);
    totalUsd += cost;
    if (cost > 0) llmNodeCount += 1;
  }
  return { totalUsd, llmNodeCount };
}

/**
 * Check the cost guardrail before execution.
 * Returns a non-zero exit code if the run should abort, or null to proceed.
 */
function checkCostGuardrail(
  dagDefinition: IDagDefinition,
  inputs: Record<string, string>,
  confirmCost: boolean,
  maxCostUsd: number | undefined,
  noCostWarning: boolean,
  io: IDagCliIo,
): number | null {
  const isCi = process.env['CI'] === 'true';
  const hardLimit = maxCostUsd;

  // No guardrail needed (soft-check skipped in CI or when disabled).
  if (hardLimit === undefined && (noCostWarning || isCi)) {
    return null;
  }

  const { totalUsd, llmNodeCount } = estimateDagCost(dagDefinition, inputs);
  const effectiveLimit = hardLimit ?? DEFAULT_MAX_COST_USD;

  if (totalUsd <= effectiveLimit) {
    return null;
  }

  // Hard limit exceeded — always abort, even with --confirm-cost.
  if (hardLimit !== undefined) {
    io.write(
      `⚠  Estimated cost ~$${totalUsd.toFixed(4)} exceeds --max-cost-usd $${hardLimit.toFixed(2)}. Aborting.\n`,
    );
    return USAGE_ERROR_EXIT_CODE;
  }

  // Soft warning — show hint and abort unless --confirm-cost was given.
  io.write(
    `⚠  Estimated cost: ~$${totalUsd.toFixed(4)} (${llmNodeCount} LLM node${llmNodeCount !== 1 ? 's' : ''})\n`,
  );
  io.write(`   Proceed:      dag run <file> --confirm-cost\n`);
  io.write(`   Set limit:    dag run <file> --max-cost-usd ${(totalUsd * 2).toFixed(2)}\n`);
  io.write(`   Disable:      dag run <file> --no-cost-warning\n`);

  if (!confirmCost) {
    return USAGE_ERROR_EXIT_CODE;
  }

  return null;
}

interface IRunOnceOutcome {
  readonly exitCode: number;
  /** Raw run result, or null if the run failed before producing a result. */
  readonly result: ILocalRunResult | null;
}

/**
 * Execute a single DAG run (shared by normal and watch-mode paths).
 * Returns the exit code and the raw run result for this individual run.
 */
async function runOnce(
  dagDefinition: IDagDefinition,
  runner: LocalDagRunner,
  inputPayload: TPortPayload,
  outputFormat: string,
  noProgress: boolean,
  stream: boolean,
  filePath: string,
  io: IDagCliIo,
  timeoutMs: number,
  outputKeys: ReadonlyArray<string> = [],
  tuiMode = false,
): Promise<IRunOnceOutcome> {
  // Determine which renderer to use (mutually exclusive, checked in priority order):
  // - --stream: StreamLogRenderer (node-by-node output as each completes)
  // - JSON output: no renderer (results printed at end)
  // - --tui + TTY + not CI: TuiRenderer (live ASCII flow diagram)
  // - pretty + TTY + not CI + not --no-progress: interactive RunProgressRenderer
  // - pretty + non-TTY or CI or --no-progress: timestamped PlainLogRenderer
  const useStream = stream && outputFormat === OUTPUT_FORMAT_PRETTY;
  // Suppress progress renderers when machine-readable output is requested
  const suppressRenderers = outputKeys.length > 0;
  const isTty = !!process.stdout.isTTY;
  const isCi = process.env['CI'] === 'true';
  const useTui =
    tuiMode &&
    !useStream &&
    !suppressRenderers &&
    outputFormat === OUTPUT_FORMAT_PRETTY &&
    isTty &&
    !isCi;
  const usePlainLog =
    !useTui &&
    !useStream &&
    !suppressRenderers &&
    outputFormat === OUTPUT_FORMAT_PRETTY &&
    (noProgress || !isTty || isCi);
  const usePrettyRenderer =
    !useTui &&
    !useStream &&
    !suppressRenderers &&
    outputFormat === OUTPUT_FORMAT_PRETTY &&
    !noProgress &&
    isTty &&
    !isCi;

  const streamRenderer: StreamLogRenderer | null = useStream ? new StreamLogRenderer(io) : null;
  const tuiRenderer: TuiRenderer | null = useTui ? new TuiRenderer(io, dagDefinition) : null;
  const renderer: RunProgressRenderer | PlainLogRenderer | null = usePrettyRenderer
    ? new RunProgressRenderer(io)
    : usePlainLog
      ? new PlainLogRenderer(io)
      : null;

  streamRenderer?.attach(runner.events, filePath);
  tuiRenderer?.attach(runner.events, filePath);
  renderer?.attach(runner.events, filePath);

  const startMs = Date.now();

  let result: ILocalRunResult;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`DAG run timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    });

    result = await Promise.race([runner.run(dagDefinition, inputPayload), timeoutPromise]);
  } catch (runErr) {
    // allow-fallback: execution error is reported as structured output and non-zero exit code
    streamRenderer?.detach();
    tuiRenderer?.detach();
    renderer?.detach();
    const endMs = Date.now();
    const msg = resolveErrorMessage(runErr);
    if (outputFormat === OUTPUT_FORMAT_JSON) {
      const errorResult = {
        ok: false,
        durationMs: endMs - startMs,
        error: msg,
      };
      io.write(`${JSON.stringify(errorResult, null, JSON_INDENT_SPACES)}\n`);
    } else {
      io.writeError(`Error: ${msg}\n`);
    }
    return { exitCode: FAILURE_EXIT_CODE, result: null };
  }

  streamRenderer?.detach();
  tuiRenderer?.detach();
  renderer?.detach();
  const endMs = Date.now();

  if (useStream) {
    streamRenderer?.onComplete(endMs - startMs);
  } else if (outputKeys.length > 0) {
    // Build full output map: "nodeId.portKey" → value
    const allOutputs: Record<string, unknown> = {};
    for (const taskRun of result.taskRuns) {
      const snapshot = parseOutputSnapshot(taskRun.outputSnapshot);
      for (const [k, v] of Object.entries(snapshot)) {
        allOutputs[`${taskRun.nodeId}.${k}`] = v;
      }
    }
    if (outputKeys.length === 1) {
      const key = outputKeys[0] as string;
      const val = allOutputs[key];
      if (val === undefined) {
        io.writeError(`Error: output key "${key}" not found in run result.\n`);
        return { exitCode: FAILURE_EXIT_CODE, result };
      }
      io.write(String(val));
    } else {
      const picked = Object.fromEntries(outputKeys.map((k) => [k, allOutputs[k] ?? null]));
      io.write(`${JSON.stringify(picked, null, JSON_INDENT_SPACES)}\n`);
    }
  } else if (outputFormat === OUTPUT_FORMAT_RESULT) {
    const finalText = extractFinalOutput(result.taskRuns, dagDefinition.nodes);
    if (finalText !== null) {
      io.write(finalText);
    } else {
      io.writeError('Error: no text-output found in run result.\n');
    }
  } else if (outputFormat === OUTPUT_FORMAT_JSON) {
    formatJsonRunOutput(result, startMs, endMs, dagDefinition, io);
  } else {
    formatPrettyOutput(filePath, result, startMs, endMs, io, dagDefinition);
  }

  const exitCode = result.dagRun.status === 'success' ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE;
  return { exitCode, result };
}

// ---------------------------------------------------------------------------
// DX-013: Markdown run report generation
// ---------------------------------------------------------------------------

const REPORT_OUTPUT_PREVIEW_CHARS = 60;

/**
 * Build a Markdown run report from a completed run result.
 * Used by `dag run --report-file <path>`.
 */
function buildRunReport(
  label: string,
  result: ILocalRunResult,
  dagDefinition: IDagDefinition,
  inputs: Record<string, string>,
  startTime: string,
): string {
  const isSuccess = result.dagRun.status === 'success';
  const statusIcon = isSuccess ? '✓ Success' : '✗ Failed';

  // Collect per-node durations and outputs.
  const nodeRows: string[] = [];
  const finalOutputParts: string[] = [];

  for (const taskRun of result.taskRuns) {
    const isOk = taskRun.status === 'success' || taskRun.status === 'skipped';
    const icon = isOk ? '✓' : '✗';
    const snapshot = parseOutputSnapshot(taskRun.outputSnapshot);
    let preview = '';
    for (const val of Object.values(snapshot)) {
      if (typeof val === 'string') {
        preview = val.slice(0, REPORT_OUTPUT_PREVIEW_CHARS);
        if (val.length > REPORT_OUTPUT_PREVIEW_CHARS) preview += '...';
        finalOutputParts.push(val);
        break;
      }
    }
    const nodeId = taskRun.nodeId.padEnd(16);
    const status = taskRun.status.padEnd(7);
    const previewCell = preview ? `"${preview}"` : '';
    nodeRows.push(`| ${nodeId} | ${icon} ${status} | —    | ${previewCell} |`);
  }

  // Estimate cost from dag definition and inputs.
  const { totalUsd } = estimateDagCost(dagDefinition, inputs);
  const costStr = totalUsd > 0 ? `~$${totalUsd.toFixed(4)}` : '$0.000';

  const finalOutput = finalOutputParts.join('\n\n');

  const lines: string[] = [
    '# Pipeline Run Report',
    '',
    `**DAG:** ${label}`,
    `**Status:** ${statusIcon}`,
    `**Cost:** ${costStr}`,
    `**Timestamp:** ${startTime}`,
    '',
    '## Node Execution',
    '',
    '| Node             | Status  | Duration | Output Preview                       |',
    '|------------------|---------|----------|--------------------------------------|',
    ...nodeRows,
    '',
  ];

  if (finalOutput) {
    lines.push('## Final Output', '', finalOutput, '');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// SOCIAL-001: Post-run CTA helpers
// ---------------------------------------------------------------------------

const RUN_COUNT_FILE = join('.dag', '.run-count');
const RUN_HISTORY_FILE = join('.dag', '.run-history.json');
const MAX_HISTORY_ENTRIES = 50; // eslint-disable-line @typescript-eslint/no-magic-numbers

interface IRunHistoryEntry {
  file: string;
  date: string;
  status: 'success' | 'failed';
}

export async function appendRunHistory(file: string, status: 'success' | 'failed'): Promise<void> {
  let entries: IRunHistoryEntry[] = [];
  try {
    const text = await readFile(RUN_HISTORY_FILE, UTF8_ENCODING);
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) entries = parsed as IRunHistoryEntry[];
  } catch (_histReadErr) {
    // allow-fallback: missing or corrupt history file starts fresh
    void _histReadErr;
  }
  entries.push({ file, date: new Date().toISOString(), status });
  if (entries.length > MAX_HISTORY_ENTRIES) entries = entries.slice(-MAX_HISTORY_ENTRIES);
  try {
    await mkdir('.dag', { recursive: true });
    await writeFile(RUN_HISTORY_FILE, JSON.stringify(entries, null, 2) + '\n', UTF8_ENCODING);
  } catch (_histWriteErr) {
    // allow-fallback: run history write failure is non-fatal
    void _histWriteErr;
  }
}

/**
 * Read the current run count from .dag/.run-count.
 * Returns 0 if the file does not exist or cannot be read.
 */
async function readRunCount(): Promise<number> {
  try {
    const text = await readFile(RUN_COUNT_FILE, UTF8_ENCODING);
    const n = parseInt(text.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    // allow-fallback: run count file is optional state; missing is treated as 0
    return 0;
  }
}

/**
 * Increment and persist the run count to .dag/.run-count.
 * Silently swallows errors — this is advisory state only.
 */
async function incrementRunCount(): Promise<number> {
  const current = await readRunCount();
  const next = current + 1;
  try {
    await mkdir('.dag', { recursive: true });
    await writeFile(RUN_COUNT_FILE, String(next), UTF8_ENCODING);
  } catch {
    // allow-fallback: run count write failure is non-fatal
  }
  return next;
}

/**
 * Print the post-run CTA block.
 * Suppressed in CI, --no-progress, --output json, watch, stdin, and --no-cta modes.
 */
async function printRunCta(
  io: IDagCliIo,
  filePath: string,
  noProgress: boolean,
  outputFormat: string,
  watchMode: boolean,
  stdinMode: boolean,
  noCta: boolean,
  outputKeys: ReadonlyArray<string> = [],
): Promise<void> {
  const isCi = process.env['CI'] === 'true';
  if (
    noCta ||
    isCi ||
    noProgress ||
    outputFormat === OUTPUT_FORMAT_JSON ||
    outputFormat === OUTPUT_FORMAT_RESULT ||
    outputKeys.length > 0 ||
    watchMode ||
    stdinMode
  ) {
    return;
  }

  const runCount = await incrementRunCount();

  const divider = '\n─────────────────\n';

  if (runCount === 1) {
    io.write(
      `${divider}Next steps:\n  dag tutorial                         Interactive onboarding (5 min)\n  dag run --watch ${filePath}  Re-run automatically on file changes\n`,
    );
    return;
  }

  if (runCount < 10) {
    io.write(
      `${divider}Next steps:\n  dag share ${filePath}       Share this pipeline\n  dag run --watch ${filePath}  Re-run automatically on file changes\n  dag benchmark ${filePath}   Measure performance stats\n  dag explain ${filePath}     Show structure explanation\n`,
    );
    return;
  }

  io.write(
    `${divider}Next steps:\n  dag share ${filePath}       Share this pipeline\n  dag benchmark ${filePath}   Measure performance stats\n`,
  );
}

// ---------------------------------------------------------------------------
// PLUGIN-005: Pipeline alias helpers
// ---------------------------------------------------------------------------

type TAliasMap = Record<string, string>;

/**
 * Load aliases from a JSON file. Returns an empty object if not found or malformed.
 */
async function loadAliasFile(filePath: string): Promise<TAliasMap> {
  try {
    const text = await readFile(filePath, UTF8_ENCODING);
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as TAliasMap;
    }
    return {};
  } catch {
    // allow-fallback: alias file absent or malformed is treated as empty
    return {};
  }
}

/**
 * Resolve a pipeline string through aliases.
 * Supports both bare names (backward compat) and @name syntax (ADXS-002).
 * Priority: .dag/aliases.json → ~/.dag/aliases.json → raw string.
 */
async function resolvePipelineAlias(value: string): Promise<string> {
  const lookupKey = value.startsWith('@') ? value.slice(1) : value;
  const localAliases = await loadAliasFile(join('.dag', 'aliases.json'));
  if (typeof localAliases[lookupKey] === 'string') {
    return localAliases[lookupKey] as string;
  }
  const globalAliases = await loadAliasFile(join(homedir(), '.dag', 'aliases.json'));
  if (typeof globalAliases[lookupKey] === 'string') {
    return globalAliases[lookupKey] as string;
  }
  return value;
}

/**
 * Print all saved pipeline aliases from .dag/aliases.json and ~/.dag/aliases.json.
 */
async function printAliases(io: IDagCliIo): Promise<void> {
  const localAliases = await loadAliasFile(join('.dag', 'aliases.json'));
  const globalAliases = await loadAliasFile(join(homedir(), '.dag', 'aliases.json'));

  const hasLocal = Object.keys(localAliases).length > 0;
  const hasGlobal = Object.keys(globalAliases).length > 0;

  if (!hasLocal && !hasGlobal) {
    io.write('No pipeline aliases defined.\n');
    io.write('\nCreate .dag/aliases.json or ~/.dag/aliases.json:\n');
    io.write('  {\n    "qa": "input | llm-text-anthropic | text-output"\n  }\n');
    return;
  }

  if (hasLocal) {
    io.write('Local aliases (.dag/aliases.json):\n');
    for (const [name, pipeline] of Object.entries(localAliases)) {
      io.write(`  ${name.padEnd(20)} ${pipeline}\n`);
    }
  }

  if (hasGlobal) {
    if (hasLocal) io.write('\n');
    io.write('Global aliases (~/.dag/aliases.json):\n');
    for (const [name, pipeline] of Object.entries(globalAliases)) {
      io.write(`  ${name.padEnd(20)} ${pipeline}\n`);
    }
  }
}

/**
 * Execute the `robota-dag run <file>` subcommand.
 *
 * @param args - The argv slice starting after the `run` keyword.
 * @param options - IO abstraction and optional runner factory.
 * @returns Exit code (0 = success, 1 = execution failure, 2 = usage error).
 */
export async function runCommand(
  args: readonly string[],
  options: IRunCommandOptions,
): Promise<number> {
  const { io } = options;

  const parseResult = parseRunArgv(args);
  if (!parseResult.ok) {
    // --help / --pipeline-examples / missing args with hint: write plain text directly.
    if (parseResult.isHelp === true) {
      io.write(parseResult.message);
      return parseResult.exitCode;
    }
    const failure = createCliFailure('DAG_CLI_USAGE_ERROR', parseResult.message);
    io.writeError(`${JSON.stringify(failure, null, JSON_INDENT_SPACES)}\n`);
    return parseResult.exitCode;
  }

  const {
    file,
    pipeline: rawPipeline,
    stdinMode,
    inputs,
    outputFormat,
    timeoutMs,
    envFilePath,
    dryRun,
    noProgress,
    watchMode,
    stream,
    confirmCost,
    maxCostUsd,
    noCostWarning,
    noDiff,
    showFull,
    reportFile,
    frozen,
    noCta,
    showAliases,
    nodeConfigs,
    outputKeys,
    saveAsName,
    saveAsDraft,
    nodeFiles,
    noAutoNodes,
    tuiMode,
    provider,
    serverUrl,
  } = parseResult.value;

  // PROVIDER-007: the `dag run` path executes in-process via LocalDagRunner.
  // Only the local provider is supported; an explicit non-local provider is a
  // usage error.
  if (provider !== undefined && provider !== 'local') {
    const failure = createCliFailure(
      'DAG_CLI_USAGE_ERROR',
      `\`dag run\` only supports the local provider in this release. Use 'dag runs submit --provider ${provider}${serverUrl ? ` --server-url ${serverUrl}` : ''} <file>' for remote execution.`,
    );
    io.writeError(`${JSON.stringify(failure, null, JSON_INDENT_SPACES)}\n`);
    return USAGE_ERROR_EXIT_CODE;
  }

  // PLUGIN-005: --aliases flag: print saved aliases and exit.
  if (showAliases) {
    await printAliases(io);
    return SUCCESS_EXIT_CODE;
  }

  // PLUGIN-005: Resolve pipeline alias if --pipeline was given.
  const pipeline = rawPipeline !== undefined ? await resolvePipelineAlias(rawPipeline) : undefined;

  // Apply env file -- always attempt to load .env; use --env-file path if given.
  await applyEnvFile(envFilePath ?? '.env');

  let dagDefinition: IDagDefinition;

  // Resolve project directory from the DAG file path (or CWD for pipeline/stdin modes).
  const projectDir =
    typeof file === 'string' && !file.startsWith('http://') && !file.startsWith('https://')
      ? dirname(resolve(file))
      : process.cwd();

  // Collect companion nodeFiles (relative to dag file) + explicit --node-file flags.
  const companionNodeFiles: string[] =
    typeof file === 'string' && !file.startsWith('http://') && !file.startsWith('https://')
      ? ((await tryReadCompanion(resolve(file), io))?.nodeFiles ?? []).map((rel) =>
          resolve(projectDir, rel),
        )
      : [];
  const allNodeFilePaths = [...companionNodeFiles, ...nodeFiles.map((f) => resolve(f))];

  // Load explicit --node-file entries (fatal on failure).
  const explicitNodes: IDagNodeDefinition[] = [];
  for (const nodeFilePath of allNodeFilePaths) {
    const absPath = nodeFilePath;
    // DX-001: warn when a .ts source file is passed via --node-file; skip and continue
    if (absPath.endsWith('.ts')) {
      io.writeError(
        `⚠ "${absPath}" is a TypeScript source file and cannot be loaded directly.\n` +
          `  Compile it to JavaScript first and pass the .js output to --node-file.\n`,
      );
      continue;
    }
    let loadedNode: IDagNodeDefinition;
    try {
      loadedNode = await loadNodeFileExplicit(absPath);
    } catch (loadErr) {
      // allow-fallback: error from loadNodeFileExplicit is surfaced to the user and exits non-zero
      const msg = loadErr instanceof Error ? loadErr.message : String(loadErr);
      io.writeError(
        `${JSON.stringify(createCliFailure('DAG_CLI_USAGE_ERROR', msg), null, JSON_INDENT_SPACES)}\n`,
      );
      return USAGE_ERROR_EXIT_CODE;
    }
    explicitNodes.push(loadedNode);
  }

  // Auto-scan local nodes (unless --no-auto-nodes).
  const autoNodes = noAutoNodes ? [] : await loadLocalNodeDefinitions({ projectDir });

  // Merge: explicit > auto > built-in (later entries win on nodeType conflict).
  const builtIn = createCliNodeRegistry();
  const overrideTypes = new Set([...autoNodes, ...explicitNodes].map((n) => n.nodeType));
  const nodeDefinitions: IDagNodeDefinition[] = [
    ...builtIn.filter((n) => !overrideTypes.has(n.nodeType)),
    ...autoNodes,
    ...explicitNodes,
  ];

  // Build the node registry assembly once (needed for pipeline mode + nodeConfig validation).
  const assemblyResult = buildNodeDefinitionAssembly(nodeDefinitions);
  if (!assemblyResult.ok) {
    const failure = createCliFailure(
      'DAG_CLI_USAGE_ERROR',
      `Failed to build node registry: ${assemblyResult.error.code}`,
    );
    io.writeError(`${JSON.stringify(failure, null, JSON_INDENT_SPACES)}\n`);
    return FAILURE_EXIT_CODE;
  }
  const { manifests } = assemblyResult.value;
  // Build a map from nodeType → configSchema properties for fast lookup in applyNodeConfigs.
  const manifestsByType = new Map<string, IConfigSchemaWithProperties>(
    manifests.map((m) => {
      const schema = m.configSchema as IConfigSchemaWithProperties | undefined;
      return [m.nodeType, { properties: schema?.properties }];
    }),
  );

  if (pipeline !== undefined) {
    // Pipeline mode: build DAG from inline pipeline string
    const pipelineResult = buildDagFromPipeline(pipeline, manifests);
    if (!pipelineResult.ok) {
      const failure = createCliFailure('DAG_CLI_USAGE_ERROR', pipelineResult.message);
      io.writeError(`${JSON.stringify(failure, null, JSON_INDENT_SPACES)}\n`);
      return USAGE_ERROR_EXIT_CODE;
    }
    dagDefinition = pipelineResult.definition;
  } else if (stdinMode) {
    // Stdin mode: read DAG JSON from stdin (strips comment lines from `dag node example` output).
    const stdinText = await readStdin();
    const stdinResult = parseDagJsonText(stdinText, '<stdin>');
    if (!stdinResult.ok) {
      const failure = createCliFailure('DAG_CLI_USAGE_ERROR', stdinResult.message);
      io.writeError(`${JSON.stringify(failure, null, JSON_INDENT_SPACES)}\n`);
      return stdinResult.exitCode;
    }
    dagDefinition = stdinResult.value;
  } else if (typeof file === 'string' && file.startsWith('@')) {
    // Alias shorthand: dag run @<name> → resolve alias as pipeline
    const resolved = await resolvePipelineAlias(file);
    if (resolved === file) {
      const failure = createCliFailure(
        'DAG_CLI_USAGE_ERROR',
        `Alias "${file}" not found. Run 'dag alias list' to see available aliases.`,
      );
      io.writeError(`${JSON.stringify(failure, null, JSON_INDENT_SPACES)}\n`);
      return USAGE_ERROR_EXIT_CODE;
    }
    const pipelineResult = buildDagFromPipeline(resolved, manifests);
    if (!pipelineResult.ok) {
      const failure = createCliFailure('DAG_CLI_USAGE_ERROR', pipelineResult.message);
      io.writeError(`${JSON.stringify(failure, null, JSON_INDENT_SPACES)}\n`);
      return USAGE_ERROR_EXIT_CODE;
    }
    dagDefinition = pipelineResult.definition;
  } else {
    // File/URL mode
    const resolvedFile = file as string;
    const isUrl = resolvedFile.startsWith('http://') || resolvedFile.startsWith('https://');

    if (isUrl && watchMode) {
      const failure = createCliFailure(
        'DAG_CLI_USAGE_ERROR',
        '--watch cannot be used with a URL. Download the file locally first.',
      );
      io.writeError(`${JSON.stringify(failure, null, JSON_INDENT_SPACES)}\n`);
      return USAGE_ERROR_EXIT_CODE;
    }

    const dagFileResult = isUrl
      ? await fetchDagFromUrl(resolvedFile)
      : await readDagFile(resolvedFile, io);
    if (!dagFileResult.ok) {
      const failure = createCliFailure('DAG_CLI_USAGE_ERROR', dagFileResult.message);
      io.writeError(`${JSON.stringify(failure, null, JSON_INDENT_SPACES)}\n`);
      return dagFileResult.exitCode;
    }
    dagDefinition = dagFileResult.value;
  }

  // Apply --node-config overrides to the loaded DAG definition (all three modes).
  dagDefinition = applyNodeConfigs(dagDefinition, nodeConfigs, manifestsByType, io);

  const inputPayload = buildInputPayload(inputs);

  // Frozen-run lockfile check (ECO-012): verify node models match dag.lock.
  if (frozen) {
    const frozenErr = await validateFrozenRun(
      dagDefinition.nodes as ReadonlyArray<{
        nodeId?: string;
        nodeType?: string;
        config?: Record<string, unknown>;
      }>,
      process.cwd(),
    );
    if (frozenErr !== null) {
      io.writeError(`Error: ${frozenErr}\n`);
      return USAGE_ERROR_EXIT_CODE;
    }
  }

  if (dryRun) {
    const dryRunResult = {
      ok: true,
      dryRun: true,
      dagId: dagDefinition.dagId,
      version: dagDefinition.version,
      nodeCount: dagDefinition.nodes.length,
      inputs: inputPayload,
    };
    io.write(`${JSON.stringify(dryRunResult, null, JSON_INDENT_SPACES)}\n`);
    return SUCCESS_EXIT_CODE;
  }

  // Cost guardrail (DX-010): check before first execution.
  const guardrailCode = checkCostGuardrail(
    dagDefinition,
    inputs,
    confirmCost,
    maxCostUsd,
    noCostWarning,
    io,
  );
  if (guardrailCode !== null) {
    return guardrailCode;
  }

  // Create runner -- allow injection for testing.
  const runner =
    options.createRunner !== undefined
      ? options.createRunner()
      : new LocalDagRunner(nodeDefinitions);

  const displayLabel =
    pipeline !== undefined ? `pipeline: ${pipeline}` : stdinMode ? '<stdin>' : (file as string);

  // Run once (normal mode or initial run in watch mode).
  const firstOutcome = await runOnce(
    dagDefinition,
    runner,
    inputPayload,
    outputFormat,
    noProgress,
    stream,
    displayLabel,
    io,
    timeoutMs,
    outputKeys,
    tuiMode,
  );

  // ADXS-003: --save-as — save the DAG to .dag/workflows/<name>.dag.json after run
  if (saveAsName !== undefined) {
    const runSucceeded = firstOutcome.result?.dagRun.status === 'success';
    if (runSucceeded || saveAsDraft) {
      const workflowsDir = join('.dag', 'workflows');
      const outputPath = join(workflowsDir, `${saveAsName}.dag.json`);
      const dagJson = JSON.stringify(
        { ...dagDefinition, dagId: saveAsName },
        null,
        JSON_INDENT_SPACES,
      );
      try {
        await mkdir(workflowsDir, { recursive: true });
        await writeFile(outputPath, dagJson + '\n', 'utf8');
        io.write(`\nSaved as: ${outputPath}\n`);
        io.write(`Run later: dag catalog run ${saveAsName}\n`);
      } catch (saveErr) {
        // allow-fallback: save failure is non-fatal — run result already shown
        io.write(`Warning: failed to save workflow: ${resolveErrorMessage(saveErr)}\n`);
      }
    } else {
      io.write(`\n⚠ Pipeline failed — not saved. Use --save-as-draft to save anyway.\n`);
    }
  }

  if (!watchMode || pipeline !== undefined || stdinMode) {
    // DX-013: generate Markdown report if --report-file was given.
    if (firstOutcome.result !== null && reportFile !== undefined) {
      const startTime = new Date().toISOString();
      const markdown = buildRunReport(
        displayLabel,
        firstOutcome.result,
        dagDefinition,
        inputs,
        startTime,
      );
      try {
        // allow-fallback: report write failure is non-fatal — run result already shown
        await writeFile(reportFile, markdown, 'utf8');
        io.write(`\nReport saved to: ${reportFile}\n`);
      } catch (writeErr) {
        // allow-fallback: non-fatal — warning is sufficient
        io.write(
          `Warning: failed to write report to "${reportFile}": ${resolveErrorMessage(writeErr)}\n`,
        );
      }
    }
    // SOCIAL-001: Print post-run CTA on success (suppressed in CI/json/noProgress/watch/stdin/noCta).
    if (firstOutcome.exitCode === SUCCESS_EXIT_CODE) {
      const ctaLabel = file ?? (pipeline !== undefined ? pipeline : '<stdin>');
      await printRunCta(
        io,
        ctaLabel,
        noProgress,
        outputFormat,
        watchMode,
        stdinMode,
        noCta,
        outputKeys,
      );
    }
    // AGENT-003: Append run history entry.
    if (!watchMode && !stdinMode) {
      const histLabel = file ?? (pipeline !== undefined ? pipeline : '<inline>');
      const histStatus = firstOutcome.exitCode === SUCCESS_EXIT_CODE ? 'success' : 'failed';
      await appendRunHistory(histLabel, histStatus);
    }
    return firstOutcome.exitCode;
  }

  // Watch mode: re-read and re-run on file changes (ADOPT-006).
  let runCount = 1;
  let totalCostUsd = estimateDagCost(dagDefinition, inputs).totalUsd;
  let previousOutput: string | null =
    firstOutcome.result !== null ? getMainOutput(firstOutcome.result) : null;

  const resolvedFile = file as string;
  io.write(`\n[Watching... | Run #${runCount} | Total cost: ~$${totalCostUsd.toFixed(4)}]\n`);

  const watcher = watch(resolvedFile, { persistent: true }, (eventType) => {
    if (eventType !== 'change') return;
    const timestamp = new Date().toISOString();
    runCount += 1;
    const currentRunCount = runCount;
    io.write(`\n[${timestamp}] File changed. Re-running...\n`);
    readDagFile(resolvedFile, io)
      .then(async (reloadResult) => {
        if (!reloadResult.ok) {
          io.write(`Error reading file: ${reloadResult.message}\n`);
          return;
        }
        const reloadedDag = applyNodeConfigs(reloadResult.value, nodeConfigs, manifestsByType, io);

        // Re-apply guardrail for --max-cost-usd on each watch re-run.
        if (maxCostUsd !== undefined) {
          const rerunGuardrail = checkCostGuardrail(
            reloadedDag,
            inputs,
            confirmCost,
            maxCostUsd,
            noCostWarning,
            io,
          );
          if (rerunGuardrail !== null) {
            io.write(`Run #${currentRunCount} aborted by cost guardrail.\n`);
            return;
          }
        }

        const runStartMs = Date.now();
        const watchRunner = new LocalDagRunner(nodeDefinitions);
        const outcome = await runOnce(
          reloadedDag,
          watchRunner,
          inputPayload,
          outputFormat,
          noProgress,
          stream,
          resolvedFile,
          io,
          timeoutMs,
          outputKeys,
          tuiMode,
        );
        const runDurationMs = Date.now() - runStartMs;
        totalCostUsd += estimateDagCost(reloadedDag, inputs).totalUsd;

        // Output diff (ADOPT-006).
        if (!noDiff && outcome.result !== null) {
          const currentOutput = getMainOutput(outcome.result);
          if (previousOutput !== null) {
            if (currentOutput !== previousOutput) {
              const diff = computeLineDiff(previousOutput, currentOutput, { showFull });
              io.write(`\n[Run #${currentRunCount}] Output diff:\n`);
              io.write(diff.output);
              if (diff.truncated) {
                io.write(
                  `... ${diff.totalChanged - WATCH_DIFF_MAX_CHANGED_LINES} more changed line(s) not shown. Use --show-full to see complete diff.\n`,
                );
              }
            } else {
              io.write(`\n[Run #${currentRunCount}] Output unchanged.\n`);
            }
          }
          previousOutput = currentOutput;
        }

        io.write(
          `[Watching... | Run #${currentRunCount} | Total cost: ~$${totalCostUsd.toFixed(4)} | Duration: ${runDurationMs}ms]\n`,
        );
      })
      .catch((err: unknown) => {
        io.write(`Error during re-run: ${resolveErrorMessage(err)}\n`);
      });
  });

  // Handle Ctrl+C gracefully.
  process.on('SIGINT', () => {
    watcher.close();
    process.exit(0);
  });

  // Keep the process alive while watching.
  await new Promise<never>(() => {
    /* intentional: process stays alive until SIGINT */
  });

  // Unreachable -- TypeScript needs a return statement.
  return SUCCESS_EXIT_CODE;
}
