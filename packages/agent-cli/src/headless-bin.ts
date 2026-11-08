#!/usr/bin/env node
import {
  installProductChildSessions,
  installProductProcessEnvironment,
} from './product/process-environment.js';
/** The desktop's presentation-free executable. */
import { isSubagentWorkerModeArgv, runSubagentWorkerMain } from '@robota-sdk/agent-subagent-runner';
import { createDefaultBackgroundTaskRunners } from '@robota-sdk/agent-executor/node';
import { createNodeFrameworkHost } from '@robota-sdk/agent-framework/node';
import { createDefaultTools } from '@robota-sdk/agent-tool-defaults';

import { installCliDiagnostics } from './bootstrap-diagnostics.js';
import { hardenProductProcess } from './process-hardening.js';
import { resolveCliRuntimeContext } from './startup/product-bootstrap.js';
import { startCliCore } from './cli-core.js';
import { createProductSubagentComposition } from './product/subagent-composition.js';
import { parseCliArgs } from './utils/cli-args.js';
import { optionArgv } from './utils/option-argv.js';
import { assertLocalWorkerPosture } from './hosted/hosted-runtime-config.js';
import { assertProductConversationLaunch } from './product/session-sealing.js';

// Same first step as the CLI executable: this executable is its own entry, and so is its worker child.
hardenProductProcess();

if (isSubagentWorkerModeArgv(optionArgv(process.argv))) {
  // The served parent's child re-executes process.execPath; this private route must survive bundling.
  try {
    const runtime = resolveCliRuntimeContext({});
    assertProductConversationLaunch(runtime, process.argv);
    installProductProcessEnvironment(runtime);
    installProductChildSessions(runtime);
    installCliDiagnostics(runtime.config.identity.cliName);
    assertLocalWorkerPosture(runtime.environment);
    runSubagentWorkerMain(createProductSubagentComposition(runtime));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
} else {
  try {
    const productRuntime = resolveCliRuntimeContext({});
    assertProductConversationLaunch(productRuntime, process.argv);
    installProductProcessEnvironment(productRuntime);
    installProductChildSessions(productRuntime);
    installCliDiagnostics(productRuntime.config.identity.cliName);
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
      startCliCore(
        { productRuntime },
        createNodeFrameworkHost({ createDefaultTools }),
        createDefaultBackgroundTaskRunners,
      ).catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      });
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
