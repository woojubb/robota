/**
 * Calls parked between HTTP exchanges. A stateless HTTP host has no channel back to its client, so
 * on the 2026-07-28 era a question is returned as an input-required result and the call that
 * raised it waits here, still in flight, until the client's retry brings the answer. The retry
 * names the parked call by an opaque `requestState`: a fresh random token, single-use, that names
 * one parked call and nothing else, so no session identifier comes into being.
 *
 * A parked call is abandoned (its open prompts settled closed, its invocation aborted) when its
 * client does not come back in time or the host stops, so an absent client holds the session for
 * one bounded wait, not one per prompt. A call whose work ends while parked keeps its result under
 * its token until then, so the retry still receives it.
 */
import { randomBytes } from 'node:crypto';

import type { McpCallPrompts, TMcpCallPrompt } from './mcp-call-prompts.js';
import type { CallToolResult } from '@modelcontextprotocol/server';

export interface IMcpParkedCall {
  readonly prompts: McpCallPrompts;
  /** The prompt the client was asked about; the retry answers this one. */
  readonly prompt: TMcpCallPrompt;
  /** The invocation, still running. */
  readonly outcome: Promise<CallToolResult>;
  /** Aborts the invocation when the host stops. */
  readonly abort: AbortController;
}

/**
 * A session runs one foreground call at a time, so in practice one call is parked at most; the
 * bound keeps a session that admits more from holding an unbounded number of unanswered calls.
 */
const MAX_PARKED_CALLS = 16;
/** As long as the session waits for a person to answer one prompt. */
const PARKED_CALL_DEADLINE_MS = 30 * 60 * 1000;

/** Ends a call nobody will come back for: its open prompts settle closed, its invocation aborts. */
export function abandonCall(call: Pick<IMcpParkedCall, 'prompts' | 'abort'>): void {
  call.prompts.settleOutstanding();
  call.abort.abort();
}

export class McpPendingCalls {
  private readonly parked = new Map<
    string,
    { readonly call: IMcpParkedCall; readonly timer: ReturnType<typeof setTimeout> }
  >();
  private stopped = false;

  constructor(private readonly deadlineMs = PARKED_CALL_DEADLINE_MS) {}

  has(requestState: string): boolean {
    return this.parked.has(requestState);
  }

  /**
   * Keeps the call until its retry takes it, its deadline passes or the host stops; returns the
   * token for the retry, or `undefined` when the question cannot be put (the bound is reached or
   * the host is stopping).
   */
  park(call: IMcpParkedCall): string | undefined {
    if (this.stopped || this.parked.size >= MAX_PARKED_CALLS) return undefined;
    const requestState = randomBytes(32).toString('base64url');
    const timer = setTimeout(() => {
      if (this.parked.get(requestState)?.call !== call) return;
      this.parked.delete(requestState);
      abandonCall(call);
    }, this.deadlineMs);
    // Never keep the process alive purely to end a parked call.
    timer.unref?.();
    this.parked.set(requestState, { call, timer });
    return requestState;
  }

  /** The parked call a token names, taken out so the token cannot be used twice. */
  take(requestState: string): IMcpParkedCall | undefined {
    const entry = this.parked.get(requestState);
    if (entry === undefined) return undefined;
    this.parked.delete(requestState);
    clearTimeout(entry.timer);
    return entry.call;
  }

  /** Ends every parked call and parks no more: the host is stopping and no retry can reach them. */
  abortAll(): void {
    this.stopped = true;
    for (const { call, timer } of this.parked.values()) {
      clearTimeout(timer);
      abandonCall(call);
    }
    this.parked.clear();
  }
}
