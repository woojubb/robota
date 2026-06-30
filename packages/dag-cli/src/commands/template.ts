import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, unlink, readFile } from 'node:fs/promises';
import { buildDagFromPipeline } from '@robota-sdk/dag-builder';
import { TEMPLATE_REGISTRY, buildPipelineFromTemplate } from '../templates/dag-templates.js';
import type { IDagCliIo } from '../types.js';
import { runCommand } from './run.js';
import { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE } from '../types.js';
import type { LocalDagRunner } from '../local-runner/index.js';
import { createCliNodeRegistry } from '../local-runner/index.js';
import { buildNodeDefinitionAssembly } from '@robota-sdk/dag-node';

const JSON_INDENT_SPACES = 2;

export interface ITemplateCommandOptions {
  readonly io?: IDagCliIo;
  readonly createRunner?: () => LocalDagRunner;
}

/** Parse `--slot key=value` arguments from argv */
function parseSlotArgs(args: readonly string[]): Record<string, unknown> | string {
  const slots: Record<string, unknown> = {};
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--slot' || arg === '-s') {
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        return `--slot requires a "key=value" argument`;
      }
      const eqIdx = next.indexOf('=');
      if (eqIdx === -1) {
        return `--slot value must be in "key=value" format, got: "${next}"`;
      }
      const key = next.slice(0, eqIdx);
      const value = next.slice(eqIdx + 1);
      slots[key] = value;
      i += 2;
    } else {
      i += 1;
    }
  }
  return slots;
}

function handleListSubcommand(io: IDagCliIo): number {
  const rows = TEMPLATE_REGISTRY.map((t) => ({
    id: t.id,
    description: t.description,
    topology: t.topology,
  }));
  io.write(JSON.stringify(rows, null, JSON_INDENT_SPACES) + '\n');
  return SUCCESS_EXIT_CODE;
}

function handleInfoSubcommand(id: string, io: IDagCliIo): number {
  const tmpl = TEMPLATE_REGISTRY.find((t) => t.id === id);
  if (!tmpl) {
    io.write(
      `Error: Unknown template "${id}". Available: ${TEMPLATE_REGISTRY.map((t) => t.id).join(', ')}\n`,
    );
    return FAILURE_EXIT_CODE;
  }
  io.write(JSON.stringify(tmpl, null, JSON_INDENT_SPACES) + '\n');
  return SUCCESS_EXIT_CODE;
}

async function handleRunSubcommand(
  id: string,
  remainingArgs: readonly string[],
  io: IDagCliIo,
  options: ITemplateCommandOptions,
): Promise<number> {
  const slotResult = parseSlotArgs(remainingArgs);
  if (typeof slotResult === 'string') {
    io.write('Error: ' + slotResult + '\n');
    return FAILURE_EXIT_CODE;
  }

  // Build slots: wrap top-level string values as node specs where needed
  // For multi-node slots like `steps`, collect indexed values: steps[0]=nodeType:...
  // For simplicity, accept JSON-stringified slots via --slot key='{"nodeType":"..."}'
  const slots: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(slotResult)) {
    if (typeof value === 'string') {
      try {
        slots[key] = JSON.parse(value) as unknown;
      } catch {
        // allow-fallback: non-JSON slot value is treated as plain string
        slots[key] = value;
      }
    } else {
      slots[key] = value;
    }
  }

  const templateResult = buildPipelineFromTemplate(id, slots);
  if (!templateResult.ok) {
    io.write('Error: ' + templateResult.error + '\n');
    return FAILURE_EXIT_CODE;
  }

  const assemblyResult = buildNodeDefinitionAssembly(createCliNodeRegistry());
  if (!assemblyResult.ok) {
    io.write(`Error: Node registry assembly failed: ${assemblyResult.error.code}\n`);
    return FAILURE_EXIT_CODE;
  }

  const buildResult = buildDagFromPipeline(
    templateResult.buildInput,
    assemblyResult.value.manifests,
  );
  if (!buildResult.ok) {
    io.write(`Error: DAG build failed: ${buildResult.error.message}\n`);
    return FAILURE_EXIT_CODE;
  }

  const tmpFile = join(tmpdir(), `dag-template-${Date.now()}.dag.json`);

  try {
    // allow-fallback: file errors returned as CLI error messages
    await writeFile(tmpFile, JSON.stringify(buildResult.definition, null, JSON_INDENT_SPACES));
    const exitCode = await runCommand([tmpFile], { io, createRunner: options.createRunner });
    return exitCode;
  } catch (err) {
    // allow-fallback: file errors returned as CLI error messages
    io.write(
      `Error: Failed to run template DAG: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return FAILURE_EXIT_CODE;
  } finally {
    try {
      // allow-fallback: cleanup failure is non-fatal
      await unlink(tmpFile);
    } catch {
      // allow-fallback: best-effort cleanup, non-fatal
      // intentionally empty
    }
  }
}

export async function templateCommand(
  args: readonly string[],
  options: ITemplateCommandOptions = {},
): Promise<number> {
  const io: IDagCliIo = options.io ?? {
    write: (msg: string) => process.stdout.write(msg),
    writeError: (msg: string) => process.stderr.write(msg),
    readTextFile: (filePath: string) => readFile(filePath, 'utf8'),
    writeBinaryStream: async () => {
      /* no-op: template command does not produce binary output */
    },
  };

  const subcommand = args[0];
  if (!subcommand) {
    io.write('Error: Usage: robota-dag template <list|info <id>|run <id> [--slot key=value...]>\n');
    return FAILURE_EXIT_CODE;
  }

  switch (subcommand) {
    case 'list':
      return handleListSubcommand(io);

    case 'info': {
      const id = args[1];
      if (!id) {
        io.write('Error: Usage: robota-dag template info <templateId>\n');
        return FAILURE_EXIT_CODE;
      }
      return handleInfoSubcommand(id, io);
    }

    case 'run': {
      const id = args[1];
      if (!id) {
        io.write('Error: Usage: robota-dag template run <templateId> [--slot key=value...]\n');
        return FAILURE_EXIT_CODE;
      }
      return handleRunSubcommand(id, args.slice(2), io, options);
    }

    default:
      io.write(`Error: Unknown template subcommand "${subcommand}". Use list, info, or run.\n`);
      return FAILURE_EXIT_CODE;
  }
}
