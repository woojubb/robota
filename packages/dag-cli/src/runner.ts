import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { DEFAULT_WORKSPACE_LAYOUT } from '@robota-sdk/dag-core';
import type { IDagDefinition, IWorkspaceLayout, TPortPayload } from '@robota-sdk/dag-core';
import { DagOrchestrationHttpClient } from '@robota-sdk/dag-orchestration-client';
import { parseGlobalConfig } from './arguments.js';
import { dispatchDagCliCommand } from './runner-dispatch.js';
import { formatJsonOutput } from './json.js';
import type { IDagCliIo, IDagCliRunOptions, TDagCliFetch } from './types.js';
import { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE, USAGE_ERROR_EXIT_CODE } from './types.js';
import { runCommand } from './commands/run.js';
import { runsCommand } from './commands/runs.js';
import { validateCommand } from './commands/validate.js';
import { nodeCommand } from './commands/node.js';
import { initCommand } from './commands/init.js';
import { mcpCommand } from './commands/mcp.js';
import { catalogCommand } from './commands/catalog.js';
import { templateCommand } from './commands/template.js';
import { runMigrateCommand } from './commands/migrate.js';
import { doctorCommand } from './commands/doctor.js';
import { buildCommand } from './commands/build.js';
import { convertCommand } from './commands/convert.js';
import { diffCommand } from './commands/diff.js';
import { runCostCommand } from './commands/cost.js';
import { shareCommand } from './commands/share.js';
import { demoCommand } from './commands/demo.js';
import { explainCommand } from './commands/explain.js';
import { compareCommand } from './commands/compare.js';
import { tutorialCommand } from './commands/tutorial.js';
import { lockCommand } from './commands/lock.js';
import { telemetryCommand } from './commands/telemetry.js';
import { recordTelemetry } from './telemetry.js';
import { lintCommand } from './commands/lint.js';
import { keysCommand } from './commands/keys.js';
import { benchmarkCommand } from './commands/benchmark.js';
import { perfCommand } from './commands/perf.js';
import { aavCommand } from './commands/aav.js';
import { pipeCommand } from './commands/pipe.js';
import { saveCommand } from './commands/save.js';
import { aliasCommand } from './commands/alias.js';
import { fromMermaidCommand } from './commands/from-mermaid.js';
import { describeCommand } from './commands/describe.js';
import { fixCommand } from './commands/fix.js';
import { studioCommand } from './commands/studio.js';
import { viewCommand } from './commands/view.js';
import { sessionCommand } from './commands/session.js';

const UTF8_ENCODING = 'utf8';

const defaultIo: IDagCliIo = {
  write: (text: string) => {
    process.stdout.write(text);
  },
  writeError: (text: string) => {
    process.stderr.write(text);
  },
  readTextFile: async (filePath: string) => readFile(filePath, UTF8_ENCODING),
  writeBinaryStream: async (filePath, stream) => {
    await pipeline(
      Readable.fromWeb(stream as NodeReadableStream<Uint8Array>),
      createWriteStream(filePath),
    );
  },
};

const defaultFetch: TDagCliFetch = async (url: string, init?: RequestInit) => fetch(url, init);

const DOCTOR_FOOTER_DIVIDER = '──────────────────────────────────────────────────────────────';
const DOCTOR_FOOTER = `${DOCTOR_FOOTER_DIVIDER}\nTip: If you're seeing unexpected errors, run: dag doctor\n`;

/**
 * Determine whether the `dag doctor` recovery hint footer should be shown.
 * Conditions (all must be true):
 *  - Not the `doctor` subcommand itself.
 *  - Not CI mode (CI env var or --no-progress flag).
 *  - The text is a pretty-mode error line (starts with "Error:", not a JSON envelope).
 */
function shouldShowDoctorFooter(
  subcommand: string,
  args: readonly string[],
  text: string,
): boolean {
  if (subcommand === DOCTOR_SUBCOMMAND) return false;
  if (process.env['CI'] === 'true') return false;
  if (args.includes('--no-progress')) return false;
  // JSON output: text begins with `{` (error envelope) — skip footer.
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) return false;
  // Show footer only for lines that contain an "Error:" prefix.
  return trimmed.startsWith('Error:') || text.includes('\nError:');
}

