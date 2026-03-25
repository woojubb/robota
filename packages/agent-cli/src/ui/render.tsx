/**
 * Ink render entry point.
 */

import React from 'react';
import { render } from 'ink';
import App from './App.js';
import type { IAIProvider } from '@robota-sdk/agent-core';
import type { TPermissionMode } from '@robota-sdk/agent-core';

export interface IRenderOptions {
  cwd: string;
  provider: IAIProvider;
  modelId?: string;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  version?: string;
}

export function renderApp(options: IRenderOptions): void {
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`\n[UNHANDLED REJECTION] ${reason}\n`);
    if (reason instanceof Error) {
      process.stderr.write(`${reason.stack}\n`);
    }
  });

  if (process.stdin.isTTY && process.stdout.isTTY) {
    process.stdout.write('\x1b[?2004h');
  }

  const instance = render(<App {...options} />, {
    exitOnCtrlC: true,
  });

  instance
    .waitUntilExit()
    .then(() => {
      if (process.stdout.isTTY) {
        process.stdout.write('\x1b[?2004l');
      }
      process.exit(0);
    })
    .catch((err) => {
      if (err) {
        process.stderr.write(`\n[EXIT ERROR] ${err}\n`);
      }
      process.exit(1);
    });
}
