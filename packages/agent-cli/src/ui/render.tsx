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
} from '@robota-sdk/agent-sdk';
import type { ICliUpdateNotice } from '../utils/update-check.js';

export interface IRenderOptions {
  cwd: string;
  provider: IAIProvider;
  providerOverride?: string | undefined;
  providerProfileName?: string | undefined;
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
  startupUpdateNoticePromise?: Promise<ICliUpdateNotice | undefined>;
  webPort?: number;
  noOpen?: boolean;
}

export function renderApp(options: IRenderOptions): void {
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`\n[UNHANDLED REJECTION] ${reason}\n`);
    if (reason instanceof Error) {
      process.stderr.write(`${reason.stack}\n`);
    }
  });

  const instance = render(<App {...options} />, {
    exitOnCtrlC: false,
  });

  instance
    .waitUntilExit()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      if (err) {
        process.stderr.write(`\n[EXIT ERROR] ${err}\n`);
      }
      process.exit(1);
    });
}
