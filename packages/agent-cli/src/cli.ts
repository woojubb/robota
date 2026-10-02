import {
  renderApp,
  renderSupervisedSessionView,
  renderAttachedApp,
  createDefaultTuiCliAdapter,
  createNodeKeybindingsSource,
} from '@robota-sdk/agent-ui-terminal';
import { createThemeSurface } from './startup/theme-surface.js';
import { installTuiProcessGuards, setLiveChannel } from './process-guards.js';
import { startCliCore } from './cli-core.js';
import { createDefaultBackgroundTaskRunners } from '@robota-sdk/agent-executor';
import { isSubagentWorkerModeArgv, runSubagentWorkerMain } from '@robota-sdk/agent-subagent-runner';
import { createProductSubagentComposition } from './product/subagent-composition.js';
import { optionArgv } from './utils/option-argv.js';
import type { IStartCliOptions } from './startup/command-setup.js';
import { resolveCliRuntimeContext } from './startup/product-bootstrap.js';
import { assertLocalWorkerPosture } from './hosted/hosted-runtime-config.js';

export type { IStartCliOptions };

/** Full CLI entry: supplies its terminal presentation to the shared serve/bootstrap path. */
export async function startCli(initialOptions: IStartCliOptions = {}): Promise<void> {
  const productRuntime = resolveCliRuntimeContext(initialOptions);
  const options = { ...initialOptions, productRuntime };
  // A subagent runs as this process's own entry script started again with the worker flag. An
  // embedder's entry calls this function rather than going through `bin.ts`, so the worker
  // dispatch is here too: without it the child would start a second CLI instead of the subagent.
  if (isSubagentWorkerModeArgv(optionArgv(process.argv))) {
    assertLocalWorkerPosture(productRuntime.environment);
    runSubagentWorkerMain(createProductSubagentComposition(productRuntime));
    // The worker ends the process itself when its task is done. Never settling keeps an embedder's
    // code after `await startCli()` (a `process.exit()`, say) from running in the worker child.
    return new Promise<never>(() => undefined);
  }
  return startCliCore(options, createDefaultBackgroundTaskRunners, {
    renderApp,
    renderSupervisedSessionView,
    renderAttachedApp,
    createDefaultTuiCliAdapter,
    createNodeKeybindingsSource,
    createThemeSurface,
    installTuiProcessGuards,
    setLiveChannel,
  });
}
