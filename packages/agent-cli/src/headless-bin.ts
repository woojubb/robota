#!/usr/bin/env node
/** RUNTIME-002: the desktop's presentation-free executable. */
import { isSubagentWorkerModeArgv, runSubagentWorkerMain } from '@robota-sdk/agent-subagent-runner';
import { createDefaultBackgroundTaskRunners } from '@robota-sdk/agent-executor';

import { installCliDiagnostics } from './bootstrap-diagnostics.js';
import { startCliCore } from './cli-core.js';
import { createRobotaSubagentComposition } from './product/robota-subagent-composition.js';
import { parseCliArgs } from './utils/cli-args.js';

installCliDiagnostics();

if (isSubagentWorkerModeArgv(process.argv)) {
  // The served parent's child re-executes process.execPath; this private route must survive bundling.
  runSubagentWorkerMain(createRobotaSubagentComposition());
} else {
  try {
    const args = parseCliArgs();
    if (
      !args.serve ||
      args.printMode ||
      args.goal !== undefined ||
      args.positional.length > 0 ||
      args.reset ||
      args.configure ||
      args.configureProvider !== undefined ||
      args.checkUpdate ||
      args.help ||
      args.version
    ) {
      process.stderr.write('This headless runtime accepts only --serve.\n');
      process.exitCode = 2;
    } else {
      startCliCore({}, createDefaultBackgroundTaskRunners).catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      });
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