/**
 * Wrap an `IDagCliIo` to append the `dag doctor` recovery hint after error messages
 * in pretty mode (non-CI, non-JSON, non-doctor subcommand).
 */
function wrapIoWithDoctorFooter(
  io: IDagCliIo,
  subcommand: string,
  args: readonly string[],
): IDagCliIo {
  return {
    write(text: string): void {
      io.write(text);
      if (shouldShowDoctorFooter(subcommand, args, text)) {
        io.write(DOCTOR_FOOTER);
      }
    },
    writeError(text: string): void {
      io.writeError(text);
      // writeError is always an error channel — always append doctor footer in the same
      // conditions as write() (non-doctor, non-CI, non-no-progress, non-JSON).
      if (shouldShowDoctorFooter(subcommand, args, text)) {
        io.writeError(DOCTOR_FOOTER);
      }
    },
    readTextFile: io.readTextFile.bind(io),
    writeBinaryStream: io.writeBinaryStream.bind(io),
  };
}

const RUN_SUBCOMMAND = 'run';
const RUNS_SUBCOMMAND = 'runs';
const VALIDATE_SUBCOMMAND = 'validate';
const NODE_SUBCOMMAND = 'node';
const INIT_SUBCOMMAND = 'init';
const MCP_SUBCOMMAND = 'mcp';
const CATALOG_SUBCOMMAND = 'catalog';
const TEMPLATE_SUBCOMMAND = 'template';
const MIGRATE_SUBCOMMAND = 'migrate';
const DOCTOR_SUBCOMMAND = 'doctor';
const BUILD_SUBCOMMAND = 'build';
const CONVERT_SUBCOMMAND = 'convert';
const DIFF_SUBCOMMAND = 'diff';
const COST_SUBCOMMAND = 'cost';
const SHARE_SUBCOMMAND = 'share';
const DEMO_SUBCOMMAND = 'demo';
const EXPLAIN_SUBCOMMAND = 'explain';
const COMPARE_SUBCOMMAND = 'compare';
const TUTORIAL_SUBCOMMAND = 'tutorial';
const LOCK_SUBCOMMAND = 'lock';
const TELEMETRY_SUBCOMMAND = 'telemetry';
const LINT_SUBCOMMAND = 'lint';
const KEYS_SUBCOMMAND = 'keys';
const BENCHMARK_SUBCOMMAND = 'benchmark';
const PERF_SUBCOMMAND = 'perf';
const AAV_SUBCOMMAND = 'aav';
const PIPE_SUBCOMMAND = 'pipe';
const SAVE_SUBCOMMAND = 'save';
const ALIAS_SUBCOMMAND = 'alias';
const FROM_MERMAID_SUBCOMMAND = 'from-mermaid';
const DESCRIBE_SUBCOMMAND = 'describe';
const FIX_SUBCOMMAND = 'fix';
const STUDIO_SUBCOMMAND = 'studio';
const VIEW_SUBCOMMAND = 'view';
const SESSION_SUBCOMMAND = 'session';
const SERVER_FLAG = '--server';

const TOP_LEVEL_HELP_TEXT = `dag — The DAG built for AI agents. Local-first, MCP-native, no server required.

[Quick Start]
  dag demo                          Try it now — no API key required
  dag run --pipeline \\
    "input | llm-text[provider=anthropic] | text-output" \\
    --input text="Hello"            Run a pipeline in one line

[For AI Agents (Claude Code / MCP)]
  dag init --claude                 Auto-configure .claude/mcp.json
  dag mcp --transport stdio         Start MCP server (28 tools for agents)
  dag mcp --inspect                 List all MCP tools with descriptions
  dag mcp schema                    Output tool schemas as JSON

[Getting Started]
  dag init                          Create a new DAG project
  dag tutorial                      Interactive onboarding (5 minutes)
  dag node list                     Browse available node types
  dag keys add <provider>           Add an API key

[Common Commands]
  dag run <file>                    Execute a workflow file
  dag validate <file>               Check for errors before running
  dag cost estimate <file>          Estimate API cost before running
  dag explain <file>                Describe a DAG's structure
  dag doctor                        Diagnose your environment

[Advanced]
  build, catalog, compare, convert, diff, lint, lock,
  migrate, runs, share, template, view
  → dag <command> --help

Version: dag --version
`;

