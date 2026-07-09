import { mkdir, writeFile } from 'node:fs/promises';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import { buildNodeDefinitionAssembly } from '@robota-sdk/dag-node';
import type { IDagCliIo } from '../types.js';
import { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE, USAGE_ERROR_EXIT_CODE } from '../types.js';
import { createCliNodeRegistry, LocalDagRunner } from '../local-runner/index.js';
import { applyEnvFile, extractFinalOutput } from './run.js';
import type { IBuildSpec } from './convert.js';
import { buildDagFromSpec, PORT_TYPE_COMPATIBILITY_RULES } from './build.js';

const JSON_INDENT_SPACES = 2;
const DESCRIBE_DAG_ID = 'described-pipeline';
const DEFAULT_ENV_FILE = '.dag/.env';
const LLM_NODE_TYPE = 'llm-text';
const ANTHROPIC_KEY_ENV = 'ANTHROPIC_API_KEY';

const DESCRIBE_HELP = `Usage: dag describe "<description>" [options]

Generate a runnable DAG from a natural language description.
Requires ANTHROPIC_API_KEY in environment or .dag/.env.

Arguments:
  <description>    Natural language description of the pipeline

Options:
  --output <path>     Write result to a .dag.json file
  --run               Execute the generated DAG immediately
  --input <key=val>   Input values when using --run (repeatable)
  --dagId <id>        Set the dagId (default: "described-pipeline")

Examples:
  dag describe "translate Korean text to English"

  dag describe "summarize input text using Claude" \\
    --output .dag/workflows/summarize.dag.json

  dag describe "echo the input back" \\
    --run --input text="Hello world"
`;

export interface IDescribeCommandOptions {
  readonly io: IDagCliIo;
}

interface IParsedDescribeOptions {
  readonly description: string;
  readonly outputPath: string | undefined;
  readonly dagId: string;
  readonly runAfter: boolean;
  readonly inputs: ReadonlyArray<string>;
}

type TParseResult =
  | { readonly ok: true; readonly value: IParsedDescribeOptions }
  | { readonly ok: false; readonly exitCode: number; readonly message: string };

function parseDescribeArgv(args: readonly string[]): TParseResult {
  let description: string | undefined;
  let outputPath: string | undefined;
  let dagId = DESCRIBE_DAG_ID;
  let runAfter = false;
  const inputs: string[] = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--output') {
      const next = args[i + 1];
      if (typeof next !== 'string' || next.startsWith('--')) {
        return {
          ok: false,
          exitCode: USAGE_ERROR_EXIT_CODE,
          message: '--output requires a value.',
        };
      }
      outputPath = next;
      i += 2;
    } else if (arg === '--dagId') {
      const next = args[i + 1];
      if (typeof next !== 'string' || next.startsWith('--')) {
        return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: '--dagId requires a value.' };
      }
      dagId = next;
      i += 2;
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
    } else if (arg === '--run') {
      runAfter = true;
      i += 1;
    } else if ((arg as string | undefined)?.startsWith('--')) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: `describe received unexpected flag: ${arg}.`,
      };
    } else {
      description = arg as string;
      i += 1;
    }
  }

  if (!description || description.trim().length === 0) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: 'describe requires a natural language description as the first argument.',
    };
  }

  return {
    ok: true,
    value: { description: description.trim(), outputPath, dagId, runAfter, inputs },
  };
}

function resolveErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface IManifestForContext {
  readonly nodeType: string;
  readonly displayName?: string;
  readonly inputs: ReadonlyArray<{ key: string; type: string; required?: boolean }>;
  readonly outputs: ReadonlyArray<{ key: string; type: string }>;
  readonly configSchema?: Record<string, unknown>;
}

function extractConfigKeys(schema: Record<string, unknown> | undefined): string {
  if (!schema) return '';
  const props = schema['properties'];
  if (!props || typeof props !== 'object') return '';
  const keys = Object.entries(props as Record<string, Record<string, unknown>>)
    .map(([k, v]) => {
      const type = typeof v['type'] === 'string' ? v['type'] : 'string';
      const def = v['default'] !== undefined ? ` default="${String(v['default'])}"` : '';
      return `${k}:${type}${def}`;
    })
    .join(', ');
  return keys ? ` config[${keys}]` : '';
}

