/**
 * Ink render entry point.
 */

import React from 'react';
import { render } from 'ink';
import App from './App.js';
import type { IAIProvider } from '@robota-sdk/agent-core';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskRunner,
  ICommandHostAdapters,
  ICommandModule,
  IInteractiveSessionStore,
  TSubagentRunnerFactory,
  CommandRegistry,
} from '@robota-sdk/agent-sdk';
import type { ITransportRegistryView } from '@robota-sdk/agent-interface-transport';
import type { ITuiCliAdapter } from './tui-cli-adapter.js';

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
  startupUpdateNotice?: Promise<string | undefined>;
  transportRegistry?: ITransportRegistryView;
  cliAdapter: ITuiCliAdapter;
  reloadPluginCommandSource?: (registry: CommandRegistry) => void;
}

export async function renderApp(options: IRenderOptions): Promise<void> {
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`\n[UNHANDLED REJECTION] ${reason}\n`);
    if (reason instanceof Error) {
      process.stderr.write(`${reason.stack}\n`);
    }
  });

  const instance = render(<App {...options} />, { exitOnCtrlC: false });
  await instance.waitUntilExit();
}
