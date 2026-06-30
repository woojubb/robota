import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  IDagDefinition,
  IDagEdgeDefinition,
  IDagNode,
  INodeConfigObject,
} from '@robota-sdk/dag-core';
import { buildNodeDefinitionAssembly } from '@robota-sdk/dag-node';
import type { IDagCliIo } from '../types.js';
import { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE, USAGE_ERROR_EXIT_CODE } from '../types.js';
import { createCliNodeRegistry } from '../local-runner/index.js';
import { parsePipelineSpec } from '../pipeline-parser.js';
import { DEFAULT_CATALOG_DIR } from '../catalog/catalog-scanner.js';

const JSON_INDENT_SPACES = 2;
const NODE_X_SPACING = 300;

const SAVE_HELP = `Usage: dag save --pipeline "<spec>" --name <name> [--node-config <nodeId.key=value>]

Save an inline pipeline to the local catalog (.dag/workflows/).

Options:
  --pipeline <spec>          Pipeline spec (e.g. "input | transform | text-output")
  --name <name>              Name for the saved workflow (becomes the file stem and dagId)
  --node-config <id.key=val> Override node config (repeatable)

Examples:
  dag save --pipeline "input | transform | text-output" --name my-transform \\
    --node-config "transform.prefix=→ "
  dag save --pipeline "input | llm-text-anthropic | text-output" --name summarizer
`;

export interface ISaveCommandOptions {
  readonly io: IDagCliIo;
}

interface IParsedSaveOptions {
  readonly pipeline: string;
  readonly name: string;
  readonly nodeConfigs: ReadonlyArray<string>;
}

type TParseResult =
  | { readonly ok: true; readonly value: IParsedSaveOptions }
  | { readonly ok: false; readonly exitCode: number; readonly message: string };

function parseSaveArgv(args: readonly string[]): TParseResult {
  let pipeline: string | undefined;
  let name: string | undefined;
  const nodeConfigs: string[] = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--pipeline') {
      const next = args[i + 1];
      if (typeof next !== 'string' || next.startsWith('--')) {
        return {
          ok: false,
          exitCode: USAGE_ERROR_EXIT_CODE,
          message: '--pipeline requires a value.',
        };
      }
      pipeline = next;
      i += 2;
    } else if (arg === '--name') {
      const next = args[i + 1];
      if (typeof next !== 'string' || next.startsWith('--')) {
        return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: '--name requires a value.' };
      }
      name = next;
      i += 2;
    } else if (arg === '--node-config') {
      const next = args[i + 1];
      if (typeof next !== 'string' || next.startsWith('--')) {
        return {
          ok: false,
          exitCode: USAGE_ERROR_EXIT_CODE,
          message: '--node-config requires a key=value argument.',
        };
      }
      const dotIdx = next.indexOf('.');
      const eqIdx = next.indexOf('=');
      if (dotIdx === -1 || eqIdx === -1 || dotIdx > eqIdx) {
        return {
          ok: false,
          exitCode: USAGE_ERROR_EXIT_CODE,
          message: `--node-config must be in nodeId.key=value format, got: "${next}".`,
        };
      }
      nodeConfigs.push(next);
      i += 2;
    } else if ((arg as string | undefined)?.startsWith('--')) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: `save received unexpected flag: ${arg}.`,
      };
    } else {
      i += 1;
    }
  }

  if (!pipeline) {
    return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: '--pipeline is required.' };
  }
  if (!name) {
    return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: '--name is required.' };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `--name must contain only letters, numbers, hyphens, and underscores. Got: "${name}".`,
    };
  }

  return { ok: true, value: { pipeline, name, nodeConfigs } };
}

function buildDagFromPipelineSpec(
  dagId: string,
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
    const from = resolved[i]!;
    const to = resolved[i + 1]!;
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

  return {
    ok: true,
    definition: {
      dagId,
      version: 1,
      status: 'draft',
      nodes: dagNodes,
      edges: dagEdges,
    },
  };
}

function applyNodeConfigs(
  definition: IDagDefinition,
  nodeConfigs: ReadonlyArray<string>,
  io: IDagCliIo,
): IDagDefinition {
  if (nodeConfigs.length === 0) return definition;

  const overridesMap = new Map<string, Record<string, string>>();
  for (const raw of nodeConfigs) {
    const dotIdx = raw.indexOf('.');
    const eqIdx = raw.indexOf('=');
    const nodeId = raw.slice(0, dotIdx);
    const key = raw.slice(dotIdx + 1, eqIdx);
    const val = raw.slice(eqIdx + 1);
    const nodeExists = definition.nodes.some((n) => n.nodeId === nodeId);
    if (!nodeExists) {
      io.write(`⚠ --node-config: node "${nodeId}" not found — skipped\n`);
      continue;
    }
    const existing = overridesMap.get(nodeId) ?? {};
    overridesMap.set(nodeId, { ...existing, [key]: val });
  }

  const updatedNodes = definition.nodes.map((node) => {
    const overrides = overridesMap.get(node.nodeId);
    if (!overrides) return node;
    return {
      ...node,
      config: { ...(node.config as Record<string, unknown>), ...overrides } as INodeConfigObject,
    };
  });

  return { ...definition, nodes: updatedNodes };
}

export async function saveCommand(
  args: readonly string[],
  options: ISaveCommandOptions,
): Promise<number> {
  const { io } = options;

  if (args.includes('--help') || args.includes('-h')) {
    io.write(SAVE_HELP);
    return SUCCESS_EXIT_CODE;
  }

  const parseResult = parseSaveArgv(args);
  if (!parseResult.ok) {
    io.write(`Error: ${parseResult.message}\n`);
    return parseResult.exitCode;
  }

  const { pipeline, name, nodeConfigs } = parseResult.value;

  const nodeDefinitions = createCliNodeRegistry();
  const assemblyResult = buildNodeDefinitionAssembly(nodeDefinitions);
  if (!assemblyResult.ok) {
    io.write(`Error: Failed to build node registry: ${assemblyResult.error.message}\n`);
    return FAILURE_EXIT_CODE;
  }

  const { manifests } = assemblyResult.value;
  const buildResult = buildDagFromPipelineSpec(name, pipeline, manifests);
  if (!buildResult.ok) {
    io.write(`Error: ${buildResult.message}\n`);
    return FAILURE_EXIT_CODE;
  }

  const definition = applyNodeConfigs(buildResult.definition, nodeConfigs, io);

  const workflowsDir = DEFAULT_CATALOG_DIR;
  try {
    await mkdir(workflowsDir, { recursive: true });
  } catch (mkdirErr) {
    // allow-fallback: directory creation failure reported as structured error
    const msg = mkdirErr instanceof Error ? mkdirErr.message : String(mkdirErr);
    io.write(`Error: Failed to create workflows directory: ${msg}\n`);
    return FAILURE_EXIT_CODE;
  }

  const outputPath = join(workflowsDir, `${name}.dag.json`);
  const dagJson = JSON.stringify(definition, null, JSON_INDENT_SPACES);
  try {
    await writeFile(outputPath, dagJson + '\n', 'utf8');
  } catch (writeErr) {
    // allow-fallback: file write failure reported as structured error and non-zero exit
    const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
    io.write(`Error: Failed to write workflow file: ${msg}\n`);
    return FAILURE_EXIT_CODE;
  }

  io.write(`Saved: ${outputPath}\n`);
  io.write(`Run:   dag catalog run ${name} --input text="..."\n`);
  return SUCCESS_EXIT_CODE;
}
