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
import { createRobotaSubagentComposition } from './product/robota-subagent-composition.js';
import { optionArgv } from './utils/option-argv.js';
import type { IStartCliOptions } from './startup/command-setup.js';

export type { IStartCliOptions };

/** Full CLI entry: supplies its terminal presentation to the shared serve/bootstrap path. */
export async function startCli(options: IStartCliOptions = {}): Promise<void> {
  // A subagent runs as this process's own entry script started again with the worker flag. An
  // embedder's entry calls this function rather than going through `bin.ts`, so the worker
  // dispatch is here too: without it the child would start a second CLI instead of the subagent.
  if (isSubagentWorkerModeArgv(optionArgv(process.argv))) {
    runSubagentWorkerMain(createRobotaSubagentComposition());
    return;
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