export async function runDagCli(
  rawArgs: readonly string[],
  options: IDagCliRunOptions = {},
): Promise<number> {
  const io = options.io ?? defaultIo;
  const fetchImpl = options.fetch ?? defaultFetch;

  // FLOW-007: resolve the workspace layout from injected options or a leading `--workspace <dir>`
  // global flag, then strip the flag so subcommand dispatch sees the same argv shape as before.
  let workspace: IWorkspaceLayout = options.workspace ?? DEFAULT_WORKSPACE_LAYOUT;
  let args = rawArgs;
  if (args[0] === '--workspace') {
    const dir = args[1];
    if (typeof dir !== 'string' || dir.startsWith('--')) {
      io.write('Error: --workspace requires a directory value.\n');
      return USAGE_ERROR_EXIT_CODE;
    }
    workspace = { root: dir, workflowExt: workspace.workflowExt };
    args = args.slice(2);
  }

  // Top-level help: no args, --help, or -h
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    io.write(TOP_LEVEL_HELP_TEXT);
    return SUCCESS_EXIT_CODE;
  }

  // Wrap io with the doctor footer hint for all non-doctor subcommands.
  const subcommand = args[0] ?? '';
  const wrappedIo = wrapIoWithDoctorFooter(io, subcommand, args);

  // Route `demo` to local demo run (no API key required).
  if (args[0] === DEMO_SUBCOMMAND) {
    return demoCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `run` to local execution when no --server flag is present.
  if (args[0] === RUN_SUBCOMMAND && !args.includes(SERVER_FLAG)) {
    return runCommand(args.slice(1), { io: wrappedIo, workspace });
  }

  // Route `validate` to local validation.
  if (args[0] === VALIDATE_SUBCOMMAND) {
    return validateCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `runs` to detached-run provider management (PROVIDER-011).
  // Fall through to server dispatch when ROBOTA_DAG_SERVER_URL is configured
  // (preserves legacy orchestrator-server runs API).
  if (args[0] === RUNS_SUBCOMMAND) {
    const hasServerUrl = !!(
      options.env?.ROBOTA_DAG_SERVER_URL ?? process.env['ROBOTA_DAG_SERVER_URL']
    );
    if (!hasServerUrl || args.includes('--provider') || args.includes('--server-url')) {
      return runsCommand(args.slice(1), { io: wrappedIo });
    }
    // Fall through to server dispatch below.
  }

  // Route `node` subcommands to local node registry inspection.
  if (args[0] === NODE_SUBCOMMAND) {
    return nodeCommand(args.slice(1), { io: wrappedIo, workspace });
  }

  // Route `init` to project scaffolding.
  if (args[0] === INIT_SUBCOMMAND) {
    return initCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `mcp` to local MCP server.
  if (args[0] === MCP_SUBCOMMAND) {
    return mcpCommand(args.slice(1));
  }

  // Route `catalog` to local file catalog commands.
  if (args[0] === CATALOG_SUBCOMMAND) {
    return catalogCommand(args.slice(1), { io: wrappedIo, workspace });
  }

  // Route `template` to built-in topology templates.
  if (args[0] === TEMPLATE_SUBCOMMAND) {
    return templateCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `migrate` to DAG file format migration.
  if (args[0] === MIGRATE_SUBCOMMAND) {
    return runMigrateCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `doctor` to environment diagnostics (no footer wrapper — doctor is the recovery tool).
  if (args[0] === DOCTOR_SUBCOMMAND) {
    return doctorCommand(args.slice(1), { io });
  }

  // Route `build` to DAG file generation from a simplified spec.
  if (args[0] === BUILD_SUBCOMMAND) {
    return buildCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `convert` to spec format conversion (linear, mermaid → IBuildSpec JSON).
  if (args[0] === CONVERT_SUBCOMMAND) {
    return convertCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `diff` to structural diff between two DAG files.
  if (args[0] === DIFF_SUBCOMMAND) {
    return diffCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `cost` to cost estimation commands.
  if (args[0] === COST_SUBCOMMAND) {
    return runCostCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `share` to GitHub Gist sharing.
  if (args[0] === SHARE_SUBCOMMAND) {
    return shareCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `explain` to DAG pipeline explanation.
  if (args[0] === EXPLAIN_SUBCOMMAND) {
    return explainCommand(args.slice(1), { io });
  }

  // Route `compare` to provider comparison.
  if (args[0] === COMPARE_SUBCOMMAND) {
    return compareCommand(args.slice(1), { io });
  }

  // Route `tutorial` to interactive onboarding walkthrough.
  if (args[0] === TUTORIAL_SUBCOMMAND) {
    return tutorialCommand(args.slice(1), { io });
  }

  // Route `lock` to lockfile management.
  if (args[0] === LOCK_SUBCOMMAND) {
    const startMs = Date.now();
    const exitCode = await lockCommand(args.slice(1), { io: wrappedIo });
    void recordTelemetry({
      command: LOCK_SUBCOMMAND,
      success: exitCode === SUCCESS_EXIT_CODE,
      durationMs: Date.now() - startMs,
    });
    return exitCode;
  }

  // Route `telemetry` to telemetry opt-in/out management.
  if (args[0] === TELEMETRY_SUBCOMMAND) {
    return telemetryCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `lint` to DAG file linting.
  if (args[0] === LINT_SUBCOMMAND) {
    return lintCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `keys` to API key management.
  if (args[0] === KEYS_SUBCOMMAND) {
    return keysCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `benchmark` to multi-run latency/cost benchmarking (ECO-011).
  if (args[0] === BENCHMARK_SUBCOMMAND) {
    return benchmarkCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `perf` to in-process execution overhead measurement (PERF-010).
  if (args[0] === PERF_SUBCOMMAND) {
    return perfCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `aav` to Agent Authoring Velocity benchmark (COMPOSE-006).
  if (args[0] === AAV_SUBCOMMAND) {
    return aavCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `pipe` to stdin-text → pipeline → stdout.
  if (args[0] === PIPE_SUBCOMMAND) {
    return pipeCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `save` to pipeline → catalog file.
  if (args[0] === SAVE_SUBCOMMAND) {
    return saveCommand(args.slice(1), { io: wrappedIo, workspace });
  }

  // Route `alias` to alias management (add/list/remove).
  if (args[0] === ALIAS_SUBCOMMAND) {
    return aliasCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `from-mermaid` to Mermaid → DAG JSON conversion.
  if (args[0] === FROM_MERMAID_SUBCOMMAND) {
    return fromMermaidCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `describe` to natural-language → DAG generation (requires ANTHROPIC_API_KEY).
  if (args[0] === DESCRIBE_SUBCOMMAND) {
    return describeCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `fix` to broken-DAG analysis and repair.
  if (args[0] === FIX_SUBCOMMAND) {
    return fixCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `studio` to the local web UI server.
  if (args[0] === STUDIO_SUBCOMMAND) {
    return studioCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `view` to the ASCII flow diagram viewer.
  if (args[0] === VIEW_SUBCOMMAND) {
    return viewCommand(args.slice(1), { io: wrappedIo });
  }

  // Route `session` to bounded agent session management.
  if (args[0] === SESSION_SUBCOMMAND) {
    return sessionCommand(args.slice(1), { io: wrappedIo });
  }

  const config = parseGlobalConfig(args, options.env?.ROBOTA_DAG_SERVER_URL);

  if (config.failure) {
    io.write(formatJsonOutput(config.failure));
    return USAGE_ERROR_EXIT_CODE;
  }

  const client = new DagOrchestrationHttpClient({
    baseUrl: config.serverUrl,
    fetch: fetchImpl,
  });
  const result = await dispatchDagCliCommand(config.args, client, fetchImpl, io);
  io.write(formatJsonOutput(result.payload));
  return result.exitCode;
}

export function toServerExitCode(ok: boolean): number {
  return ok ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE;
}

export type { IDagCliRunOptions, IDagCliIo, TDagCliFetch };
export type TDagCliDefinition = IDagDefinition;
export type TDagCliInputPayload = TPortPayload;
