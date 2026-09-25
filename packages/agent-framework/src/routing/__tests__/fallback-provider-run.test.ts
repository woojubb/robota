/**
 * A real `Robota` run over a `FallbackProvider`: what the loop records when a turn moves to another
 * model, and that the conversation it keeps is the same one it would keep had the primary answered.
 */

import { FunctionTool, ProviderError, Robota } from '@robota-sdk/agent-core';
import { describe, expect, it } from 'vitest';

import { FallbackProvider } from '../fallback-provider.js';

import type {
  IAIProvider,
  IChatOptions,
  IToolSchema,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

const OBJECT_PARAMS: IToolSchema['parameters'] = { type: 'object', properties: {} };

function toolCallReply(): TUniversalMessage {
  return {
    id: 'a-tool',
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } }],
    timestamp: new Date(),
    state: 'complete',
    metadata: { inputTokens: 10, outputTokens: 2 },
  } as TUniversalMessage;
}

function textReply(content: string): TUniversalMessage {
  return {
    id: `a-${content}`,
    role: 'assistant',
    content,
    timestamp: new Date(),
    state: 'complete',
    metadata: { inputTokens: 12, outputTokens: 3 },
  };
}

/** Answers a tool call, then text, for each run; optionally overloaded on chosen calls. */
class ScriptedProvider implements IAIProvider {
  readonly version = '1.0.0';
  readonly calls: Array<{ messages: TUniversalMessage[]; options: IChatOptions }> = [];
  private answered = 0;

  constructor(
    readonly name: string,
    private readonly overloadedCalls: ReadonlySet<number> = new Set(),
  ) {}

  async chat(messages: TUniversalMessage[], options: IChatOptions = {}): Promise<TUniversalMessage> {
    this.calls.push({ messages, options });
    if (this.overloadedCalls.has(this.calls.length)) {
      throw new ProviderError('overloaded', this.name, undefined, undefined, { status: 529 });
    }
    this.answered += 1;
    return this.answered % 2 === 1 ? toolCallReply() : textReply('done');
  }

  generateResponse(): never {
    throw new Error('not used');
  }

  supportsTools(): boolean {
    return true;
  }

  validateConfig(): boolean {
    return true;
  }
}

function createAgent(provider: IAIProvider): Robota {
  return new Robota({
    name: 'fallback-run',
    aiProviders: [provider],
    defaultModel: { provider: 'anthropic', model: 'claude-primary' },
    tools: [
      new FunctionTool(
        { name: 'lookup', description: 'looks something up', parameters: OBJECT_PARAMS },
        async () => 'found it',
      ),
    ],
  });
}

type TEvent = { event: string; data: Record<string, unknown> };

async function runTurn(agent: Robota, events: TEvent[] = []): Promise<void> {
  await agent.run('find it', {
    onExecutionEvent: (event, data) => events.push({ event, data: data as Record<string, unknown> }),
  });
}

/** History with what differs between any two runs (ids, clocks, attribution) taken out. */
function comparable(history: TUniversalMessage[]): unknown[] {
  return history.map((message) => {
    const {
      id: _id,
      timestamp: _timestamp,
      metadata,
      ...rest
    } = message as TUniversalMessage & { metadata?: Record<string, unknown> };
    const {
      executionId: _executionId,
      usageObservationId: _usageObservationId,
      providerId: _providerId,
      modelId: _modelId,
      ...kept
    } = metadata ?? {};
    return { ...rest, metadata: kept };
  });
}

describe('a run over FallbackProvider', () => {
  it('names the model that answered in every record, and says it moved', async () => {
    const primary = new ScriptedProvider('anthropic', new Set([1]));
    const next = new ScriptedProvider('openai');
    const agent = createAgent(
      new FallbackProvider(primary, [
        { ref: { provider: 'openai', model: 'gpt-next' }, create: () => next },
      ]),
    );
    const events: TEvent[] = [];
    try {
      await runTurn(agent, events);

      const fallbacks = events.filter((entry) => entry.event === 'provider_fallback');
      expect(fallbacks.map((entry) => entry.data)).toEqual([
        expect.objectContaining({
          round: 1,
          fromProvider: 'anthropic',
          fromModel: 'claude-primary',
          toProvider: 'openai',
          toModel: 'gpt-next',
          reason: 'overloaded',
        }),
      ]);
      const requests = events
        .filter((entry) => entry.event === 'provider_request')
        .map((entry) => `${entry.data['round']}:${entry.data['provider']}/${entry.data['model']}`);
      expect(requests).toEqual([
        '1:anthropic/claude-primary',
        '1:openai/gpt-next',
        '2:openai/gpt-next',
      ]);
      const completed = events
        .filter((entry) => entry.event === 'provider_call_completed')
        .map((entry) => `${entry.data['providerId']}/${entry.data['modelId']}`);
      expect(completed).toEqual(['openai/gpt-next', 'openai/gpt-next']);
      const assistants = agent.getHistory().filter((message) => message.role === 'assistant');
      expect(assistants.map((message) => message.metadata?.['modelId'])).toEqual([
        'gpt-next',
        'gpt-next',
      ]);
      expect(assistants.map((message) => message.metadata?.['providerId'])).toEqual([
        'openai',
        'openai',
      ]);
      // The second round stayed on the model that accepted the first.
      expect(primary.calls).toHaveLength(1);
      expect(next.calls).toHaveLength(2);

      // The next run starts on the primary again.
      const nextRun: TEvent[] = [];
      await runTurn(agent, nextRun);
      expect(primary.calls).toHaveLength(3);
      expect(nextRun.some((entry) => entry.event === 'provider_fallback')).toBe(false);
    } finally {
      await agent.destroy();
    }
  });

  it('keeps the same provider-neutral history as a run the primary answered', async () => {
    const primary = new ScriptedProvider('anthropic', new Set([1]));
    const next = new ScriptedProvider('openai');
    const movedAgent = createAgent(
      new FallbackProvider(primary, [
        { ref: { provider: 'openai', model: 'gpt-next' }, create: () => next },
      ]),
    );
    const plainAgent = createAgent(new ScriptedProvider('anthropic'));
    try {
      await runTurn(movedAgent);
      await runTurn(plainAgent);

      expect(comparable(movedAgent.getHistory())).toEqual(comparable(plainAgent.getHistory()));
      // The other model was handed the very messages the primary was: nothing converted for it.
      expect(next.calls[0]?.messages).toBe(primary.calls[0]?.messages);
    } finally {
      await movedAgent.destroy();
      await plainAgent.destroy();
    }
  });
});
