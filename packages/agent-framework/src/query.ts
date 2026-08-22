/**
 * createQuery() — factory that returns a prompt-only convenience function.
 *
 * Usage:
 *   const query = createQuery({ provider });
 *   const answer = await query('What files are here?');
 */

import { InteractiveSession } from './interactive/interactive-session.js';
import { createRestrictedWorkspaceProjectAccess } from './workspace-trust/index.js';

import type { IExecutionResult, TInteractivePermissionHandler } from './interactive/types.js';
import type { TWorkspaceProjectAccess } from './workspace-trust/index.js';
import type { IAIProvider, IToolWithEventService, TPermissionMode } from '@robota-sdk/agent-core';

export interface ICreateQueryOptions {
  /** AI provider instance (required). */
  provider: IAIProvider;
  /** Working directory. Defaults to process.cwd(). */
  cwd?: string;
  /** Host-owned initial project decision. Absence produces an observable Restricted query. */
  projectAccess?: TWorkspaceProjectAccess;
  /** Permission mode. Defaults to 'bypassPermissions' for programmatic use. */
  permissionMode?: TPermissionMode;
  /** Maximum agentic turns per query. */
  maxTurns?: number;
  /** Permission handler callback. */
  permissionHandler?: TInteractivePermissionHandler;
  /** Streaming text callback. */
  onTextDelta?: (delta: string) => void;
  /** Additional tools registered alongside the default CLI tools. */
  additionalTools?: IToolWithEventService[];
  /** Request structured output from the provider. */
  responseFormat?: { type: 'text' | 'json_object' };
}

/** Callable query surface plus its immutable initial project-access decision. */
export interface TQueryFunction {
  (prompt: string): Promise<string>;
  readonly projectAccess: TWorkspaceProjectAccess;
}

/**
 * Create a prompt-only query function bound to a provider.
 *
 * ```typescript
 * import { createQuery } from '@robota-sdk/agent-framework';
 * import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';
 *
 * const query = createQuery({ provider: new AnthropicProvider({ apiKey: '...' }) });
 * const answer = await query('List all TypeScript files');
 * ```
 */
export function createQuery(options: ICreateQueryOptions): TQueryFunction {
  const cwd = options.cwd ?? process.cwd();
  const projectAccess =
    options.projectAccess ?? createRestrictedWorkspaceProjectAccess('identity-unavailable', cwd);
  const session = new InteractiveSession({
    cwd,
    provider: options.provider,
    projectAccess,
    permissionMode: options.permissionMode ?? 'bypassPermissions',
    maxTurns: options.maxTurns,
    additionalTools: options.additionalTools,
    ...(options.responseFormat ? { responseFormat: options.responseFormat } : {}),
  });

  if (options.permissionHandler) {
    const permissionHandler = options.permissionHandler;
    session.on('permission_request', ({ id, toolName, toolArgs }) => {
      void Promise.resolve(permissionHandler(toolName, toolArgs))
        .then((result) => session.resolvePermission(id, result))
        .catch(() => session.resolvePermission(id, false));
    });
  }

  if (options.onTextDelta) {
    session.on('text_delta', options.onTextDelta);
  }

  const query = async (prompt: string): Promise<string> => {
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
  return Object.freeze(Object.assign(query, { projectAccess }));
}
