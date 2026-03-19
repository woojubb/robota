/**
 * Ink render entry point.
 */

import React from 'react';
import { render } from 'ink';
import App from './App.js';
import type { IResolvedConfig } from '../config/config-types.js';
import type { ILoadedContext } from '../context/context-loader.js';
import type { IProjectInfo } from '../context/project-detector.js';
import type { TPermissionMode } from '../types.js';
import type { SessionStore } from '../session-store.js';

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