function buildNodeListContext(manifests: ReadonlyArray<IManifestForContext>): string {
  return manifests
    .map((m) => {
      const ins = m.inputs
        .map((p) => `${p.key}:${p.type} (type: ${p.type})${p.required ? '' : '?'}`)
        .join(', ');
      const outs = m.outputs.map((p) => `${p.key}:${p.type} (type: ${p.type})`).join(', ');
      const cfg = extractConfigKeys(m.configSchema);
      return `- ${m.nodeType}: in[${ins}] out[${outs}]${cfg}`;
    })
    .join('\n');
}

function buildDescribePrompt(description: string, nodeList: string): string {
  return `You are a DAG pipeline designer. Output a pipeline as IBuildSpec JSON.

IBuildSpec format:
{
  "nodes": [
    {"type": "nodeType"},
    {"type": "nodeType", "id": "custom-id", "config": {"key": "value"}}
  ],
  "edges": ["nodeId→nextNodeId"]
}

KEY RULES:
1. Every pipeline starts with "input" and ends with "text-output".
2. Edges use → (U+2192). Auto-assigned IDs match the nodeType.
3. To give an LLM a task (translate, summarize, etc.), insert a "text-template" node BEFORE the LLM node.
   Set config.template to the full prompt with %s as placeholder for the user text.
   Example: {"type":"text-template","config":{"template":"Translate the following Korean text to English:\\n\\n%s"}}
4. The LLM node (llm-text) receives text via its input port. Set config.provider to one of
   anthropic, openai, gemini, deepseek, qwen (optionally config.model). It does NOT have a
   systemPrompt config — use text-template upstream to build the prompt.
5. If multiple nodes of the same type are needed, give each a unique "id".
6. Use ONLY node types from the list below.
7. Output ONLY valid JSON — no explanation, no code fences.

${PORT_TYPE_COMPATIBILITY_RULES}

EXAMPLE — "Translate Korean to English":
{
  "nodes": [
    {"type":"input"},
    {"type":"text-template","config":{"template":"Translate the following Korean text to English. Output only the translation.\\n\\n%s"}},
    {"type":"llm-text","config":{"provider":"anthropic"}},
    {"type":"text-output"}
  ],
  "edges":["input→text-template","text-template→llm-text","llm-text→text-output"]
}

Available node types:
${nodeList}

User pipeline description: "${description}"

Output the IBuildSpec JSON now:`;
}

const JSON_BLOCK_RE = /```(?:json)?\s*([\s\S]*?)```/i;

function extractJsonFromText(text: string): string {
  // Try to extract from code block first
  const match = JSON_BLOCK_RE.exec(text);
  if (match) return (match[1] ?? '').trim();
  // Otherwise assume the whole text is JSON
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1).trim();
  }
  return text.trim();
}

