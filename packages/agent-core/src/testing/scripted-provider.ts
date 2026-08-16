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

import type {
  IAIProvider,
  IChatOptions,
  IRawProviderResponse,
  TUniversalMessage,
} from '../index.js';

/** ANALYTICS-001: optional token usage a scripted turn reports, so usage-based tests are possible. */
export interface IScriptedTurnUsage {
  inputTokens: number;
  outputTokens: number;
}

/** One scripted assistant turn: plain text or tool invocations, optionally reporting token usage. */
export type TScriptedTurn =
  | { text: string; usage?: IScriptedTurnUsage }
  | {
      toolCalls: ReadonlyArray<{ name: string; args: Record<string, unknown> }>;
      usage?: IScriptedTurnUsage;
    };

export interface IScriptedProvider {
  provider: IAIProvider;
  /** Message arrays of every chat() call, in order, for request assertions. */
  requests: TUniversalMessage[][];
  /**
   * The `IChatOptions` of every chat() call, in order.
   *
   * CORE-042: the two entry points must build the SAME options object, and nothing could assert
   * that while the double discarded them.
   */
  chatOptions: Array<IChatOptions | undefined>;
}

export function createScriptedProvider(turns: readonly TScriptedTurn[]): IScriptedProvider {
  const requests: TUniversalMessage[][] = [];
  const chatOptions: Array<IChatOptions | undefined> = [];
  let cursor = 0;

  const provider: IAIProvider = {
    name: 'scripted-test-provider',
    version: 'test',
    async chat(messages: TUniversalMessage[], options?: IChatOptions): Promise<TUniversalMessage> {
      requests.push([...messages]);
      chatOptions.push(options);
      const turn = turns[cursor];
      if (turn === undefined) {
        throw new Error(
          `Scripted provider: script exhausted at call ${cursor + 1} (script declares ${turns.length} turn(s)) — extend the script instead of relying on improvised responses`,
        );
      }
      cursor += 1;
      // ANALYTICS-001: surface declared usage in metadata so the real usage pipeline records it.
      const usageMetadata = turn.usage
        ? {
            metadata: {
              inputTokens: turn.usage.inputTokens,
              outputTokens: turn.usage.outputTokens,
              totalTokens: turn.usage.inputTokens + turn.usage.outputTokens,
            },
          }
        : {};
      if ('text' in turn) {
        // CORE-042: `IChatOptions.onTextDelta` requires a provider to stream internally and call
        // this per chunk WHILE still returning the assembled message. This double returned the text
        // and emitted nothing, so an agent streaming through it produced no deltas -- the double,
        // not the product, was the reason a streaming test needed a second engine to observe. The
        // whole text goes out as one delta: a scripted turn has no chunk boundaries to honour, and
        // splitting it arbitrarily would invent a fragmentation behaviour no real provider promised.
        if (turn.text.length > 0) {
          options?.onTextDelta?.(turn.text);
        }
        return {
          id: `scripted-${cursor}`,
          role: 'assistant',
          content: turn.text,
          state: 'complete',
          timestamp: new Date(),
          ...usageMetadata,
        };
      }
      return {
        id: `scripted-${cursor}`,
        role: 'assistant',
        content: null,
        state: 'complete',
        timestamp: new Date(),
        ...usageMetadata,
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

  return { provider, requests, chatOptions };
}
