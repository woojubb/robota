/**
 * Ink render entry point.
 */

import { render } from 'ink';
import App from './App.js';
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
import type { ITuiCliAdapter } from './tui-cli-adapter.js';

  providerOverride?: string | undefined;
  providerType?: string | undefined;
  modelId?: string;
  language?: string;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  version?: string;
  resumeSessionId?: string;
  showSessionPickerOnStart?: boolean;
  forkSession?: boolean;
  sessionName?: string;
  shellExec?: TShellExecFn;
  startupUpdateNotice?: Promise<string | undefined>;
  cliAdapter: ITuiCliAdapter;
  agentName?: string;
}

export async function renderApp(options: ITuiRenderOptions): Promise<void> {
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`\n[UNHANDLED REJECTION] ${reason}\n`);
    if (reason instanceof Error) {
      process.stderr.write(`${reason.stack}\n`);
    }
  });

  const { runtime, ...tuiOptions } = options;
  const instance = render(<App {...runtime} {...tuiOptions} />, { exitOnCtrlC: false });
  await instance.waitUntilExit();
}
