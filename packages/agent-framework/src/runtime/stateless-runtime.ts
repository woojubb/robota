/**
 * createStatelessRuntime — filesystem-free runtime for serverless and embedded contexts.
 *
 * Thin wrapper around createAgentRuntime that disables all filesystem side-effects —
 * - sessionStore: undefined  (no session persistence)
 * - commandHostAdapters with no-op settings (no ~/.agent/settings.json writes)
 *
 * Sessions created from this runtime default to bare: true (skip AGENTS.md/CLAUDE.md
 * loading and plugin discovery). Override per-session if needed.
 */

import { requireFrameworkHost } from '../host/require-framework-host.js';
import { createAgentRuntime } from './session-runtime.js';

import type { IFrameworkHost } from '../host/framework-host.js';
import type { IAgentRuntime } from './session-runtime.js';
import type { IAIProvider } from '@robota-sdk/agent-core';

export interface IStatelessRuntimeConfig {
  /** The platform the runtime's sessions run on; `{}` is a host with nothing to lend. See `IFrameworkHost`. */
  host: IFrameworkHost;
  provider: IAIProvider;
  /** The absolute working directory. Not used for file I/O in stateless mode. */
  cwd: string;
}

export function createStatelessRuntime(config: IStatelessRuntimeConfig): IAgentRuntime {
  requireFrameworkHost(config.host, 'createStatelessRuntime');
  const runtime = createAgentRuntime({
    host: config.host,
    cwd: config.cwd,
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
