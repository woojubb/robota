/**
 * Ink render entry point.
 */

import { render } from 'ink';
import React from 'react';

import App from './App.js';

import type { ITuiCliAdapter } from './tui-cli-adapter.js';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import type { IAgentRuntime } from '@robota-sdk/agent-framework';
import type { TShellExecFn } from '@robota-sdk/agent-framework';

export interface ITuiRenderOptions {
  runtime: IAgentRuntime;

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
  systemPrompt?: string;
  appendSystemPrompt?: string;
  allowedTools?: string[];
  deniedTools?: string[];
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
