import { mkdir, writeFile } from 'node:fs/promises';
import type {
  IDagDefinition,
  IDagEdgeDefinition,
  IDagNode,
  INodeConfigObject,
} from '@robota-sdk/dag-core';
import { buildNodeDefinitionAssembly } from '@robota-sdk/dag-node';
import type { IDagCliIo } from '../types.js';
import { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE, USAGE_ERROR_EXIT_CODE } from '../types.js';
import { createCliNodeRegistry, LocalDagRunner } from '../local-runner/index.js';
import { convertMermaid } from './convert.js';
import { extractFinalOutput } from './run.js';

const JSON_INDENT_SPACES = 2;
const NODE_X_SPACING = 300;

const FROM_MERMAID_HELP = `Usage: dag from-mermaid <mermaid|file> [options]

Convert a Mermaid flowchart to a runnable .dag.json.

Arguments:
  <mermaid>     Inline Mermaid string (quoted) or path to a .dag.md file

Options:
  --output <path>        Write output to a .dag.json file
  --run                  Execute the DAG immediately after conversion
  --input <key=value>    Input values when using --run (repeatable)
  --dagId <id>           Set the dagId (default: "from-mermaid")

Examples:
  dag from-mermaid "flowchart LR
    input-->transform
    transform-->output[text-output]" --output result.dag.json

  dag from-mermaid workflow.dag.md --output workflow.dag.json

  dag from-mermaid "flowchart LR
    input-->transform
    transform-->output[text-output]" --run --input text="Hello"
`;

const MERMAID_BLOCK_RE = /```mermaid\s*([\s\S]*?)```/i;

export interface IFromMermaidCommandOptions {
  readonly io: IDagCliIo;
}

interface IParsedFromMermaidOptions {
  readonly source: string;
  readonly outputPath: string | undefined;
  readonly dagId: string;
  readonly runAfter: boolean;
  readonly inputs: ReadonlyArray<string>;
}

type TParseResult =
  | { readonly ok: true; readonly value: IParsedFromMermaidOptions }
  | { readonly ok: false; readonly exitCode: number; readonly message: string };

function parseFromMermaidArgv(args: readonly string[]): TParseResult {
  let source: string | undefined;
  let outputPath: string | undefined;
  let dagId = 'from-mermaid';
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
        message: `from-mermaid received unexpected flag: ${arg}.`,
      };
    } else {
      source = arg as string;
      i += 1;
    }
  }

  if (!source) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: 'from-mermaid requires a Mermaid string or .dag.md file path.',
    };
  }

  return { ok: true, value: { source, outputPath, dagId, runAfter, inputs } };
}

function resolveErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function buildDagFromMermaidSpec(
  dagId: string,
  mermaidText: string,
  manifests: ReadonlyArray<{
    nodeType: string;
    defaultInputPort?: string;
    defaultOutputPort?: string;
  }>,
):
  | { readonly ok: true; readonly definition: IDagDefinition }
  | { readonly ok: false; readonly message: string } {
  const spec = convertMermaid(mermaidText);
  const knownTypes = new Map(manifests.map((m) => [m.nodeType, m]));
  const typeCounts = new Map<string, number>();

  const resolved: Array<{ nodeId: string; nodeType: string; config: Record<string, unknown> }> = [];

  for (const node of spec.nodes) {
    if (!knownTypes.has(node.type)) {
      const available = manifests.map((m) => m.nodeType).join(', ');
      return {
        ok: false,
        message: `Unknown node type "${node.type}". Available: ${available}`,
      };
    }
    const count = typeCounts.get(node.type) ?? 0;
    typeCounts.set(node.type, count + 1);
    const nodeId = node.id ?? (count === 0 ? node.type : `${node.type}-${count}`);
    resolved.push({ nodeId, nodeType: node.type, config: node.config ?? {} });
  }

  const nodeById = new Map(resolved.map((n) => [n.nodeId, n]));
  const dependsOnMap = new Map<string, string[]>();
  for (const n of resolved) {
    dependsOnMap.set(n.nodeId, []);
  }

  const dagEdges: IDagEdgeDefinition[] = [];

  for (const edgeStr of spec.edges) {
    const arrowIdx = edgeStr.indexOf('→');
    if (arrowIdx === -1) continue;
    const from = edgeStr.slice(0, arrowIdx).trim();
    const to = edgeStr.slice(arrowIdx + 1).trim();

    if (!nodeById.has(from)) {
      return { ok: false, message: `Edge references unknown node "${from}".` };
    }
    if (!nodeById.has(to)) {
      return { ok: false, message: `Edge references unknown node "${to}".` };
    }

    const fromManifest = knownTypes.get(nodeById.get(from)?.nodeType ?? '');
    const toManifest = knownTypes.get(nodeById.get(to)?.nodeType ?? '');
    const fromPort = fromManifest?.defaultOutputPort;
    const toPort = toManifest?.defaultInputPort;

    if (fromPort && toPort) {
      dagEdges.push({ from, to, bindings: [{ outputKey: fromPort, inputKey: toPort }] });
    } else {
      dagEdges.push({ from, to });
    }

    const deps = dependsOnMap.get(to) ?? [];
    if (!deps.includes(from)) {
      deps.push(from);
      dependsOnMap.set(to, deps);
    }
  }

  const dagNodes: IDagNode[] = resolved.map((n, index) => ({
    nodeId: n.nodeId,
    nodeType: n.nodeType,
    dependsOn: dependsOnMap.get(n.nodeId) ?? [],
    config: n.config as unknown as INodeConfigObject,
    position: { x: index * NODE_X_SPACING, y: 0 },
  }));

  return {
    ok: true,
    definition: { dagId, version: 1, status: 'draft', nodes: dagNodes, edges: dagEdges },
  };
}

