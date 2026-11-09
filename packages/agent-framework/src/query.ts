/**
 * createQuery() — factory that returns a prompt-only convenience function.
 *
 * Usage:
 *   const query = createQuery({ host, cwd: process.cwd(), provider });
 *   const answer = await query('What files are here?');
 */

import { requireFrameworkHost } from './host/require-framework-host.js';
import { buildRuntimeSession } from './runtime/runtime-host.js';
import { assertTrustedProjectCoversCwd } from './runtime/trusted-project-cwd.js';
import { createRestrictedWorkspaceProjectAccess } from './workspace-trust/index.js';

import type { TInteractivePermissionHandler } from './interactive/types.js';
import type { InteractiveSession } from './interactive/interactive-session.js';
import type { IHostSettingsSource } from './config/settings-source.js';
import type { IFrameworkHost } from './host/framework-host.js';
import type { TWorkspaceProjectAccess } from './workspace-trust/index.js';
import type { IAIProvider, IToolWithEventService, TPermissionMode } from '@robota-sdk/agent-core';

export interface ICreateQueryOptions {
  /** The platform the query runs on; `{}` is a host with nothing to lend. See `IFrameworkHost`. */
  host: IFrameworkHost;
  /** AI provider instance (required). */
  provider: IAIProvider;
  /** The absolute working directory the query runs in. */
  cwd: string;
  /** Host-owned initial project decision. Absence produces an observable Restricted query. */
  projectAccess?: TWorkspaceProjectAccess;
  /** Explicit user settings layers for this query's session. */
  userSettingsSources?: readonly IHostSettingsSource[];
  /**
   * Permission mode. Defaults to `'default'`: with no `permissionHandler`, anything that would ask is
   * denied. Pass `'bypassPermissions'` explicitly for unattended driving.
   */
  permissionMode?: TPermissionMode;
  /**
   * Model to request. Without it the query uses the model from `userSettingsSources`, or Anthropic's
   * default when none is set — so pass it with any other provider.
   */
  model?: string;
  /** Maximum agentic turns per query. */
  maxTurns?: number;
  /**
   * Tools that run without asking (e.g. your own `additionalTools`). A call that every mode asks
   * about still asks.
   */
  allowedTools?: readonly string[];
  /** Tools the model is never offered. Denied wins over allowed. */
  deniedTools?: readonly string[];
  /** Permission handler callback. */
  permissionHandler?: TInteractivePermissionHandler;
  /** Streaming text callback. */
  onTextDelta?: (delta: string) => void;
  /** Additional tools registered alongside the host's default tools (`host.createDefaultTools`, if it lends any). */
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
  /** Shut the query's session down; the running call and every later one reject. */
  shutdown(): Promise<void>;
};

const SHUT_DOWN_MESSAGE = 'This query has been shut down.';

async function submitQuery(
  session: InteractiveSession,
  prompt: string,
  isShutDown: () => boolean,
): Promise<string> {
  const turn = await session.submit(prompt);
  const result = await turn.completed;
  // Shutting the session down interrupts the running turn; what it had so far is not an answer.
  if (result.interrupted === true && isShutDown()) throw new Error(SHUT_DOWN_MESSAGE);
  return result.response;
}

/**
 * Create a prompt-only query function bound to a provider.
 *
 * The query has the tools its host builds: with `createNodeFrameworkHost({ createDefaultTools })` the
 * default set, with a host that lends no `createDefaultTools` none.
 *
 * ```typescript
 * import { createQuery } from '@robota-sdk/agent-framework';
 * import { createNodeFrameworkHost } from '@robota-sdk/agent-framework/node';
 * import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';
 * import { createDefaultTools } from '@robota-sdk/agent-tool-defaults';
 *
 * const query = createQuery({
 *   host: createNodeFrameworkHost({ createDefaultTools }),
 *   cwd: process.cwd(),
 *   provider: new AnthropicProvider({ apiKey: '...' }),
 * });
 * const answer = await query('List all TypeScript files');
 * ```
 */
export function createQuery(options: ICreateQueryOptions): TQueryFunction {
  requireFrameworkHost(options.host, 'createQuery');
  const { cwd } = options;
  const projectAccess =
    options.projectAccess ?? createRestrictedWorkspaceProjectAccess('identity-unavailable', cwd);
  assertTrustedProjectCoversCwd(options.host, projectAccess, cwd);
  const session = buildRuntimeSession({
    host: options.host,
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
      if (shutDown) throw new Error(SHUT_DOWN_MESSAGE);
      return submitQuery(session, prompt, () => shutDown);
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