const LLM_DAG: IDagDefinition = {
  dagId: 'describe-llm-call',
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

export async function describeCommand(
  args: readonly string[],
  options: IDescribeCommandOptions,
): Promise<number> {
  const { io } = options;

  if (args.includes('--help') || args.includes('-h')) {
    io.write(DESCRIBE_HELP);
    return SUCCESS_EXIT_CODE;
  }

  const parseResult = parseDescribeArgv(args);
  if (!parseResult.ok) {
    io.write(`Error: ${parseResult.message}\n`);
    return parseResult.exitCode;
  }

  const { description, outputPath, dagId, runAfter, inputs } = parseResult.value;

  // Load env file to pick up API key
  await applyEnvFile(DEFAULT_ENV_FILE);

  // Check for API key
  if (!process.env[ANTHROPIC_KEY_ENV]) {
    io.write(
      `Error: ANTHROPIC_API_KEY is not set.\n` +
        `  Set it in .dag/.env or export it in your shell:\n` +
        `    echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .dag/.env\n` +
        `\n` +
        `  Alternative: build a pipeline manually with:\n` +
        `    dag build --spec '{"nodes":[...],"edges":[...]}'\n`,
    );
    return FAILURE_EXIT_CODE;
  }

  // Get node manifests for context
  const assemblyResult = buildNodeDefinitionAssembly(createCliNodeRegistry());
  if (!assemblyResult.ok) {
    io.write(`Error: Failed to build node registry: ${assemblyResult.error.message}\n`);
    return FAILURE_EXIT_CODE;
  }

  const { manifests } = assemblyResult.value;
  const nodeList = buildNodeListContext(manifests);
  const promptText = buildDescribePrompt(description, nodeList);

  // Run LLM to generate IBuildSpec
  io.write('Generating pipeline...\n');
  const runner = new LocalDagRunner(createCliNodeRegistry());
  let llmResult;
  try {
    llmResult = await runner.run(LLM_DAG, { text: promptText });
  } catch (runErr) {
    // allow-fallback: LLM error returned as structured failure
    io.write(`Error: LLM call failed: ${resolveErrorMessage(runErr)}\n`);
    return FAILURE_EXIT_CODE;
  }

  if (llmResult.dagRun.status !== 'success') {
    io.write(`Error: LLM call did not succeed (status: ${llmResult.dagRun.status}).\n`);
    return FAILURE_EXIT_CODE;
  }

  const llmOutput = extractFinalOutput(llmResult.taskRuns, LLM_DAG.nodes);
  if (!llmOutput) {
    io.write('Error: LLM returned no output.\n');
    return FAILURE_EXIT_CODE;
  }

  // Parse IBuildSpec from LLM output
  const jsonText = extractJsonFromText(llmOutput);
  let buildSpec: IBuildSpec | undefined;
  try {
    const parsed = JSON.parse(jsonText) as { nodes?: unknown; edges?: unknown };
    if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
      buildSpec = parsed as IBuildSpec;
    }
  } catch {
    // allow-fallback: JSON parse failure returned as structured error
  }

  if (!buildSpec) {
    io.write(
      `Error: LLM output is not valid IBuildSpec JSON (missing nodes/edges).\nRaw output:\n${llmOutput}\n`,
    );
    return FAILURE_EXIT_CODE;
  }

  // Build IDagDefinition
  const dagResult = buildDagFromSpec(dagId, buildSpec, manifests);
  if (!dagResult.ok) {
    io.write(
      `Error: Generated pipeline is invalid: ${dagResult.message}\nRaw output:\n${llmOutput}\n`,
    );
    return FAILURE_EXIT_CODE;
  }

  const dagDefinition = dagResult.definition;
  const dagJson = JSON.stringify(dagDefinition, null, JSON_INDENT_SPACES);

  if (outputPath) {
    const dir = outputPath.slice(0, Math.max(0, outputPath.lastIndexOf('/')));
    if (dir) {
      try {
        await mkdir(dir, { recursive: true });
      } catch {
        // allow-fallback: directory may already exist
      }
    }
    try {
      await writeFile(outputPath, dagJson + '\n', 'utf8');
      io.write(`Written: ${outputPath}\n`);
    } catch (writeErr) {
      // allow-fallback: file write failure returned as structured error
      io.write(`Error: Failed to write "${outputPath}": ${resolveErrorMessage(writeErr)}\n`);
      return FAILURE_EXIT_CODE;
    }
  } else if (!runAfter) {
    io.write(dagJson + '\n');
  }

  if (!runAfter) {
    return SUCCESS_EXIT_CODE;
  }

  // Run the generated DAG
  const inputPayload: Record<string, string> = {};
  for (const raw of inputs) {
    const eqIdx = raw.indexOf('=');
    inputPayload[raw.slice(0, eqIdx)] = raw.slice(eqIdx + 1);
  }

  const runRunner = new LocalDagRunner(createCliNodeRegistry());
  let runResult;
  try {
    runResult = await runRunner.run(dagDefinition, inputPayload); // allow-fallback: run error returned as structured failure
  } catch (runErr) {
    // allow-fallback: run error returned as structured failure
    io.write(`Error: DAG run failed: ${resolveErrorMessage(runErr)}\n`);
    return FAILURE_EXIT_CODE;
  }

  if (runResult.dagRun.status !== 'success') {
    io.write(`Error: DAG run did not succeed (status: ${runResult.dagRun.status}).\n`);
    return FAILURE_EXIT_CODE;
  }

  const finalText = extractFinalOutput(runResult.taskRuns, dagDefinition.nodes);
  if (finalText !== null) {
    io.write(finalText);
  } else {
    io.write('✓ Run completed\n');
  }

  return SUCCESS_EXIT_CODE;
}
