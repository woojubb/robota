// PROVIDER-011: `robota-dag runs` command — manage detached runs and inspect
// run history. Short-lived local runs are surfaced through `robota-dag run`.
//
// Subcommands:
//   dag runs list     [--phase <phase>]      (reads SQLite local history)
//   dag runs status   <runId>
//   dag runs cancel   <runId>
//   dag runs submit   <file>

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getRunStore } from '../run-store.js';
import type {
  IDagRuntimeProvider,
  IDetachableRunProvider,
  IDagWorkflowFile,
} from '@robota-sdk/dag-core';
import { FAILURE_EXIT_CODE, USAGE_ERROR_EXIT_CODE, SUCCESS_EXIT_CODE } from '../types.js';
import type { IDagCliIo } from '../types.js';
import { resolveProvider } from '../providers/index.js';

const JSON_INDENT = 2;

export interface IRunsCommandOptions {
  readonly io: IDagCliIo;
}

const HELP_TEXT = `Usage: dag runs <subcommand> [options]

Subcommands:
  list                          List recent runs
  status <runId>                Get the status of a single run
  cancel <runId>                Cancel a queued or running run
  submit <file>                 Submit a workflow for execution

Options:
  --provider <local|http>       Runtime provider (default: from env or 'local')
  --server-url <url>            Native runtime server URL for --provider http
                                (overrides DAG_RUNTIME_SERVER_URL)
  --phase <phase>               Filter list by phase (queued|running|completed|failed|cancelled)
  --limit <n>                   Maximum number of entries to return
  --output <json|pretty>        Output format (default: pretty)
  --help                        Show this help message
`;

const allowedPhases = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
type TAllowedPhase = (typeof allowedPhases)[number];

interface IParsedRunsArgs {
  readonly subcommand: string;
  readonly positional: string[];
  readonly provider?: string;
  readonly serverUrl?: string;
  readonly phase?: string;
  readonly limit?: number;
  readonly outputFormat: 'json' | 'pretty';
}

type TParseResult =
  | { ok: true; value: IParsedRunsArgs }
  | { ok: false; exitCode: number; message: string; isHelp?: boolean };

function takeFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  if (typeof value !== 'string' || value.startsWith('--')) return undefined;
  args.splice(idx, 2);
  return value;
}

function parseRunsArgv(args: readonly string[]): TParseResult {
  const mutable = [...args];

  if (mutable.includes('--help') || mutable.length === 0) {
    return { ok: false, exitCode: SUCCESS_EXIT_CODE, message: HELP_TEXT, isHelp: true };
  }

  const provider = takeFlag(mutable, '--provider');
  const serverUrl = takeFlag(mutable, '--server-url');
  const phase = takeFlag(mutable, '--phase');
  const limitRaw = takeFlag(mutable, '--limit');
  const outputRaw = takeFlag(mutable, '--output') ?? 'pretty';

  if (outputRaw !== 'pretty' && outputRaw !== 'json') {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: '--output must be "json" or "pretty".',
    };
  }

  let limit: number | undefined;
  if (limitRaw !== undefined) {
    const n = Number(limitRaw);
    if (!Number.isFinite(n) || n < 0) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: '--limit must be a non-negative number.',
      };
    }
    limit = n;
  }

  const subcommand = mutable[0];
  if (subcommand === undefined) {
    return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: HELP_TEXT };
  }
  const positional = mutable.slice(1).filter((a) => !a.startsWith('--'));

  return {
    ok: true,
    value: {
      subcommand,
      positional,
      ...(provider !== undefined ? { provider } : {}),
      ...(serverUrl !== undefined ? { serverUrl } : {}),
      ...(phase !== undefined ? { phase } : {}),
      ...(limit !== undefined ? { limit } : {}),
      outputFormat: outputRaw,
    },
  };
}

function isDetachable(provider: IDagRuntimeProvider): provider is IDetachableRunProvider {
  const candidate = provider as IDetachableRunProvider;
  return (
    typeof candidate.submitRun === 'function' &&
    typeof candidate.listRuns === 'function' &&
    typeof candidate.cancelRun === 'function' &&
    typeof candidate.getRunStatus === 'function'
  );
}

