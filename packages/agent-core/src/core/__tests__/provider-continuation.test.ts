import { describe, expect, it } from 'vitest';

import { AbstractAIProvider } from '../../abstracts/abstract-ai-provider';
import { AbstractTool } from '../../abstracts/abstract-tool';
import { PROVIDER_CONTINUATION_METADATA_KEY } from '../../interfaces/messages';
import { ConversationAgent } from '../conversation-agent';

import type { TUniversalMessage } from '../../interfaces/messages';
import type { IToolResult } from '../../interfaces/tool';

const CONTINUATION = '{"opaque":"signed-reasoning"}';

class EchoTool extends AbstractTool {
  readonly schema = {
    name: 'echo',
    description: 'Echo',
    parameters: { type: 'object' as const, properties: {} },
  };

  protected async executeImpl(): Promise<IToolResult> {
    return { success: true, data: 'ok' };
  }
}

/** Calls the tool once with a continuation on the reply, then answers without one. */
class ContinuationProvider extends AbstractAIProvider {
  readonly name = 'continuation-provider';
  readonly version = '1.0.0';
  readonly received: TUniversalMessage[][] = [];

  async chat(messages: TUniversalMessage[]): Promise<TUniversalMessage> {
    this.received.push(structuredClone(messages));
    if (this.received.length === 1) {
      return {
        id: 'round-1',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', type: 'function', function: { name: 'echo', arguments: '{}' } }],
        state: 'complete',
        timestamp: new Date(),
        metadata: { [PROVIDER_CONTINUATION_METADATA_KEY]: CONTINUATION, otherProviderKey: 'dropped' },
      };
    }
    return {
      id: 'round-2',
      role: 'assistant',
      content: 'done',
      state: 'complete',
      timestamp: new Date(),
    };
  }

  override async *chatStream(): AsyncIterable<TUniversalMessage> {
    yield* [];
  }

  override supportsTools(): boolean {
    return true;
  }
}

describe('provider continuation', () => {
  it('reaches the next request on the committed assistant message, and no other provider key does', async () => {
    const provider = new ContinuationProvider();
    const agent = new ConversationAgent({
      name: 'continuation',
      aiProviders: [provider],
      defaultModel: { provider: provider.name, model: 'test-model' },
      tools: [new EchoTool()],
    });

    await agent.run('hello');

    const assistant = provider.received[1]?.find((message) => message.role === 'assistant');
    expect(assistant?.metadata?.[PROVIDER_CONTINUATION_METADATA_KEY]).toBe(CONTINUATION);
    expect(assistant?.metadata?.['otherProviderKey']).toBeUndefined();
  });
});
