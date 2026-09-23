import { randomUUID } from 'node:crypto';

import type { TurnClaim } from './turn-claim.js';
import type { Robota, IToolExecutionResult, TToolParameters } from '@robota-sdk/agent-core';

/** Direct calls share the session claim and retain their completion for graceful disposal. */
export class SessionRuntimeTools {
  private execution: Promise<IToolExecutionResult> | null = null;

  constructor(
    private readonly agent: Robota,
    private readonly claim: TurnClaim,
    private readonly sessionId: string,
  ) {}

  async invoke(
    name: string,
    parameters: TToolParameters,
    signal?: AbortSignal,
  ): Promise<IToolExecutionResult> {
    const controller = this.claim.claim();
    const unlink = linkCancellation(controller, signal);
    try {
      controller.signal.throwIfAborted();
      this.execution = this.agent.invokeRuntimeTool(name, parameters, {
        toolName: name,
        parameters,
        executionId: randomUUID(),
        sessionId: this.sessionId,
        signal: controller.signal,
        permissionInteraction: 'deny',
      });
      return await this.execution;
    } finally {
      this.execution = null;
      unlink();
      this.claim.release(controller);
    }
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