function extractMermaidFromFile(fileContent: string): string | null {
  const match = MERMAID_BLOCK_RE.exec(fileContent);
  return match ? (match[1] ?? '').trim() : null;
}

export async function fromMermaidCommand(
  args: readonly string[],
  options: IFromMermaidCommandOptions,
): Promise<number> {
  const { io } = options;

  if (args.includes('--help') || args.includes('-h')) {
    io.write(FROM_MERMAID_HELP);
    return SUCCESS_EXIT_CODE;
  }

  const parseResult = parseFromMermaidArgv(args);
  if (!parseResult.ok) {
    io.write(`Error: ${parseResult.message}\n`);
    return parseResult.exitCode;
  }

  const { source, outputPath, dagId, runAfter, inputs } = parseResult.value;

  // Determine mermaid text: file or inline string
  let mermaidText: string;
  if (source.endsWith('.dag.md') || source.endsWith('.md')) {
    let fileContent: string;
    try {
      fileContent = await io.readTextFile(source);
    } catch (readErr) {
      // allow-fallback: I/O error returned as structured error
      io.write(`Error: Failed to read file "${source}": ${resolveErrorMessage(readErr)}\n`);
      return FAILURE_EXIT_CODE;
    }
    const extracted = extractMermaidFromFile(fileContent);
    if (!extracted) {
      io.write(`Error: No mermaid code block found in "${source}".\n`);
      return FAILURE_EXIT_CODE;
    }
    mermaidText = extracted;
  } else {
    mermaidText = source;
  }

  // Build node registry
  const assemblyResult = buildNodeDefinitionAssembly(createCliNodeRegistry());
  if (!assemblyResult.ok) {
    io.write(`Error: Failed to build node registry: ${assemblyResult.error.message}\n`);
    return FAILURE_EXIT_CODE;
  }

  const { manifests } = assemblyResult.value;
  const buildResult = buildDagFromMermaidSpec(dagId, mermaidText, manifests);
  if (!buildResult.ok) {
    io.write(`Error: ${buildResult.message}\n`);
    return FAILURE_EXIT_CODE;
  }

  const dagDefinition = buildResult.definition;
  const dagJson = JSON.stringify(dagDefinition, null, JSON_INDENT_SPACES);

  if (outputPath) {
    const dir = outputPath.slice(0, Math.max(0, outputPath.lastIndexOf('/')));
    if (dir) {
      try {
        await mkdir(dir, { recursive: true });
      } catch {
        // allow-fallback: directory creation errors are ignored (may already exist)
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

  // Build input payload
  const inputPayload: Record<string, string> = {};
  for (const raw of inputs) {
    const eqIdx = raw.indexOf('=');
    inputPayload[raw.slice(0, eqIdx)] = raw.slice(eqIdx + 1);
  }

  const runner = new LocalDagRunner(createCliNodeRegistry());
  let runResult;
  try {
    runResult = await runner.run(dagDefinition, inputPayload); // allow-fallback: run error reported as structured output and non-zero exit
  } catch (runErr) {
    // allow-fallback: run error reported as structured output and non-zero exit
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
