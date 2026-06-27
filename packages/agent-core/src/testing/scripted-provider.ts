/**
 * Deterministic scripted provider for functional tests (TEST-003 SSOT).
 *
 * Replays a declared sequence of assistant turns through the REAL agent loop — tool execution,
 * permission gate, persistence, and output all run unmocked. It implements only the agent-core
 * `IAIProvider` contract, so it lives at the lowest layer that owns that abstraction; higher
 * layers (`agent-framework`, `agent-transport`) re-export it through their `./testing` subpaths.
 *
 * Test-only: exported via the `@robota-sdk/agent-core/testing` subpath and never imported by
 * runtime code.
 */

import type { IAIProvider, IRawProviderResponse, TUniversalMessage } from '../index.js';

/** One scripted assistant turn: plain text or tool invocations. */
export type TScriptedTurn =
  | { text: string }
  | { toolCalls: ReadonlyArray<{ name: string; args: Record<string, unknown> }> };

export interface IScriptedProvider {
  provider: IAIProvider;
  /** Message arrays of every chat() call, in order, for request assertions. */
  requests: TUniversalMessage[][];
}

export function createScriptedProvider(turns: readonly TScriptedTurn[]): IScriptedProvider {
  const requests: TUniversalMessage[][] = [];
  let cursor = 0;

  const provider: IAIProvider = {
    name: 'scripted-test-provider',
    version: 'test',
    async chat(messages: TUniversalMessage[]): Promise<TUniversalMessage> {
      requests.push([...messages]);
      const turn = turns[cursor];
      if (turn === undefined) {
        throw new Error(
          `Scripted provider: script exhausted at call ${cursor + 1} (script declares ${turns.length} turn(s)) — extend the script instead of relying on improvised responses`,
        );
      }
      cursor += 1;
      if ('text' in turn) {
        return {
          id: `scripted-${cursor}`,
          role: 'assistant',
          content: turn.text,
          state: 'complete',
          timestamp: new Date(),
        };
      }
      return {
        id: `scripted-${cursor}`,
        role: 'assistant',
        content: null,
        state: 'complete',
        timestamp: new Date(),
        toolCalls: turn.toolCalls.map((call, index) => ({
          id: `scripted-call-${cursor}-${index}`,
          type: 'function' as const,
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        })),
      };
    },
    async generateResponse(): Promise<IRawProviderResponse> {
      return { content: 'scripted provider does not implement raw responses' };
    },
    supportsTools(): boolean {
      return true;
    },
    validateConfig(): boolean {
      return true;
    },
  };

  return { provider, requests };
}
