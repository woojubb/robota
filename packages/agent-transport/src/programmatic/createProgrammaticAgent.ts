/**
 * createProgrammaticAgent — a thin in-process driver over the real framework session (INFRA-019).
 *
 * Wraps `createInteractiveRuntime` with a {@link ProgrammaticInteractionChannel} so a caller can drive
 * the real agent structurally: `start()`, `send(text)` (awaits the whole turn), then read assistant
 * replies / tool calls / errors as data — no terminal, no PTY, no scraping. This is the in-process
 * form of "drive the agent at will" (TEST-008).
 */

import { createInteractiveRuntime } from '@robota-sdk/agent-framework';

import { ProgrammaticInteractionChannel } from './ProgrammaticInteractionChannel.js';

import type { IAIProvider, TPermissionMode } from '@robota-sdk/agent-core';
import type { ICommandModule, IInteractiveRuntime } from '@robota-sdk/agent-framework';
import type {
  IInteractiveSessionStore,
  InteractionEvent,
  TActionResponse,
} from '@robota-sdk/agent-interface-transport';

export interface ICreateProgrammaticAgentOptions {
  /** Provider that answers the agent loop (e.g. a real provider, or the scripted provider in tests). */
  provider: IAIProvider;
  /** Working directory for session creation. */
  cwd: string;
  /** Slash-command modules to register (defaults to none). */
  commandModules?: readonly ICommandModule[];
  /** Optional session store for persistence. */
  sessionStore?: IInteractiveSessionStore;
  /** Permission mode for tool execution (e.g. `'bypassPermissions'` for unattended driving). */
  permissionMode?: TPermissionMode;
}

export interface IProgrammaticAgent {
  /** The structured event stream pushed by the framework, in order. */
  readonly events: readonly InteractionEvent[];
  /** Start the runtime and bind a real `InteractiveSession`. Idempotent — a second call is a no-op. */
  start(): Promise<void>;
  /**
   * Push a user message and await the turn. When called serially (await each `send`), this resolves
   * after the whole turn completes. A `send` issued while a turn is still executing is queued by the
   * session and resolves immediately; its reply lands in `events` once that queued turn runs.
   */
  send(text: string): Promise<void>;
  /** Pre-answer the next disambiguation `requestAction`. */
  queueAction(response: TActionResponse): void;
  /** Every completed assistant reply (`assistant-done` fullTexts), in order. */
  assistantReplies(): string[];
  /** The most recent completed assistant reply, or `undefined` if none yet. */
  lastAssistantText(): string | undefined;
  /** Tool-call events captured during the run. */
  toolCalls(): Array<{ id: string; name: string; args: unknown }>;
  /** Errors surfaced by the framework during the run. */
  errors(): Error[];
  /** Stop the runtime and shut down the session. */
  stop(): Promise<void>;
}

export function createProgrammaticAgent(
  options: ICreateProgrammaticAgentOptions,
): IProgrammaticAgent {
  const channel = new ProgrammaticInteractionChannel();
  const runtime: IInteractiveRuntime = createInteractiveRuntime({
    channel,
    commandModules: options.commandModules ?? [],
    provider: options.provider,
    cwd: options.cwd,
    sessionStore: options.sessionStore,
    permissionMode: options.permissionMode,
  });

  /** Events of a given type, narrowed to the matching member of the InteractionEvent union. */
  const byType = <T extends InteractionEvent['type']>(
    type: T,
  ): Array<Extract<InteractionEvent, { type: T }>> =>
    channel.events.filter((e): e is Extract<InteractionEvent, { type: T }> => e.type === type);

  let started = false;
  const assistantReplies = (): string[] => byType('assistant-done').map((e) => e.fullText);

  return {
    events: channel.events,
    start: async (): Promise<void> => {
      if (started) return;
      started = true;
      await runtime.start();
    },
    send: (text: string): Promise<void> => channel.submit(text),
    queueAction: (response: TActionResponse): void => channel.queueAction(response),
    assistantReplies,
    lastAssistantText: (): string | undefined => assistantReplies().at(-1),
    toolCalls: (): Array<{ id: string; name: string; args: unknown }> =>
      byType('tool-call').map((e) => ({ id: e.id, name: e.name, args: e.args })),
    errors: (): Error[] => byType('error').map((e) => e.error),
    stop: (): Promise<void> => runtime.stop(),
  };
}
