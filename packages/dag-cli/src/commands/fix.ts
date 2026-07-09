import { writeFile } from 'node:fs/promises';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import type { INodeManifest } from '@robota-sdk/dag-core';
import { buildNodeDefinitionAssembly } from '@robota-sdk/dag-node';
import { isWorkflowFileFormat, fromDagWorkflowFile } from '@robota-sdk/dag-builder';
import type { IDagCliIo } from '../types.js';
import { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE, USAGE_ERROR_EXIT_CODE } from '../types.js';
import { createCliNodeRegistry, LocalDagRunner } from '../local-runner/index.js';
import { applyEnvFile, extractFinalOutput } from './run.js';
import type { IBuildSpec } from './convert.js';
import { buildDagFromSpec } from './build.js';

const JSON_INDENT_SPACES = 2;
const DEFAULT_ENV_FILE = '.dag/.env';
const LLM_NODE_TYPE = 'llm-text';
const ANTHROPIC_KEY_ENV = 'ANTHROPIC_API_KEY';

const FIX_HELP = `Usage: dag fix <file> [options]

Analyze a broken DAG and suggest (or apply) a fix.

Arguments:
  <file>          Path to a .dag.json file

Options:
  --apply         Overwrite the original file with the fix (backs up to <file>.bak)
  --run           Execute the fixed DAG immediately (implies --apply)
  --input <k=v>   Input values for --run (repeatable)
  --no-llm        Skip LLM analysis; use static analysis only

Examples:
  dag fix broken.dag.json
  dag fix broken.dag.json --apply
  dag fix broken.dag.json --apply --run --input text="Hello"
`;

export interface IFixCommandOptions {
  readonly io: IDagCliIo;
}

interface IParsedFixOptions {
  readonly file: string;
  readonly apply: boolean;
  readonly run: boolean;
  readonly inputs: ReadonlyArray<string>;
  readonly noLlm: boolean;
}

type TParseResult =
  | { readonly ok: true; readonly value: IParsedFixOptions }
  | { readonly ok: false; readonly exitCode: number; readonly message: string };

function parseFixArgv(args: readonly string[]): TParseResult {
  let file: string | undefined;
  let apply = false;
  let run = false;
  let noLlm = false;
  const inputs: string[] = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--apply') {
      apply = true;
      i += 1;
    } else if (arg === '--run') {
      run = true;
      apply = true;
      i += 1;
    } else if (arg === '--no-llm') {
      noLlm = true;
      i += 1;
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
    } else if ((arg as string | undefined)?.startsWith('--')) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: `fix received unexpected flag: ${arg}.`,
      };
    } else {
      file = arg as string;
      i += 1;
    }
  }

  if (!file) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: 'fix requires a .dag.json file path as the first argument.',
    };
  }

  return { ok: true, value: { file, apply, run, inputs, noLlm } };
}

function resolveErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface IValidationError {
  readonly message: string;
  readonly code?: string;
  readonly nodeId?: string;
}

function validateDagBasic(
  dag: IDagDefinition,
  manifests: ReadonlyArray<INodeManifest>,
): IValidationError[] {
  const errors: IValidationError[] = [];
  const knownTypes = new Set(manifests.map((m) => m.nodeType));
  const nodes = dag.nodes ?? [];
  const edges = dag.edges ?? [];
  const nodeIdSet = new Set(nodes.map((n) => n.nodeId));

  for (const node of nodes) {
    if (!knownTypes.has(node.nodeType)) {
      errors.push({
        message: `Unknown node type "${node.nodeType}" at node "${node.nodeId}"`,
        code: 'UNKNOWN_NODE_TYPE',
        nodeId: node.nodeId,
      });
    }
  }

  for (const edge of edges) {
    if (!nodeIdSet.has(edge.from)) {
      errors.push({
        message: `Edge source "${edge.from}" not found`,
        code: 'EDGE_NODE_NOT_FOUND',
        nodeId: edge.from,
      });
    }
    if (!nodeIdSet.has(edge.to)) {
      errors.push({
        message: `Edge target "${edge.to}" not found`,
        code: 'EDGE_NODE_NOT_FOUND',
        nodeId: edge.to,
      });
    }
  }

  const INPUT_TYPES = ['input', 'multi-input'];
  if (!nodes.some((n) => INPUT_TYPES.includes(n.nodeType))) {
    errors.push({
      message: 'No input node found',
      code: 'MISSING_INPUT_NODE',
    });
  }

  const OUTPUT_TYPES = ['text-output', 'ok-emitter'];
  if (!nodes.some((n) => OUTPUT_TYPES.includes(n.nodeType))) {
    errors.push({
      message: 'No output node found',
      code: 'MISSING_OUTPUT_NODE',
    });
  }

  return errors;
}