export async function runsCommand(
  args: readonly string[],
  options: IRunsCommandOptions,
): Promise<number> {
  const { io } = options;
  const parseResult = parseRunsArgv(args);
  if (!parseResult.ok) {
    if (parseResult.isHelp) {
      io.write(parseResult.message);
    } else {
      io.writeError(`Error: ${parseResult.message}\n`);
    }
    return parseResult.exitCode;
  }

  const { subcommand, positional, provider, serverUrl, phase, limit, outputFormat } =
    parseResult.value;

  // `dag runs list` without --provider: read from local SQLite run history
  if (subcommand === 'list' && provider === undefined) {
    const storeOpts: { status?: string; limit?: number } = {};
    if (phase !== undefined) storeOpts.status = phase;
    if (limit !== undefined) storeOpts.limit = limit;
    const runs = getRunStore(process.cwd()).list(storeOpts);
    if (outputFormat === 'json') {
      io.write(`${JSON.stringify(runs, null, JSON_INDENT)}\n`);
    } else if (runs.length === 0) {
      io.write('No runs found. Run a DAG via `dag mcp` to populate history.\n');
    } else {
      io.write(`RUN_ID                                STATUS       COMPLETED_AT\n`);
      for (const run of runs) {
        const ts = new Date(run.completedAt).toISOString();
        io.write(`${run.runId.padEnd(38)}${run.status.padEnd(12)} ${ts}\n`);
      }
    }
    return SUCCESS_EXIT_CODE;
  }

  const resolveOpts: { provider?: string; serverUrl?: string } = {};
  if (provider !== undefined) resolveOpts.provider = provider;
  if (serverUrl !== undefined) resolveOpts.serverUrl = serverUrl;

  let runtimeProvider: IDagRuntimeProvider;
  try {
    runtimeProvider = await resolveProvider(resolveOpts);
  } catch (err) {
    // allow-fallback: provider resolution failure is reported to the user as a usage error
    io.writeError(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    return USAGE_ERROR_EXIT_CODE;
  }

  if (!isDetachable(runtimeProvider)) {
    io.writeError(
      `Error: provider "${runtimeProvider.providerId}" does not support detached run lifecycle.\n`,
    );
    return USAGE_ERROR_EXIT_CODE;
  }

  if (subcommand === 'list') {
    // No --provider: read from local SQLite history (.dag/runs.db)
    if (provider === undefined) {
      const store = getRunStore(process.cwd());
      const storeOpts: { status?: string; limit?: number } = {};
      if (phase !== undefined) storeOpts.status = phase;
      if (limit !== undefined) storeOpts.limit = limit;
      const runs = store.list(storeOpts);
      if (outputFormat === 'json') {
        io.write(`${JSON.stringify(runs, null, JSON_INDENT)}\n`);
        return SUCCESS_EXIT_CODE;
      }
      if (runs.length === 0) {
        io.write('No local run history found. Run a DAG via MCP or `dag run` to create records.\n');
        return SUCCESS_EXIT_CODE;
      }
      const COL_RUN = 26;
      const COL_DAG = 22;
      const COL_STATUS = 10;
      io.write(
        `${'Run ID'.padEnd(COL_RUN)} ${'DAG'.padEnd(COL_DAG)} ${'Status'.padEnd(COL_STATUS)} Started\n`,
      );
      io.write(`${'-'.repeat(COL_RUN + COL_DAG + COL_STATUS + 22)}\n`);
      for (const run of runs) {
        const started = new Date(run.completedAt).toISOString().replace('T', ' ').slice(0, 19);
        io.write(
          `${run.runId.slice(0, COL_RUN - 1).padEnd(COL_RUN)} ${run.dagId.slice(0, COL_DAG - 1).padEnd(COL_DAG)} ${run.status.padEnd(COL_STATUS)} ${started}\n`,
        );
      }
      return SUCCESS_EXIT_CODE;
    }

    const listOpts: { phase?: TAllowedPhase; limit?: number } = {};
    if (phase !== undefined) {
      if (!allowedPhases.includes(phase as TAllowedPhase)) {
        io.writeError(`Error: --phase must be one of ${allowedPhases.join(', ')}.\n`);
        return USAGE_ERROR_EXIT_CODE;
      }
      listOpts.phase = phase as TAllowedPhase;
    }
    if (limit !== undefined) listOpts.limit = limit;
    const runs = await runtimeProvider.listRuns(listOpts);
    if (outputFormat === 'json') {
      io.write(`${JSON.stringify(runs, null, JSON_INDENT)}\n`);
    } else if (runs.length === 0) {
      io.write('No runs found.\n');
    } else {
      io.write(`RUN_ID                                PHASE        SUBMITTED\n`);
      for (const run of runs) {
        io.write(`${run.runId.padEnd(38)}${run.phase.padEnd(12)} ${run.submittedAt}\n`);
      }
    }
    return SUCCESS_EXIT_CODE;
  }

  if (subcommand === 'status') {
    const runId = positional[0];
    if (!runId) {
      io.writeError('Error: status requires a runId argument.\n');
      return USAGE_ERROR_EXIT_CODE;
    }
    const status = await runtimeProvider.getRunStatus(runId);
    if (outputFormat === 'json') {
      io.write(`${JSON.stringify(status, null, JSON_INDENT)}\n`);
    } else {
      io.write(`Run:   ${status.runId}\n`);
      io.write(`Phase: ${status.phase}\n`);
      if (status.currentNodeId) io.write(`Node:  ${status.currentNodeId}\n`);
      if (status.error) io.write(`Error: ${status.error}\n`);
    }
    return status.phase === 'failed' ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE;
  }

  if (subcommand === 'cancel') {
    const runId = positional[0];
    if (!runId) {
      io.writeError('Error: cancel requires a runId argument.\n');
      return USAGE_ERROR_EXIT_CODE;
    }
    await runtimeProvider.cancelRun(runId);
    if (outputFormat === 'json') {
      io.write(`${JSON.stringify({ runId, cancelled: true }, null, JSON_INDENT)}\n`);
    } else {
      io.write(`Cancelled run ${runId}.\n`);
    }
    return SUCCESS_EXIT_CODE;
  }

  if (subcommand === 'submit') {
    const filePath = positional[0];
    if (!filePath) {
      io.writeError('Error: submit requires a workflow file path.\n');
      return USAGE_ERROR_EXIT_CODE;
    }
    const text = await readFile(resolve(filePath), 'utf8');
    const dag = JSON.parse(text) as IDagWorkflowFile;
    const runId = await runtimeProvider.submitRun(dag, {});
    if (outputFormat === 'json') {
      io.write(`${JSON.stringify({ runId }, null, JSON_INDENT)}\n`);
    } else {
      io.write(`Submitted ${filePath} as run ${runId}.\n`);
    }
    return SUCCESS_EXIT_CODE;
  }

  io.writeError(`Error: unknown subcommand "${subcommand}".\n\n${HELP_TEXT}`);
  return USAGE_ERROR_EXIT_CODE;
}
