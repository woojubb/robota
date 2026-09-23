import {
  renderApp,
  createDefaultTuiCliAdapter,
  createNodeKeybindingsSource,
} from '@robota-sdk/agent-ui-terminal';
import { createThemeSurface } from './startup/theme-surface.js';
import { installTuiProcessGuards, setLiveChannel } from './process-guards.js';
import { startCliCore } from './cli-core.js';
import { createDefaultBackgroundTaskRunners } from '@robota-sdk/agent-executor';
import type { IStartCliOptions } from './startup/command-setup.js';

export type { IStartCliOptions };

/** Full CLI entry: supplies its terminal presentation to the shared serve/bootstrap path. */
export async function startCli(options: IStartCliOptions = {}): Promise<void> {
  return startCliCore(options, createDefaultBackgroundTaskRunners, {
    renderApp,
    createDefaultTuiCliAdapter,
    createNodeKeybindingsSource,
    createThemeSurface,
    installTuiProcessGuards,
    setLiveChannel,
  });
}
