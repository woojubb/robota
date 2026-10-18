import { randomUUID } from 'node:crypto';

import type { TurnClaim } from './turn-claim.js';
import type {
  ConversationAgent,
  IToolExecutionResult,
  IUserInteraction,
  TToolParameters,
} from '@robota-sdk/agent-core';
import type { IRuntimeToolInvokeOptions } from '@robota-sdk/agent-interface-session';

/** Direct calls share the session claim and retain their completion for graceful disposal. */
export class SessionRuntimeTools {
  private execution: Promise<IToolExecutionResult> | null = null;

  constructor(
    private readonly agent: ConversationAgent,
    private readonly claim: TurnClaim,
    private readonly sessionId: string,
    private readonly ask?: IUserInteraction['ask'],
  ) {}

  /**
   * `permissionInteraction` is `'deny'` unless the caller answers its own prompts; only then may
   * the call ask for permission or put a question through the session's ask port.
   */
  async invoke(
    name: string,
    parameters: TToolParameters,
    options?: IRuntimeToolInvokeOptions,
  ): Promise<IToolExecutionResult> {
    const controller = this.claim.claim();
    const unlink = linkCancellation(controller, options?.signal);
    try {
      controller.signal.throwIfAborted();
      this.execution = this.agent.invokeRuntimeTool(name, parameters, {
        toolName: name,
        parameters,
        executionId: options?.executionId ?? randomUUID(),
        sessionId: this.sessionId,
        signal: controller.signal,
        // A caller nobody is watching must not park on a prompt, so asking is the caller's choice;
        // a caller that answers its own prompts also gets the session's ask port.
        permissionInteraction: options?.permissionInteraction ?? 'deny',
        ...(options?.permissionInteraction === 'interactive' && this.ask !== undefined
          ? { ask: this.askUnder(controller.signal) }
          : {}),
      });
      return await this.execution;
    } finally {
      this.execution = null;
      unlink();
      this.claim.release(controller);
    }
  }

  /** The ask port for one direct call: a question it asks is withdrawn when the call is cancelled. */
  private askUnder(signal: AbortSignal): IUserInteraction['ask'] {
    const ask = this.ask;
    if (ask === undefined) throw new Error('No ask port');
    return (request, options) => ask(request, { signal: options?.signal ?? signal });
  }

  async drain(): Promise<void> {
    await this.execution;
  }
}

/** Link only this operation's signal; releasing it never cancels another claim. */
export function linkCancellation(controller: AbortController, signal?: AbortSignal): () => void {
  const abort = (): void => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  return () => signal?.removeEventListener('abort', abort);
}
