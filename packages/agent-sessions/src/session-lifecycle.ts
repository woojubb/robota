/**
 * Session lifecycle helpers — provider configuration and session start hooks.
 *
 * Extracted from Session to keep session.ts under the 300-line limit.
 * All functions receive their dependencies explicitly.
 */

import { runHooks } from '@robota-sdk/agent-core';
import type {
  IAIProvider,
  THooksConfig,
  IHookInput,
  IHookTypeExecutor,
} from '@robota-sdk/agent-core';
import type { ISessionOptions } from './session-types.js';
import type { TSessionLogData } from './session-logger.js';

/**
 * Configure provider-specific features: streaming, web tools, server tool logging.
 * Mutates the provider object in-place.
 */
export function configureProvider(
  provider: IAIProvider,
  options: ISessionOptions,
  log: (event: string, data: TSessionLogData) => void,
): void {
  // Enable Anthropic server web tools (web_search)
  if (provider.name === 'anthropic' && 'enableWebTools' in provider) {
    (provider as { enableWebTools: boolean }).enableWebTools = true;
  }

  if (options.onTextDelta && 'onTextDelta' in provider) {
    (provider as { onTextDelta?: (delta: string) => void }).onTextDelta = options.onTextDelta;
  }

  // Wire server tool logging
  if ('onServerToolUse' in provider) {
    (
      provider as { onServerToolUse?: (name: string, input: Record<string, string>) => void }
    ).onServerToolUse = (name: string, input: Record<string, string>) => {
      log('server_tool', { tool: name, ...input });
    };
  }
}

/**
 * Fire SessionStart hook asynchronously.
 * Calls onStdout when the hook produces stdout (used to seed the first run()).
 */
export function fireSessionStartHook(
  sessionId: string,
  cwd: string,
  hooks: Record<string, unknown> | undefined,
  hookTypeExecutors: IHookTypeExecutor[] | undefined,
  onStdout: (stdout: string) => void,
): void {
  const hookInput: IHookInput = {
    session_id: sessionId,
    cwd,
    hook_event_name: 'SessionStart',
    env: {
      CLAUDE_PROJECT_DIR: cwd,
      CLAUDE_SESSION_ID: sessionId,
    },
  };
  runHooks(hooks as THooksConfig | undefined, 'SessionStart', hookInput, hookTypeExecutors)
    .then((result) => {
      if (result.stdout) {
        onStdout(result.stdout);
      }
    })
    .catch(() => {});
}
