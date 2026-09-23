/**
 * createProgrammaticAgent — the in-process implementation of the client-side agent contract
 * (`IAgentDriver`, INFRA-020; introduced as the programmatic driver in INFRA-019).
 *
 * Wraps `createInteractiveRuntime` with a {@link ProgrammaticInteractionChannel} so a caller can drive
 * the real agent structurally: `start()`, `send(text)` (awaits the whole turn), then read assistant
 * replies / tool calls / errors as data — no terminal, no PTY, no scraping. The observation accessors
 * delegate to the shared `read*` helpers in `@robota-sdk/agent-interface-transport`, so the
 * filter/derivation logic is not re-implemented here.
 */

import {
  readAssistantReplies,
  readErrors,
  readLastAssistantText,
  readToolCalls,
} from '@robota-sdk/agent-interface-session';

import { ProgrammaticInteractionChannel } from './ProgrammaticInteractionChannel.js';
import { createInteractiveRuntime } from '../../interaction/createInteractiveRuntime.js';

import type { ICommandModule } from '../../command-api/command-module.js';
import type { IInteractiveRuntime } from '../../interaction/InteractiveRuntime.js';
import type { TWorkspaceProjectAccess } from '../../workspace-trust/types.js';
import type { IAIProvider, TActionResponse, TPermissionMode } from '@robota-sdk/agent-core';
import type { IAgentDriver, IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';

export interface ICreateProgrammaticAgentOptions {
  /** Provider that answers the agent loop (e.g. a real provider, or the scripted provider in tests). */
  provider: IAIProvider;
  /** Working directory for session creation. */
  cwd: string;
  /** Trusted-or-restricted project decision made by the host. Absence is Restricted. */
  projectAccess?: TWorkspaceProjectAccess;
  /** Slash-command modules to register (defaults to none). */
  commandModules?: readonly ICommandModule[];
  /** Optional session store for persistence. */
  sessionStore?: IInteractiveSessionStore;
  /** Permission mode for tool execution (e.g. `'bypassPermissions'` for unattended driving). */
  permissionMode?: TPermissionMode;
}

/**
 * Construct an in-process {@link IAgentDriver} bound to a real `InteractiveSession`. The returned
 * driver's accessors are the shared `read*` helpers applied to the captured event stream.
 */
export function createProgrammaticAgent(options: ICreateProgrammaticAgentOptions): IAgentDriver {
  const channel = new ProgrammaticInteractionChannel();
  const runtime: IInteractiveRuntime = createInteractiveRuntime({
    channel,
    commandModules: options.commandModules ?? [],
    provider: options.provider,
    cwd: options.cwd,
    projectAccess: options.projectAccess,
    sessionStore: options.sessionStore,
    permissionMode: options.permissionMode,
  });

  let started = false;

  return {
    events: channel.events,
    start: async (): Promise<void> => {
      if (started) return;
      started = true;
      await runtime.start();
    },
    send: (text: string): Promise<void> => channel.submit(text),
    queueUserAction: (response: TActionResponse): void => channel.queueUserAction(response),
    assistantReplies: (): string[] => readAssistantReplies(channel.events),
    lastAssistantText: (): string | undefined => readLastAssistantText(channel.events),
    toolCalls: () => readToolCalls(channel.events),
    errors: (): Error[] => readErrors(channel.events),
    stop: (): Promise<void> => runtime.stop(),
  };
}