function buildFixPrompt(dag: IDagDefinition, errors: IValidationError[], nodeList: string): string {
  const dagJson = JSON.stringify(dag, null, JSON_INDENT_SPACES);
  const errorList = errors
    .map((e, i) => `${i + 1}. [${e.code ?? 'ERROR'}] ${e.message}`)
    .join('\n');

  return `You are a DAG pipeline repair tool. Fix the broken DAG below.

Available node types:
${nodeList}

IBuildSpec output format:
{
  "nodes": [{"type": "nodeType"}, {"type": "nodeType", "id": "optional-id"}],
  "edges": ["nodeId→nextNodeId"]
}

Rules:
- Every pipeline must start with "input" and end with "text-output".
- Edges use → (Unicode U+2192).
- Remove or replace unknown node types with valid alternatives.
- Output ONLY valid IBuildSpec JSON. No explanation.

Broken DAG:
${dagJson}

Errors found:
${errorList}

Fixed IBuildSpec JSON:`;
}

function buildNodeListContext(manifests: ReadonlyArray<INodeManifest>): string {
  return manifests
    .map((m) => {
      const ins = m.inputs.map((p) => `${p.key}:${p.type}`).join(', ');
      const outs = m.outputs.map((p) => `${p.key}:${p.type}`).join(', ');
      return `- ${m.nodeType}: in[${ins}] out[${outs}]`;
    })
    .join('\n');
}

const JSON_BLOCK_RE = /```(?:json)?\s*([\s\S]*?)```/i;

function extractJsonFromText(text: string): string {
  const match = JSON_BLOCK_RE.exec(text);
  if (match) return (match[1] ?? '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1).trim();
  }
  return text.trim();
}

