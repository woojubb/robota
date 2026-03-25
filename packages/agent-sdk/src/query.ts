/**
 * createQuery() — factory that returns a prompt-only convenience function.
 *
 * Usage:
 *   const query = createQuery({ provider });
 *   const answer = await query('What files are here?');
 */

import type { IAIProvider } from '@robota-sdk/agent-core';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import { InteractiveSession } from './interactive/interactive-session.js';
import type { IExecutionResult, TInteractivePermissionHandler } from './interactive/types.js';

export interface ICreateQueryOptions {
  /** AI provider instance (required). */
  provider: IAIProvider;
  /** Working directory. Defaults to process.cwd(). */
  cwd?: string;
  /** Permission mode. Defaults to 'bypassPermissions' for programmatic use. */
  permissionMode?: TPermissionMode;
  /** Maximum agentic turns per query. */
  maxTurns?: number;
  /** Permission handler callback. */
  permissionHandler?: TInteractivePermissionHandler;
  /** Streaming text callback. */
  onTextDelta?: (delta: string) => void;
}

/**
 * Create a prompt-only query function bound to a provider.
 *
 * ```typescript
 * import { createQuery } from '@robota-sdk/agent-sdk';
 * import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
 *
 * const query = createQuery({ provider: new AnthropicProvider({ apiKey: '...' }) });
 * const answer = await query('List all TypeScript files');
 * ```
 */
export function createQuery(options: ICreateQueryOptions): (prompt: string) => Promise<string> {
  const session = new InteractiveSession({
    cwd: options.cwd ?? process.cwd(),
    provider: options.provider,
    permissionMode: options.permissionMode ?? 'bypassPermissions',
    maxTurns: options.maxTurns,
    permissionHandler: options.permissionHandler,
  });

  if (options.onTextDelta) {
    session.on('text_delta', options.onTextDelta);
  }

  return async (prompt: string): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      const onComplete = (result: IExecutionResult): void => {
        cleanup();
        resolve(result.response);
      };
      const onInterrupted = (result: IExecutionResult): void => {
        cleanup();
        resolve(result.response);
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const cleanup = (): void => {
        session.off('complete', onComplete);
        session.off('interrupted', onInterrupted);
        session.off('error', onError);
      };

      session.on('complete', onComplete);
      session.on('interrupted', onInterrupted);
      session.on('error', onError);

      session.submit(prompt).catch((err) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  };
}
