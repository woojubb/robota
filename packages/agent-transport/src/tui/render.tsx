/**
 * Ink render entry point.
 */

import { render } from 'ink';
import React from 'react';

import App from './App.js';
import { TuiInteractionChannel } from './TuiInteractionChannel.js';

import type { ITuiCliAdapter } from './tui-cli-adapter.js';
import type { IAIProvider } from '@robota-sdk/agent-core';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskRunner,
  ICommandHostAdapters,
  ICommandModule,
  IInteractiveSession,
  IInteractiveSessionStore,
  TSubagentRunnerFactory,
  TShellExecFn,
  CommandRegistry,
} from '@robota-sdk/agent-framework';
import type { ITransportRegistryView } from '@robota-sdk/agent-interface-transport';

export interface IRenderOptions {
  cwd: string;
  provider: IAIProvider;
  providerOverride?: string | undefined;
  providerType?: string | undefined;
  modelId?: string;
  language?: string;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  version?: string;
  sessionStore?: IInteractiveSessionStore;
  resumeSessionId?: string;
  showSessionPickerOnStart?: boolean;
  forkSession?: boolean;
  sessionName?: string;
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  subagentRunnerFactory?: TSubagentRunnerFactory;
  commandModules?: readonly ICommandModule[];
  commandHostAdapters?: ICommandHostAdapters;
  shellExec?: TShellExecFn;
  startupUpdateNotice?: Promise<string | undefined>;
  transportRegistry?: ITransportRegistryView<IInteractiveSession>;
  cliAdapter: ITuiCliAdapter;
  reloadPluginCommandSource?: (registry: CommandRegistry) => void;
  agentName?: string;
}

export async function renderApp(options: IRenderOptions): Promise<void> {
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`\n[UNHANDLED REJECTION] ${reason}\n`);
    if (reason instanceof Error) {
      process.stderr.write(`${reason.stack}\n`);
    }
  });

  const createChannel = (resumeSessionId?: string): TuiInteractionChannel =>
    new TuiInteractionChannel({
      cwd: options.cwd,
      provider: options.provider,
      permissionMode: options.permissionMode,
      maxTurns: options.maxTurns,
      sessionStore: options.sessionStore,
      resumeSessionId,
      forkSession: options.forkSession,
      sessionName: options.sessionName,
      backgroundTaskRunners: options.backgroundTaskRunners,
      subagentRunnerFactory: options.subagentRunnerFactory,
      commandModules: options.commandModules,
      commandHostAdapters: options.commandHostAdapters,
      shellExec: options.shellExec,
      transportRegistry: options.transportRegistry,
      language: options.language,
      reloadPluginCommandSource: options.reloadPluginCommandSource,
      agentName: options.agentName,
    });

  const channel = createChannel(options.resumeSessionId);

  const instance = render(
    <App
      cwd={options.cwd}
      channel={channel}
      createChannel={createChannel}
      providerOverride={options.providerOverride}
      providerType={options.providerType}
      modelId={options.modelId}
      permissionMode={options.permissionMode}
      version={options.version}
      sessionStore={options.sessionStore}
      resumeSessionId={options.resumeSessionId}
      showSessionPickerOnStart={options.showSessionPickerOnStart}
      startupUpdateNotice={options.startupUpdateNotice}
      transportRegistry={options.transportRegistry}
      cliAdapter={options.cliAdapter}
    />,
    { exitOnCtrlC: false },
  );
  await instance.waitUntilExit();
}
