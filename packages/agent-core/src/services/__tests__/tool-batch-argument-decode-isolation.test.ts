/**
 * Issue #2875 (follow-up to #2078, tracked under its #2079 row) — batch isolation for malformed
 * tool-call arguments.
 *
 * #2078 fixed `decodeToolCallArguments` to refuse a non-object JSON root, but the refusal was a
 * `throw` inside `createExecutionRequestsWithContext`'s `.map()` — before `executeTools` ever runs,
 * so `continueOnError: true` (hardcoded for the production round in `execution-round-tools.ts`)
 * never got a chance to apply. A provider batch with one malformed call and one valid call in it
 * made `Robota.run()` reject: the valid call never executed, the provider was never called again,
 * and history was left holding an assistant message with two tool calls and no tool results at all
 * — not even for the well-formed one.
 *
 * These tests drive that scenario through the real `Robota.run()` (not the lower-level services in
 * isolation) because the bug was specifically about ordering between decode and `executeTools`,
 * which only the full round reproduces.
 */
import { describe, expect, it } from 'vitest';

import { Robota } from '../../core/robota';
import { AbstractTool } from '../../abstracts/abstract-tool';

import type { IAgentConfig } from '../../interfaces/agent';
import type { IToolResult, TToolParameters } from '../../interfaces/tool';
import type { IToolSchema } from '../../interfaces/tool-schema';
import type { IAIProvider, IChatOptions, IRawProviderResponse } from '../../interfaces/provider';
import type { IToolCall, TUniversalMessage } from '../../interfaces/messages';

/** A tool that records every call it actually received, so "executed exactly once" is measurable. */
class SearchTool extends AbstractTool {
  readonly calls: TToolParameters[] = [];

  override get schema(): IToolSchema {
    return {
      name: 'search',
      description: 'search for something',
      parameters: {
        type: 'object' as const,
        properties: { q: { type: 'string' as const } },
      },
    };
  }

  protected override async executeImpl(parameters: TToolParameters): Promise<IToolResult> {
    this.calls.push(parameters);
    return { success: true, data: { echoed: parameters['q'] } };
  }
}

/**
 * A raw provider (not `createScriptedProvider`, which always `JSON.stringify`s well-formed argument
 * objects) so a turn can name a tool call whose `function.arguments` is malformed JSON or a
 * non-object root — exactly what a real provider is free to send.
 */
function createRawToolCallProvider(turns: ReadonlyArray<IToolCall[] | { text: string }>): {
  provider: IAIProvider;
  requests: TUniversalMessage[][];
} {
  const requests: TUniversalMessage[][] = [];
  let cursor = 0;
  const provider: IAIProvider = {
    name: 'raw-test-provider',
    version: 'test',
    async chat(messages: TUniversalMessage[], _options?: IChatOptions): Promise<TUniversalMessage> {
      requests.push([...messages]);
      const turn = turns[cursor];
      if (turn === undefined) {
        throw new Error(`raw provider script exhausted at call ${cursor + 1}`);
      }
      cursor += 1;
      if ('text' in turn) {
        return {
          id: `raw-${cursor}`,
          role: 'assistant',
          content: turn.text,
          state: 'complete',
          timestamp: new Date(),
        };
      }
      return {
        id: `raw-${cursor}`,
        role: 'assistant',
        content: null,
        state: 'complete',
        timestamp: new Date(),
        toolCalls: turn,
      };
    },
    async generateResponse(): Promise<IRawProviderResponse> {
      return { content: 'raw provider does not implement raw responses' };
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

function buildAgent(
  provider: IAIProvider,
  tool: SearchTool,
  overrides: Partial<IAgentConfig> = {},
): Robota {
  return new Robota({
    name: 'batch-isolation',
    aiProviders: [provider],
    defaultModel: { provider: 'raw-test-provider', model: 'test-model' },
    tools: [tool],
    logging: { level: 'silent', enabled: false },
    ...overrides,
  } as IAgentConfig);
}

describe('Issue #2875 — malformed tool-call arguments are isolated within a batch', () => {
  it('runs the valid call, reports a decode error for the malformed one, and calls the provider again with both results', async () => {
    const tool = new SearchTool();
    const { provider, requests } = createRawToolCallProvider([
      [
        { id: 'call_bad', type: 'function', function: { name: 'search', arguments: '[1]' } },
        { id: 'call_good', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } },
      ],
      { text: 'done' },
    ]);
    const agent = buildAgent(provider, tool);

    try {
      // The defect made this reject with a ValidationError instead of resolving.
      await agent.run('go');

      // The valid call executed exactly once, with its decoded parameters — not zero times.
      expect(tool.calls).toHaveLength(1);
      expect(tool.calls[0]).toEqual({ q: 'x' });

      // The provider was called a second time with the tool results (the defect: it never was).
      expect(requests).toHaveLength(2);

      const history = agent.getHistory();
      const toolMessages = history.filter(
        (message): message is Extract<TUniversalMessage, { role: 'tool' }> =>
          message.role === 'tool',
      );

      // Both call ids get a tool-result message — not just the valid one.
      const badResult = toolMessages.find((message) => message.toolCallId === 'call_bad');
      const goodResult = toolMessages.find((message) => message.toolCallId === 'call_good');
      expect(badResult).toBeDefined();
      expect(goodResult).toBeDefined();

      // The bad call's result clearly names the tool and call it failed for.
      expect(badResult?.content).toMatch(/search/);
      expect(badResult?.content).toMatch(/call_bad/);
      expect(badResult?.content).toMatch(/expected a JSON object at the root/);

      // The good call's result reflects the tool having actually run.
      expect(goodResult?.content).toMatch(/x/);
    } finally {
      await agent.destroy();
    }
  });

  it('isolates every call when the whole batch is malformed: no throw, no tool execution, a result for each call id', async () => {
    const tool = new SearchTool();
    const { provider, requests } = createRawToolCallProvider([
      [
        { id: 'call_bad_1', type: 'function', function: { name: 'search', arguments: '[1]' } },
        { id: 'call_bad_2', type: 'function', function: { name: 'search', arguments: 'not json' } },
      ],
      { text: 'done' },
    ]);
    const agent = buildAgent(provider, tool);

    try {
      await agent.run('go');

      expect(tool.calls).toHaveLength(0);
      // The provider is still called again — the round is not aborted, it reports two failures.
      expect(requests).toHaveLength(2);

      const history = agent.getHistory();
      const toolMessages = history.filter(
        (message): message is Extract<TUniversalMessage, { role: 'tool' }> =>
          message.role === 'tool',
      );
      expect(toolMessages.find((message) => message.toolCallId === 'call_bad_1')).toBeDefined();
      expect(toolMessages.find((message) => message.toolCallId === 'call_bad_2')).toBeDefined();
    } finally {
      await agent.destroy();
    }
  });
});
