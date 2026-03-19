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
  TPermissionMode,
  SessionStore,
} from '@robota-sdk/agent-sdk';

export interface IRenderOptions {
  config: IResolvedConfig;
  context: ILoadedContext;
  projectInfo?: IProjectInfo;
  sessionStore?: SessionStore;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
}

export function renderApp(options: IRenderOptions): void {
  const instance = render(<App {...options} />, {
    // Exit on Ctrl+C
    exitOnCtrlC: true,
  });

  instance.waitUntilExit().catch(() => {
    // Silently handle exit
  });
}
