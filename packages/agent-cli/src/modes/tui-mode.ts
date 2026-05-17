import { TuiTransport, createDefaultTuiCliAdapter } from '@robota-sdk/agent-transport/tui';

import type { ISessionRunOptions } from '../startup/args-to-options.js';
import type { ICommandSetup } from '../startup/command-setup.js';
import type { IProviderSetup } from '../startup/provider-setup.js';
import type { ISessionSetup } from '../startup/session-setup.js';
import type { IAgentRuntime } from '@robota-sdk/agent-framework';
import { AGENT_CLI_NAME } from '../constants.js';
import { createShellExec } from './shell-exec.js';

export interface ITuiModeOptions {
  runtime: IAgentRuntime;
  version: string;
  commandSetup: ICommandSetup;
  providerSetup: IProviderSetup;
  sessionSetup: ISessionSetup;
  sessionOpts: ISessionRunOptions;
  startupUpdateNotice: Promise<string | undefined> | undefined;
}

export async function runTuiMode(opts: ITuiModeOptions): Promise<void> {
  const {
    runtime,
    version,
    commandSetup,
    providerSetup,
    sessionSetup,
    sessionOpts,
    startupUpdateNotice,
  } = opts;

  const tuiTransport = new TuiTransport({
    runtime,
    providerOverride: providerSetup.activeProfileName,
    providerType: providerSetup.providerSettings.name,
    modelId: providerSetup.modelId,
    language: sessionOpts.language,
    permissionMode: sessionOpts.permissionMode,
    maxTurns: sessionOpts.maxTurns,
    version,
    resumeSessionId: sessionSetup.resumeSessionId,
    showSessionPickerOnStart: sessionSetup.showSessionPickerOnStart,
    forkSession: sessionOpts.forkSession,
    sessionName: sessionOpts.sessionName,
    shellExec: createShellExec(),
    startupUpdateNotice,
    cliAdapter: createDefaultTuiCliAdapter({
      providerDefinitions: commandSetup.providerDefinitions,
      reloadPluginCommandSource: commandSetup.reloadPluginCommandSource,
    }),
    agentName: AGENT_CLI_NAME,
  });

  await tuiTransport.start();
}
