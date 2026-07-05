import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_WORKSPACE_LAYOUT } from '@robota-sdk/dag-core';
import type { IWorkspaceLayout } from '@robota-sdk/dag-core';
import type { IDagCliIo } from '../types.js';
import { FAILURE_EXIT_CODE, USAGE_ERROR_EXIT_CODE, SUCCESS_EXIT_CODE } from '../types.js';
import {
  scanCatalogDir,
  resolveCatalogDirs,
  matchesCatalogQuery,
  DEFAULT_CATALOG_DIR,
} from '../catalog/catalog-scanner.js';
import type { ICatalogEntry } from '../catalog/catalog-scanner.js';
import type { LocalDagRunner } from '../local-runner/index.js';
import { runCommand } from './run.js';

const JSON_INDENT_SPACES = 2;

export interface ICatalogCommandOptions {
  readonly io: IDagCliIo;
  readonly createRunner?: () => LocalDagRunner;
  /** FLOW-007: injected workspace layout (default `.workflows/`). */
  readonly workspace?: IWorkspaceLayout;
}

type TCatalogSubcommand = 'list' | 'run' | 'info' | 'search' | 'history';

type TParseResult =
  | { readonly ok: true; readonly subcommand: TCatalogSubcommand; readonly rest: readonly string[] }
  | { readonly ok: false; readonly exitCode: number; readonly message: string };

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

function parseCatalogArgv(args: readonly string[]): TParseResult {
  const subcommand = args[0] as TCatalogSubcommand | undefined;
  const VALID = ['list', 'run', 'info', 'search', 'history'];

  if (!subcommand || !VALID.includes(subcommand)) {
    const detail = subcommand
      ? `Unknown catalog subcommand "${subcommand}". Valid: ${VALID.join(', ')}.`
      : `catalog requires a subcommand (${VALID.join(', ')}).\n\nExamples:\n  dag catalog list\n  dag catalog history`;
    return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: detail };
  }

  return { ok: true, subcommand, rest: args.slice(1) };
}

