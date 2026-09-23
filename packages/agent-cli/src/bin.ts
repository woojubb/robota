#!/usr/bin/env node
/**
 * Robota CLI binary entry point.
 *
 * Boots the CLI and handles any uncaught top-level errors gracefully.
 *
 * A Node.js version check (>=22) is injected as a build-time banner in
 * tsdown.config.ts and runs before any module imports are loaded.
 */
import { installCliDiagnostics } from './bootstrap-diagnostics.js';
import { isSubagentWorkerModeArgv, runSubagentWorkerMain } from '@robota-sdk/agent-subagent-runner';

import { startCli } from './cli.js';
import { createRobotaSubagentComposition } from './product/robota-subagent-composition.js';
import { areTuiProcessGuardsActive, classifyUncaughtException } from './process-guards.js';

installCliDiagnostics();

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
