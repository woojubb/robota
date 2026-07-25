/**
 * createStatelessRuntime — filesystem-free runtime for serverless and embedded contexts.
 *
 * Thin wrapper around createAgentRuntime that disables all filesystem side-effects —
 * - sessionStore: undefined  (no session persistence)
 * - commandHostAdapters with no-op settings (no ~/.robota/settings.json writes)
 *
 * Sessions created from this runtime default to bare: true (skip AGENTS.md/CLAUDE.md
 * loading and plugin discovery). Override per-session if needed.
 */

import { createAgentRuntime } from './agent-runtime.js';

import type { IAgentRuntime } from './agent-runtime.js';
import type { IAIProvider } from '@robota-sdk/agent-core';

export interface IStatelessRuntimeConfig {
  provider: IAIProvider;
  /** Working directory. Defaults to process.cwd(). Not used for file I/O in stateless mode. */
  cwd?: string;
}

export function createStatelessRuntime(config: IStatelessRuntimeConfig): IAgentRuntime {
  const runtime = createAgentRuntime({
    cwd: config.cwd ?? process.cwd(),
    provider: config.provider,
    sessionStore: undefined,
    commandHostAdapters: {
      settings: {
        read: () => ({}),
        write: () => {},
      },
    },
  });

  const baseCreateSession = runtime.createSession.bind(runtime);

  return {
    ...runtime,
    createSession(opts) {
      return baseCreateSession({ bare: true, ...opts });
    },
  };
}