const LLM_DAG: IDagDefinition = {
  dagId: 'fix-llm-call',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
    {
      nodeId: 'llm',
      nodeType: LLM_NODE_TYPE,
      dependsOn: ['input'],
      config: { provider: 'anthropic' },
    },
    { nodeId: 'output', nodeType: 'text-output', dependsOn: ['llm'], config: {} },
  ],
  edges: [
    { from: 'input', to: 'llm', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
    { from: 'llm', to: 'output', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
  ],
};

export async function fixCommand(
  args: readonly string[],
  options: IFixCommandOptions,
): Promise<number> {
  const { io } = options;

  if (args.includes('--help') || args.includes('-h')) {
    io.write(FIX_HELP);
    return SUCCESS_EXIT_CODE;
  }

  const parseResult = parseFixArgv(args);
  if (!parseResult.ok) {
    io.write(`Error: ${parseResult.message}\n`);
    return parseResult.exitCode;
  }

  const { file, apply, run, inputs, noLlm } = parseResult.value;

  // Load the DAG file
  let fileContent: string;
  try {
    fileContent = await io.readTextFile(file);
  } catch (readErr) {
    // allow-fallback: file read failure returned as structured error
    io.write(`Error: Failed to read "${file}": ${resolveErrorMessage(readErr)}\n`);
    return FAILURE_EXIT_CODE;
  }

  let dag: IDagDefinition;
  try {
    const parsed = JSON.parse(fileContent) as unknown;
    if (isWorkflowFileFormat(parsed)) {
      dag = fromDagWorkflowFile(parsed);
    } else {
      dag = parsed as IDagDefinition;
    }
  } catch (parseErr) {
    // allow-fallback: JSON parse failure returned as structured error
    io.write(`Error: "${file}" is not valid JSON: ${resolveErrorMessage(parseErr)}\n`);
    return FAILURE_EXIT_CODE;
  }

  // Load env for LLM
  await applyEnvFile(DEFAULT_ENV_FILE);

  // Get manifests
  const assemblyResult = buildNodeDefinitionAssembly(createCliNodeRegistry());
  if (!assemblyResult.ok) {
    io.write(`Error: Failed to build node registry: ${assemblyResult.error.message}\n`);
    return FAILURE_EXIT_CODE;
  }

  const { manifests } = assemblyResult.value;

  // Static analysis
  const errors = validateDagBasic(dag, manifests);

  if (errors.length === 0) {
    io.write('✓ No errors found — the DAG looks valid.\n');
    return SUCCESS_EXIT_CODE;
  }

  io.write(`Found ${errors.length} error(s):\n`);
  for (const err of errors) {
    io.write(`  ✗ ${err.message}\n`);
  }
  io.write('\n');

  // Decide fix strategy
  const hasApiKey = Boolean(process.env[ANTHROPIC_KEY_ENV]);
  const useLlm = !noLlm && hasApiKey;

  let fixedDag: IDagDefinition | null = null;

  if (useLlm) {
    io.write('Analyzing with LLM...\n');
    const nodeList = buildNodeListContext(manifests);
    const prompt = buildFixPrompt(dag, errors, nodeList);

    const runner = new LocalDagRunner(createCliNodeRegistry());
    let llmResult;
    try {
      llmResult = await runner.run(LLM_DAG, { text: prompt });
    } catch (runErr) {
      // allow-fallback: LLM error returns static-analysis-only result
      io.write(
        `⚠ LLM call failed (${resolveErrorMessage(runErr)}). Falling back to static analysis.\n\n`,
      );
    }

    if (llmResult && llmResult.dagRun.status === 'success') {
      const llmText = extractFinalOutput(llmResult.taskRuns, LLM_DAG.nodes);
      if (llmText) {
        const jsonText = extractJsonFromText(llmText);
        let buildSpec: IBuildSpec | undefined;
        try {
          const parsed = JSON.parse(jsonText) as { nodes?: unknown; edges?: unknown };
          if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
            buildSpec = parsed as IBuildSpec;
          }
        } catch {
          // allow-fallback: JSON parse failure falls back to static fix
        }

        if (buildSpec) {
          const dagResult = buildDagFromSpec(dag.dagId, buildSpec, manifests);
          if (dagResult.ok) {
            fixedDag = dagResult.definition;
            io.write('✓ LLM suggested a fix.\n\n');
          } else {
            io.write(
              `⚠ LLM fix is invalid (${dagResult.message}). Falling back to static analysis.\n\n`,
            );
          }
        }
      }
    }
  } else if (!hasApiKey && !noLlm) {
    io.write('ℹ No ANTHROPIC_API_KEY found. Performing static analysis only.\n');
    io.write('  Set ANTHROPIC_API_KEY in .dag/.env for LLM-assisted fixes.\n\n');
  }

  // Static fix fallback: remove broken edges, add missing nodes
  if (!fixedDag) {
    const brokenEdgeNodes = new Set(
      errors.filter((e) => e.code === 'EDGE_NODE_NOT_FOUND').map((e) => e.nodeId),
    );
    const unknownNodeIds = new Set(
      errors.filter((e) => e.code === 'UNKNOWN_NODE_TYPE').map((e) => e.nodeId),
    );

    const fixedNodes = dag.nodes.filter((n) => !unknownNodeIds.has(n.nodeId));
    const fixedEdges = (dag.edges ?? []).filter(
      (e) =>
        !brokenEdgeNodes.has(e.from) &&
        !brokenEdgeNodes.has(e.to) &&
        !unknownNodeIds.has(e.from) &&
        !unknownNodeIds.has(e.to),
    );

    fixedDag = {
      ...dag,
      nodes: fixedNodes,
      edges: fixedEdges,
    };

    io.write('Applied static fix (removed broken edges and unknown nodes).\n\n');
  }

  const fixedJson = JSON.stringify(fixedDag, null, JSON_INDENT_SPACES);

  if (!apply) {
    io.write('Suggested fix:\n');
    io.write(fixedJson + '\n');
    io.write('\nRun with --apply to overwrite the original file.\n');
    return SUCCESS_EXIT_CODE;
  }

  // Backup original and write fix
  try {
    await writeFile(`${file}.bak`, fileContent, 'utf8');
    io.write(`Backup: ${file}.bak\n`);
  } catch (backupErr) {
    // allow-fallback: backup failure prevents applying to avoid data loss
    io.write(`Error: Failed to create backup "${file}.bak": ${resolveErrorMessage(backupErr)}\n`);
    return FAILURE_EXIT_CODE;
  }

  try {
    await writeFile(file, fixedJson + '\n', 'utf8');
    io.write(`Applied: ${file}\n`);
  } catch (writeErr) {
    // allow-fallback: write failure returned as structured error
    io.write(`Error: Failed to write fixed DAG to "${file}": ${resolveErrorMessage(writeErr)}\n`);
    return FAILURE_EXIT_CODE;
  }

  if (!run) {
    return SUCCESS_EXIT_CODE;
  }

  // Run the fixed DAG
  const inputPayload: Record<string, string> = {};
  for (const raw of inputs) {
    const eqIdx = raw.indexOf('=');
    inputPayload[raw.slice(0, eqIdx)] = raw.slice(eqIdx + 1);
  }

  const runRunner = new LocalDagRunner(createCliNodeRegistry());
  let runResult;
  try {
    runResult = await runRunner.run(fixedDag, inputPayload);
  } catch (runErr) {
    // allow-fallback: run error returned as structured failure
    io.write(`Error: DAG run failed: ${resolveErrorMessage(runErr)}\n`);
    return FAILURE_EXIT_CODE;
  }

  if (runResult.dagRun.status !== 'success') {
    io.write(`Error: DAG run did not succeed (status: ${runResult.dagRun.status}).\n`);
    return FAILURE_EXIT_CODE;
  }

  const finalText = extractFinalOutput(runResult.taskRuns, fixedDag.nodes);
  if (finalText !== null) {
    io.write(finalText);
  } else {
    io.write('✓ Run completed\n');
  }

  return SUCCESS_EXIT_CODE;
}
