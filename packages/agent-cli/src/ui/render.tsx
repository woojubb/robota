/**
 * Ink render entry point.
 */

import React from 'react';
import { render } from 'ink';
import App from './App.js';
import type {
  IResolvedConfig,
  ILoadedContext,
  IProjectInfo,
  SessionStore,
} from '@robota-sdk/agent-sdk';
import type { TPermissionMode } from '@robota-sdk/agent-core';

export interface IRenderOptions {
  config: IResolvedConfig;
  context: ILoadedContext;
  projectInfo?: IProjectInfo;
  sessionStore?: SessionStore;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  cwd?: string;
  version?: string;
}

export function renderApp(options: IRenderOptions): void {
  // Catch unhandled rejections to prevent silent Ink crashes
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`\n[UNHANDLED REJECTION] ${reason}\n`);
    if (reason instanceof Error) {
      process.stderr.write(`${reason.stack}\n`);
    }
  });

  const instance = render(<App {...options} />, {
    exitOnCtrlC: true,
  });

  instance
    .waitUntilExit()
    .then(() => {
      // Ink exited (Ctrl+C or explicit exit()) — force process termination.
      // Without this, pending async operations (session.run, streaming) keep
      // the event loop alive, requiring a second Ctrl+C.
      process.exit(0);
    })
    .catch((err) => {
      if (err) {
        process.stderr.write(`\n[EXIT ERROR] ${err}\n`);
      }
      process.exit(1);
    });
}
