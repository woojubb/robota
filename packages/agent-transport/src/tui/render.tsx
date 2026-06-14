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
  TSubagentRunnerFactory,
  TShellExecFn,
  CommandRegistry,
} from '@robota-sdk/agent-framework';
import type {
  IInteractiveSession,
  IInteractiveSessionStore,
  ITransportRegistryView,
} from '@robota-sdk/agent-interface-transport';

export interface IRenderOptions {
  cwd: string;
  provider: IAIProvider;
  providerOverride?: string | undefined;
  providerType?: string | undefined;
  modelId?: string;
  language?: string;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  allowedTools?: string[];
  deniedTools?: string[];
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
  /** Preset persona block composed as a `source: 'persona'` system-prompt section (priority 5). */
  persona?: string;
}

/** Map render options to TuiInteractionChannel constructor options. */
export function toChannelOptions(
  options: IRenderOptions,
  resumeSessionId?: string,
): ConstructorParameters<typeof TuiInteractionChannel>[0] {
  return {
    cwd: options.cwd,
    provider: options.provider,
    permissionMode: options.permissionMode,
    maxTurns: options.maxTurns,
    allowedTools: options.allowedTools,
    deniedTools: options.deniedTools,
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
    persona: options.persona,
  };
}

export async function renderApp(options: IRenderOptions): Promise<void> {
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`\n[UNHANDLED REJECTION] ${reason}\n`);
    if (reason instanceof Error) {
      process.stderr.write(`${reason.stack}\n`);
    }
  });

  // Single-owner lifecycle (CLI-B12): render.tsx supplies only the factory;
  // App creates, replaces, and stops channels exclusively through React state.
  const createChannel = (resumeSessionId?: string): TuiInteractionChannel =>
    new TuiInteractionChannel(toChannelOptions(options, resumeSessionId));

  const instance = render(
    <App
      cwd={options.cwd}
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
