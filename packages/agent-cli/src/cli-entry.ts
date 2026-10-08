import { isSubagentWorkerModeArgv } from '@robota-sdk/agent-subagent-runner';
import { installCliDiagnostics } from './bootstrap-diagnostics.js';
import { installCliCrashPolicy } from './cli-crash-policy.js';
import { startCli } from './cli.js';
import { resolveCliRuntimeContext } from './startup/product-bootstrap.js';
import { optionArgv } from './utils/option-argv.js';
import type { IStartCliOptions } from './startup/cli-options-types.js';

/** Launch a host entry with binary diagnostics, crash policy, startup errors and worker dispatch. */
export async function startCliEntry(options: IStartCliOptions = {}): Promise<void> {
  try {
    const productRuntime = resolveCliRuntimeContext(options);
    installCliDiagnostics(productRuntime.config.identity.cliName);
    installCliCrashPolicy(productRuntime.config.identity.cliName);
    await startCli({ ...options, productRuntime });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    if (isSubagentWorkerModeArgv(optionArgv(process.argv))) process.exitCode = 1;
    else process.exit(1);
  }
}