async function loadEntries(
  dirs: string[],
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<ICatalogEntry[]> {
  const allEntries: ICatalogEntry[] = [];
  for (const dir of dirs) {
    const entries = await scanCatalogDir(dir, layout);
    for (const entry of entries) {
      if (!allEntries.some((e) => e.id === entry.id)) {
        allEntries.push(entry);
      }
    }
  }
  allEntries.sort((a, b) => a.id.localeCompare(b.id));
  return allEntries;
}

async function handleListCommand(
  rest: readonly string[],
  options: ICatalogCommandOptions,
): Promise<number> {
  const { io } = options;

  const catalogResult = takeSingleOption(rest, '--catalog');
  if (catalogResult.error) {
    io.write(`Error: ${catalogResult.error}\n`);
    return USAGE_ERROR_EXIT_CODE;
  }

  const layout = options.workspace ?? DEFAULT_WORKSPACE_LAYOUT;
  const globalFlag = catalogResult.remaining.includes('--global');
  const allFlag = catalogResult.remaining.includes('--all');

  const dirs = resolveCatalogDirs({
    catalogDir: catalogResult.value ?? layout.root,
    global: globalFlag,
    all: allFlag,
  });

  const entries = await loadEntries(dirs, layout);
  const dirLabel = dirs[0] ?? DEFAULT_CATALOG_DIR;

  if (entries.length === 0) {
    io.write(`No workflows found in ${dirLabel}\n`);
    io.write(`Run: robota-dag init  to scaffold a starter workflow.\n`);
    return SUCCESS_EXIT_CODE;
  }

  io.write(`\nWorkflows in ${dirLabel} (${entries.length} found)\n\n`);
  for (const entry of entries) {
    const desc = entry.meta.description ?? entry.meta.displayName ?? '';
    const nodeCount = entry.definition.nodes?.length ?? 0;
    io.write(`  ${entry.id.padEnd(24)} ${desc.padEnd(36)} ${nodeCount} nodes\n`);
  }
  io.write(`\nRun: robota-dag catalog run <id> --input key=value\n`);
  return SUCCESS_EXIT_CODE;
}

async function handleRunCommand(
  rest: readonly string[],
  options: ICatalogCommandOptions,
): Promise<number> {
  const { io } = options;

  const catalogResult = takeSingleOption(rest, '--catalog');
  if (catalogResult.error) {
    io.write(`Error: ${catalogResult.error}\n`);
    return USAGE_ERROR_EXIT_CODE;
  }

  const layout = options.workspace ?? DEFAULT_WORKSPACE_LAYOUT;
  const dirs = resolveCatalogDirs({ catalogDir: catalogResult.value ?? layout.root });

  // The positional id must be first in remaining; everything after is forwarded to runCommand.
  const argsWithoutCatalog = catalogResult.remaining;
  const firstNonFlag = argsWithoutCatalog.findIndex((a) => !a.startsWith('--'));

  if (firstNonFlag === -1) {
    io.write(`Error: catalog run requires <id> argument.\n`);
    return USAGE_ERROR_EXIT_CODE;
  }

  const id = argsWithoutCatalog[firstNonFlag] as string;
  // Forward all args except the id itself to runCommand
  const forwardArgs = [
    ...argsWithoutCatalog.slice(0, firstNonFlag),
    ...argsWithoutCatalog.slice(firstNonFlag + 1),
  ];

  const entries = await loadEntries(dirs, layout);
  const entry = entries.find((e) => e.id === id);
  if (!entry) {
    io.write(`Error: No workflow found with id "${id}".\n`);
    const similar = entries.filter((e) => e.id.includes(id) || id.includes(e.id));
    if (similar.length > 0) {
      io.write(`  Did you mean: ${similar.map((e) => e.id).join(', ')}?\n`);
    }
    return FAILURE_EXIT_CODE;
  }

  // Delegate to runCommand with the resolved file path
  return runCommand([entry.filePath, ...forwardArgs], {
    io,
    createRunner: options.createRunner,
    workspace: layout,
  });
}

async function handleInfoCommand(
  rest: readonly string[],
  options: ICatalogCommandOptions,
): Promise<number> {
  const { io } = options;

  const catalogResult = takeSingleOption(rest, '--catalog');
  if (catalogResult.error) {
    io.write(`Error: ${catalogResult.error}\n`);
    return USAGE_ERROR_EXIT_CODE;
  }

  const layout = options.workspace ?? DEFAULT_WORKSPACE_LAYOUT;
  const dirs = resolveCatalogDirs({ catalogDir: catalogResult.value ?? layout.root });
  const positional = catalogResult.remaining.filter((a) => !a.startsWith('--'));

  const id = positional[0];
  if (!id) {
    io.write(`Error: catalog info requires <id> argument.\n`);
    return USAGE_ERROR_EXIT_CODE;
  }

  const outputResult = takeSingleOption(catalogResult.remaining, '--output');
  const outputFormat = outputResult.value ?? 'pretty';

  const entries = await loadEntries(dirs, layout);
  const entry = entries.find((e) => e.id === id);
  if (!entry) {
    io.write(`Error: No workflow found with id "${id}".\n`);
    return FAILURE_EXIT_CODE;
  }

  if (outputFormat === 'json') {
    io.write(
      `${JSON.stringify(
        {
          id: entry.id,
          filePath: entry.filePath,
          meta: entry.meta,
          nodeCount: entry.definition.nodes?.length ?? 0,
          dagId: entry.definition.dagId,
          version: entry.definition.version,
        },
        null,
        JSON_INDENT_SPACES,
      )}\n`,
    );
    return SUCCESS_EXIT_CODE;
  }

  // Pretty output
  io.write(`\nWorkflow: ${entry.id}\n`);
  io.write(`  File:    ${entry.filePath}\n`);
  if (entry.meta.description) {
    io.write(`  Desc:    ${entry.meta.description}\n`);
  }
  if (entry.meta.tags && entry.meta.tags.length > 0) {
    io.write(`  Tags:    [${entry.meta.tags.join(', ')}]\n`);
  }
  io.write(`  Nodes:   ${entry.definition.nodes?.length ?? 0}\n`);
  io.write(`\n`);
  return SUCCESS_EXIT_CODE;
}

async function handleSearchCommand(
  rest: readonly string[],
  options: ICatalogCommandOptions,
): Promise<number> {
  const { io } = options;

  const catalogResult = takeSingleOption(rest, '--catalog');
  if (catalogResult.error) {
    io.write(`Error: ${catalogResult.error}\n`);
    return USAGE_ERROR_EXIT_CODE;
  }

  const layout = options.workspace ?? DEFAULT_WORKSPACE_LAYOUT;
  const globalFlag = catalogResult.remaining.includes('--global');
  const allFlag = catalogResult.remaining.includes('--all');
  const dirs = resolveCatalogDirs({
    catalogDir: catalogResult.value ?? layout.root,
    global: globalFlag,
    all: allFlag,
  });

  const positional = catalogResult.remaining.filter((a) => !a.startsWith('--'));
  const query = positional[0];
  if (!query) {
    io.write(`Error: catalog search requires <query> argument.\n`);
    return USAGE_ERROR_EXIT_CODE;
  }

  const entries = await loadEntries(dirs, layout);
  const matches = entries.filter((e) => matchesCatalogQuery(e, query));

  if (matches.length === 0) {
    io.write(`No workflows matched "${query}".\n`);
    return SUCCESS_EXIT_CODE;
  }

  io.write(`\nResults for "${query}":\n\n`);
  for (const entry of matches) {
    const desc = entry.meta.description ?? entry.meta.displayName ?? '';
    io.write(`  ${entry.id.padEnd(24)} ${desc}\n`);
  }
  io.write(`\n`);
  return SUCCESS_EXIT_CODE;
}

/**
 * Execute the `robota-dag catalog` subcommand family.
 *
 * @param args - The argv slice starting after the `catalog` keyword.
 * @param options - IO abstraction and optional runner factory.
 * @returns Exit code.
 */
export async function catalogCommand(
  args: readonly string[],
  options: ICatalogCommandOptions,
): Promise<number> {
  const parseResult = parseCatalogArgv(args);
  if (!parseResult.ok) {
    options.io.write(`Error: ${parseResult.message}\n`);
    return parseResult.exitCode;
  }

  const { subcommand, rest } = parseResult;

  if (subcommand === 'list') return handleListCommand(rest, options);
  if (subcommand === 'run') return handleRunCommand(rest, options);
  if (subcommand === 'info') return handleInfoCommand(rest, options);
  if (subcommand === 'search') return handleSearchCommand(rest, options);
  if (subcommand === 'history') return handleHistoryCommand(options);

  options.io.write(`Error: Unknown catalog subcommand.\n`);
  return USAGE_ERROR_EXIT_CODE;
}

const RUN_HISTORY_FILE = join('.dag', '.run-history.json');
const HISTORY_DISPLAY_LIMIT = 20; // eslint-disable-line @typescript-eslint/no-magic-numbers

interface IRunHistoryEntry {
  file: string;
  date: string;
  status: 'success' | 'failed';
}

async function handleHistoryCommand(options: ICatalogCommandOptions): Promise<number> {
  const { io } = options;
  let entries: IRunHistoryEntry[] = [];

  try {
    const text = await readFile(RUN_HISTORY_FILE, 'utf8');
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed))
      entries = (parsed as IRunHistoryEntry[]).slice(-HISTORY_DISPLAY_LIMIT).reverse();
  } catch (_readErr) {
    // allow-fallback: no history file means no runs yet
    void _readErr;
  }

  if (entries.length === 0) {
    io.write(`실행 기록이 없습니다.\n`);
    io.write(`dag run <file>  을 실행하면 기록이 여기에 나타납니다.\n`);
    return SUCCESS_EXIT_CODE;
  }

  io.write(`\n최근 실행 기록 (최대 ${HISTORY_DISPLAY_LIMIT}개)\n\n`);
  for (const entry of entries) {
    const icon = entry.status === 'success' ? '✓' : '✗';
    const dateStr = entry.date.slice(0, 19).replace('T', ' ');
    io.write(`  ${icon} ${dateStr}  ${entry.file}\n`);
  }
  io.write(`\n총 ${entries.length}개 기록\n`);
  return SUCCESS_EXIT_CODE;
}
