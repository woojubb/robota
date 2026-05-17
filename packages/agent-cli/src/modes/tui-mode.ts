import { execSync } from 'node:child_process';
import type { IAgentRuntime } from '@robota-sdk/agent-framework';
import { TuiTransport, createDefaultTuiCliAdapter } from '@robota-sdk/agent-transport/tui';
import type { ICommandSetup } from '../startup/command-setup.js';
import type { IProviderSetup } from '../startup/provider-setup.js';
import type { ISessionSetup } from '../startup/session-setup.js';
import type { ISessionRunOptions } from '../startup/args-to-options.js';

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
    providerOverride: providerSetup.providerSettings.name,
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
    shellExec: (command: string) =>
      execSync(command, { timeout: 5000, encoding: 'utf-8', stdio: 'pipe' }).trimEnd(),
    startupUpdateNotice,
    cliAdapter: createDefaultTuiCliAdapter({
      providerDefinitions: commandSetup.providerDefinitions,
      reloadPluginCommandSource: commandSetup.reloadPluginCommandSource,
    }),
    agentName: 'robota-cli',
  });

  await tuiTransport.start();
}
