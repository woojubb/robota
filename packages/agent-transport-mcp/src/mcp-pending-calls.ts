/**
 * Calls parked between HTTP exchanges. A stateless HTTP host has no channel back to its client, so
 * on the 2026-07-28 era a question is returned as an input-required result and the call that
 * raised it waits here, still in flight, until the client's retry brings the answer. The retry
 * names the parked call by an opaque `requestState`: a fresh random token, single-use, that names
 * one parked call and nothing else, so no session identifier comes into being. A parked call whose
 * client never returns ends when the session's prompt backstop settles its prompt; its result is
 * then dropped with it.
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

export class McpPendingCalls {
  private readonly parked = new Map<string, IMcpParkedCall>();

  has(requestState: string): boolean {
    return this.parked.has(requestState);
  }

  /** Keeps the call until its retry takes it or its invocation ends; returns the token for the retry. */
  park(call: IMcpParkedCall): string {
    const requestState = randomBytes(32).toString('base64url');
    this.parked.set(requestState, call);
    const drop = (): void => {
      if (this.parked.get(requestState) === call) this.parked.delete(requestState);
    };
    void call.outcome.then(drop, drop);
    return requestState;
  }

  /** The parked call a token names, taken out so the token cannot be used twice. */
  take(requestState: string): IMcpParkedCall | undefined {
    const call = this.parked.get(requestState);
    this.parked.delete(requestState);
    return call;
  }

  /** Ends every parked invocation: the host is stopping and no retry can reach them. */
  abortAll(): void {
    for (const call of this.parked.values()) call.abort.abort();
    this.parked.clear();
  }
}
