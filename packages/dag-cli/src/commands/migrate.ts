import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { IDagCliIo } from '../types.js';
import { USAGE_ERROR_EXIT_CODE, SUCCESS_EXIT_CODE } from '../types.js';
import {
  isLegacyDefinitionFormat,
  isWorkflowFileFormat,
  toDagWorkflowFile,
} from '@robota-sdk/dag-builder';

const JSON_INDENT_SPACES = 2;

export interface IMigrateCommandOptions {
  readonly io: IDagCliIo;
}

interface IParsedMigrateOptions {
  readonly file: string;
  readonly backup: boolean;
  readonly dryRun: boolean;
}

/** Run the `dag-cli migrate <file>` subcommand. */
export async function runMigrateCommand(
  argv: readonly string[],
  opts: IMigrateCommandOptions,
): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    opts.io.write(`Error: ${parsed.message}\n`);
    return USAGE_ERROR_EXIT_CODE;
  }

  const { file, backup, dryRun } = parsed;

  // Read source file
  let text: string;
  try {
    // allow-fallback: file-not-found converted to user-facing error
    text = await readFile(file, 'utf8');
  } catch (err) {
    // allow-fallback: I/O error shown to user
    opts.io.write(
      `Error: Cannot read "${file}": ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return USAGE_ERROR_EXIT_CODE;
  }

  let parsed2: unknown;
  try {
    // allow-fallback: parse error converted to user-facing error
    parsed2 = JSON.parse(text) as unknown;
  } catch (err) {
    // allow-fallback: JSON parse error shown to user
    opts.io.write(
      `Error: Cannot parse JSON in "${file}": ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return USAGE_ERROR_EXIT_CODE;
  }

  if (isWorkflowFileFormat(parsed2)) {
    opts.io.write(`"${file}" is already in workflow file format. No migration needed.\n`);
    return SUCCESS_EXIT_CODE;
  }

  if (!isLegacyDefinitionFormat(parsed2)) {
    opts.io.write(`Error: "${file}" is not a recognized DAG file format.\n`);
    return USAGE_ERROR_EXIT_CODE;
  }

  const { workflowFile, companion } = toDagWorkflowFile(parsed2);

  const workflowJson = JSON.stringify(workflowFile, null, JSON_INDENT_SPACES);
  const companionJson = JSON.stringify(companion, null, JSON_INDENT_SPACES);

  const companionPath = file.replace(/\.dag\.json$/, '.dag.robota.json');

  if (dryRun) {
    opts.io.write(`[dry-run] Would write workflow file → ${file}\n`);
    opts.io.write(`[dry-run] Would write companion    → ${companionPath}\n`);
    opts.io.write('\n--- workflow file preview ---\n');
    opts.io.write(workflowJson + '\n');
    opts.io.write('\n--- companion preview ---\n');
    opts.io.write(companionJson + '\n');
    return SUCCESS_EXIT_CODE;
  }

  if (backup) {
    const backupPath = `${file}.bak`;
    await rename(file, backupPath);
    opts.io.write(`Backup written → ${backupPath}\n`);
  }

  await writeFile(file, workflowJson, 'utf8');
  opts.io.write(`Workflow file written → ${file}\n`);

  if (existsSync(companionPath)) {
    opts.io.write(`Warning: "${companionPath}" already exists — skipping companion write.\n`);
  } else {
    await writeFile(companionPath, companionJson, 'utf8');
    opts.io.write(`Companion written     → ${companionPath}\n`);
  }

  opts.io.write('Migration complete.\n');
  return SUCCESS_EXIT_CODE;
}

type TParseResult =
  | ({ readonly ok: true } & IParsedMigrateOptions)
  | { readonly ok: false; readonly message: string };

function parseArgs(argv: readonly string[]): TParseResult {
  const args = argv.slice();
  let file: string | undefined;
  let backup = false;
  let dryRun = false;

  while (args.length > 0) {
    const arg = args.shift()!;
    if (arg === '--backup' || arg === '-b') {
      backup = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (!arg.startsWith('-')) {
      file = arg;
    } else {
      return { ok: false, message: `Unknown option: ${arg}` };
    }
  }

  if (!file) {
    return {
      ok: false,
      message: 'migrate requires <file> argument (e.g. dag-cli migrate workflow.dag.json).',
    };
  }

  return { ok: true, file, backup, dryRun };
}
