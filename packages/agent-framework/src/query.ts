/**
 * createQuery() — factory that returns a prompt-only convenience function.
 *
 * Usage:
 *   const query = createQuery({ provider });
 *   const answer = await query('What files are here?');
 */

import { realpathSync } from 'node:fs';

import { buildRuntimeSession } from './runtime/runtime-host.js';
import {
  WorkspaceAuthorityRequiredError,
  createRestrictedWorkspaceProjectAccess,
  getWorkspaceProjectIdentity,
} from './workspace-trust/index.js';
import { isWorkspacePathContained } from './workspace-trust/project-reader-path.js';

import type { TInteractivePermissionHandler } from './interactive/types.js';
import type { InteractiveSession } from './interactive/interactive-session.js';
import type { INodeHostSettingsSource } from './config/node-host-settings-source.js';
import type { TWorkspaceProjectAccess } from './workspace-trust/index.js';
import type { IAIProvider, IToolWithEventService, TPermissionMode } from '@robota-sdk/agent-core';

export interface ICreateQueryOptions {
  /** AI provider instance (required). */
  provider: IAIProvider;
  /** Working directory. Defaults to process.cwd(). */
  cwd?: string;
  /** Host-owned initial project decision. Absence produces an observable Restricted query. */
  projectAccess?: TWorkspaceProjectAccess;
  /** Explicit user settings layers for this query's session. */
  userSettingsSources?: readonly INodeHostSettingsSource[];
  /**
   * Permission mode. Defaults to `'default'`: with no `permissionHandler`, anything that would ask is
   * denied (issue #3081). Pass `'bypassPermissions'` explicitly for unattended driving.
   */
  permissionMode?: TPermissionMode;
  /**
   * Model to request. Without it the query uses the model from `userSettingsSources`, or Anthropic's
   * default when none is set — so pass it with any other provider.
   */
  model?: string;
  /** Maximum agentic turns per query. */
  maxTurns?: number;
  /** Tools that run without asking, in any permission mode (e.g. your own `additionalTools`). */
  allowedTools?: readonly string[];
  /** Tools the model is never offered. Denied wins over allowed. */
  deniedTools?: readonly string[];
  /** Permission handler callback. */
  permissionHandler?: TInteractivePermissionHandler;
  /** Streaming text callback. */
  onTextDelta?: (delta: string) => void;
  /** Additional tools registered alongside the default CLI tools. */
  additionalTools?: IToolWithEventService[];
  /** Request structured output from the provider. */
  responseFormat?: { type: 'text' | 'json_object' };
}

/**
 * Callable query surface plus its immutable initial project-access decision. Calls share one session
 * and run one at a time, each answered by its own turn.
 */
export type TQueryFunction = ((prompt: string) => Promise<string>) & {
  readonly projectAccess: TWorkspaceProjectAccess;
  /** Shut the query's session down; later calls are refused. */
  shutdown(): Promise<void>;
};

async function submitQuery(session: InteractiveSession, prompt: string): Promise<string> {
  const turn = await session.submit(prompt);
  const result = await turn.completed;
  return result.response;
}

/**
 * Create a prompt-only query function bound to a provider.
 *
 * ```typescript
 * import { createQuery } from '@robota-sdk/agent-framework';
 * import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
 *
 * const query = createQuery({ provider: new AnthropicProvider({ apiKey: '...' }) });
 * const answer = await query('List all TypeScript files');
 * ```
 */
export function createQuery(options: ICreateQueryOptions): TQueryFunction {
  const cwd = options.cwd ?? process.cwd();
  const projectAccess =
    options.projectAccess ?? createRestrictedWorkspaceProjectAccess('identity-unavailable', cwd);
  // Contained — ARCH-048. These boundaries reject cross-root pairs until one canonical project-root
  // binding contract replaces the independent cwd and projectAccess carriers.
  if (projectAccess.status === 'trusted') {
    const trustedRoot = getWorkspaceProjectIdentity(projectAccess.authority).worktreeRoot;
    let resolvedCwd: string;
    try {
      resolvedCwd = realpathSync(cwd);
    } catch {
      throw new WorkspaceAuthorityRequiredError(
        'Trusted project access cannot validate the requested working directory.',
      );
    }
    if (!isWorkspacePathContained(trustedRoot, resolvedCwd)) {
      throw new WorkspaceAuthorityRequiredError(
        'Trusted project access does not cover the requested working directory.',
      );
    }
  }
  const session = buildRuntimeSession({
    cwd,
    provider: options.provider,
    projectAccess,
    ...(options.userSettingsSources !== undefined
      ? { userSettingsSources: options.userSettingsSources }
      : {}),
    permissionMode: options.permissionMode ?? 'default',
    ...(options.model !== undefined ? { model: options.model } : {}),
    maxTurns: options.maxTurns,
    ...(options.allowedTools !== undefined ? { allowedTools: options.allowedTools } : {}),
    ...(options.deniedTools !== undefined ? { deniedTools: options.deniedTools } : {}),
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

  // One call at a time: queued submissions from one caller coalesce, so a third concurrent call
  // would replace the second instead of getting its own answer.
  let previous: Promise<unknown> = Promise.resolve();
  let shutDown = false;
  const query = (prompt: string): Promise<string> => {
    const answer = previous.then(() => {
      if (shutDown) throw new Error('This query has been shut down.');
      return submitQuery(session, prompt);
    });
    previous = answer.catch(() => undefined);
    return answer;
  };
  const shutdown = async (): Promise<void> => {
    shutDown = true;
    await session.shutdown();
  };
  return Object.freeze(Object.assign(query, { projectAccess, shutdown }));
}
