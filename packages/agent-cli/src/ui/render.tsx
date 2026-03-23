/**
 * Ink render entry point.
 * Uses alternate screen buffer to prevent Terminal.app scrollback corruption.
 * On exit, reprints the last rendered frame to normal stdout so content is preserved.
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

  // Capture last meaningful rendered frame by intercepting stdout.write
  // Ink writes clear sequences (short strings with only ANSI escapes) between real frames.
  // We keep the last "substantial" write as the frame to restore on exit.
  let lastFrame = '';
  const originalWrite = process.stdout.write.bind(process.stdout);
  const MIN_FRAME_LENGTH = 50; // Real Ink frames are much longer than clear sequences
  process.stdout.write = (chunk: string | Uint8Array, ...args: unknown[]): boolean => {
    if (typeof chunk === 'string' && chunk.length > MIN_FRAME_LENGTH) {
      lastFrame = chunk;
    }
    return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...args);
  };

  // Enter alternate screen buffer to prevent Terminal.app scrollback corruption
  originalWrite('\x1b[?1049h');

  let altScreenExited = false;
  const leaveAltScreen = (): void => {
    if (altScreenExited) return;
    altScreenExited = true;
    // Restore original write before leaving
    process.stdout.write = originalWrite;
    originalWrite('\x1b[?1049l');
    // Reprint last frame to normal screen buffer
    if (lastFrame) {
      originalWrite(lastFrame);
    }
  };

  // Ensure alternate screen is exited on any termination
  process.on('exit', leaveAltScreen);
  process.on('SIGINT', () => {
    leaveAltScreen();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    leaveAltScreen();
    process.exit(0);
  });

  const instance = render(<App {...options} />, {
    exitOnCtrlC: false,
  });

  instance
    .waitUntilExit()
    .then(() => {
      leaveAltScreen();
    })
    .catch((err) => {
      leaveAltScreen();
      if (err) {
        process.stderr.write(`\n[EXIT ERROR] ${err}\n`);
      }
    });
}
