/**
 * SELFHOST-008 P2 — post-turn automatic memory capture.
 *
 * Split out of the execution controller, which had grown past its size ratchet. Deciding whether a
 * finished turn produced anything worth remembering is its own job; running the turn is another.
 *
 * Two properties this keeps, and both were load-bearing where it used to live:
 *
 *  - COMPLETED USER turns only. An agent-wakeup or goal turn carries agent-authored text rather than
 *    user facts, so capturing from it would file the agent's own words as things the user said.
 *  - AWAITED by the caller, inside the turn's `finally`, so recorded events land in the SAME turn's
 *    persisted record rather than after it — and guarded, so a capture bug never breaks the turn.
 */

import type { TTurnSource } from './interactive-session-execution-controller.js';
import type { IExecutionResult } from './types.js';
import type { IMemoryEvent } from '@robota-sdk/agent-interface-session';

export interface IPostTurnMemoryInput {
  readonly capture?: (input: {
    userMessage: string;
    assistantMessage: string;
  }) => Promise<IMemoryEvent[]>;
  readonly completedResult: IExecutionResult | undefined;
  readonly turnSource: TTurnSource | undefined;
  readonly userMessage: string;
  readonly record: (event: IMemoryEvent) => void;
  readonly onError: (error: Error) => void;
}

export async function capturePostTurnMemory(input: IPostTurnMemoryInput): Promise<void> {
  if (!input.capture || !input.completedResult) return;
  if ((input.turnSource ?? 'user') !== 'user') return;
  try {
    const events = await input.capture({
      userMessage: input.userMessage,
      assistantMessage: input.completedResult.response,
    });
    for (const event of events) input.record(event);
  } catch (error) {
    // allow-fallback: memory capture is best-effort — a capture failure must never fail the turn
    input.onError(error instanceof Error ? error : new Error(String(error)));
  }
}
