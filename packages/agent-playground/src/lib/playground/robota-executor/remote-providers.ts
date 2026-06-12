import type { IAIProvider, IExecutor } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';
import { OpenAIProvider } from '@robota-sdk/agent-provider/openai';
import { RemoteExecutor } from '@robota-sdk/agent-remote-client';

import { REMOTE_EXECUTOR_TIMEOUT_MS } from './constants';

function buildRemoteExecutorUrl(serverUrl: string): string {
  return `${serverUrl.replace(/\/ws$/, '').replace(/^ws/, 'http')}/api/v1/remote`;
}

function createRemoteExecutor(serverUrl: string, authToken: string): IExecutor {
  if (!serverUrl || !authToken) {
    throw new Error('Server URL and auth token required for remote executor');
  }

  return new RemoteExecutor({
    serverUrl: buildRemoteExecutorUrl(serverUrl),
    userApiKey: authToken,
    timeout: REMOTE_EXECUTOR_TIMEOUT_MS,
    enableWebSocket: false,
  });
}
