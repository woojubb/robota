import { TuiTransport, createDefaultTuiCliAdapter } from '@robota-sdk/agent-transport/tui';

import { buildAppendSystemPrompt } from '../startup/append-system-prompt.js';
import { AGENT_CLI_NAME } from '../constants.js';
import { createShellExec } from './shell-exec.js';

import type { ISessionRunOptions } from '../startup/args-to-options.js';
import type { ICommandSetup } from '../startup/command-setup.js';
import type { IProviderSetup } from '../startup/provider-setup.js';
import type { ISessionSetup } from '../startup/session-setup.js';
import type { IAgentRuntime } from '@robota-sdk/agent-framework';

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

  const appendSystemPromptParts: string[] = [];
  const baseAppend = buildAppendSystemPrompt(runtime.cwd, sessionOpts);
  if (baseAppend) appendSystemPromptParts.push(baseAppend);
  const appendSystemPrompt =
    appendSystemPromptParts.length > 0 ? appendSystemPromptParts.join('\n\n') : undefined;

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
    systemPrompt: sessionOpts.systemPrompt,
    appendSystemPrompt,
  });

  await tuiTransport.start();
}
