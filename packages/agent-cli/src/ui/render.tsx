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
  IAIProvider,
} from '@robota-sdk/agent-core';
import type { SessionStore } from '../session-store.js';

export interface IRenderOptions {
  config: IResolvedConfig;
  context: ILoadedContext;
  projectInfo?: IProjectInfo;
  sessionStore?: SessionStore;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  providerFactory?: (apiKey: string) => IAIProvider;
  /** Factory that creates CLI tools — injected to avoid circular dependency */
  toolsFactory?: (
    config: IResolvedConfig,
    context: ILoadedContext,
    projectInfo?: IProjectInfo,
  ) => { getName(): string }[];
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
