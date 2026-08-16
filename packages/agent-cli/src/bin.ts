#!/usr/bin/env node
/**
 * Robota CLI binary entry point.
 *
 * Boots the CLI and handles any uncaught top-level errors gracefully.
 *
 * A Node.js version check (>=22) is injected as a build-time banner in
 * tsdown.config.ts and runs before any module imports are loaded.
 */
import { setGlobalLoggerSink } from '@robota-sdk/agent-core';
import { isSubagentWorkerModeArgv, runSubagentWorkerMain } from '@robota-sdk/agent-subagent-runner';

import { startCli } from './cli.js';
import { createRobotaSubagentComposition } from './product/robota-subagent-composition.js';
import { areTuiProcessGuardsActive, classifyUncaughtException } from './process-guards.js';

/**
 * CORE-029 / NEUT-010: the runtime's diagnostics have a destination in this product.
 *
 * `agent-core` defaults to a silent sink and nothing in the repository installed one, so every
 * diagnostic it emits went nowhere — including "no metadata registered for model X, using another
 * vendor's default". Adding the WARNING without connecting a sink would have left the defect exactly
 * where it was while claiming it was fixed; review of #1595 said so, correctly.
 *
 * STDERR, not stdout: the TUI owns stdout, and this process already writes its own errors to stderr.
 * The global level defaults to `warn`, so this carries warnings and errors and stays out of the way
 * of normal output — the same 30 warn and 23 error sites that were unreachable a moment ago.
 */
setGlobalLoggerSink({
  debug: () => {},
  info: () => {},
  log: () => {},
  group: () => {},
  groupEnd: () => {},
  warn: (...args) => process.stderr.write(`[robota] ${formatDiagnostic(args)}\n`),
  error: (...args) => process.stderr.write(`[robota] ${formatDiagnostic(args)}\n`),
});

function formatDiagnostic(args: unknown[]): string {
  return args
    .map((arg) => (arg instanceof Error ? (arg.stack ?? arg.message) : String(arg)))
    .join(' ');
}

// Last-resort crash policy (CORE-020, RUNTIME-34): the IME allowlist is scoped to
// interactive TUI mode only — headless/print mode always rethrows (fail-fast exit-code
// contract), so generic signatures like 'slice' can never mask a real headless crash.
// ERR-001 G1: with the TUI guards active, non-IME errors are guard-owned — the guards
// render them into the live session; re-throwing here would kill the TUI.
process.on('uncaughtException', (err) => {
  const decision = classifyUncaughtException(err, areTuiProcessGuardsActive());
  if (decision === 'ime-hint') {
    process.stderr.write(
      '\n[robota] CJK/IME input error — this is a known issue with macOS Terminal.app.\n' +
        '  Workaround: use iTerm2 (https://iterm2.com) or input your prompt in English.\n' +
        '  Alternatively, use headless mode: robota -p "your prompt here"\n\n',
    );
    return;
  }
  if (decision === 'guard-owned') return;
  throw err;
});

// DIST-006: this entry IS the subagent worker. Nothing has to find a worker file on disk, because
// the artifact re-executes itself — which is the only formulation that holds for the npm bundle,
// a source run, AND the compiled single-file binaries, where there is no sibling file to find.
// `runSubagentWorkerMain` refuses loudly when there is no IPC channel, so a hand-typed flag fails
// where someone can see it instead of looking started.
if (isSubagentWorkerModeArgv(process.argv)) {
  // ARCH-021: the child composes robota's OWN surface, from the same packs the parent uses. The
  // neutral runner no longer imports product defaults — it is handed the recipe.
  runSubagentWorkerMain(createRobotaSubagentComposition());
} else {
  startCli().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(message + '\n');
    process.exit(1);
  });
}
