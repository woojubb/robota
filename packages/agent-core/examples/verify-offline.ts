import { AbstractAIProvider } from '../src/abstracts/abstract-ai-provider.ts';
import { Robota } from '../src/core/robota.ts';
import type { IChatOptions } from '../src/interfaces/provider.ts';
import type { TUniversalMessage } from '../src/interfaces/messages.ts';

class MockAIProvider extends AbstractAIProvider {
  override readonly name = 'mock-provider';
  override readonly version = '1.0.0';

  /**
   * CORE-042: this double used to answer `chat()` and `chatStream()` DIFFERENTLY (`offline:` vs
   * `stream:`), because the agent had two execution engines and the scenario pinned which one ran.
   * There is one turn now, so it implements the `IChatOptions.onTextDelta` contract the way a real
   * provider does -- emit each chunk, and still return the complete assembled message -- and the
   * scenario below checks the property that actually matters: both entry points answer the same.
   */
  override async chat(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): Promise<TUniversalMessage> {
    const last = messages.at(-1);
    const content = typeof last?.content === 'string' ? last.content : '';

    options?.onTextDelta?.('offline:');
    options?.onTextDelta?.(content);

    return {
      // `IBaseMessage` requires `id` and `state`; this literal predates both and only compiled
      // because nothing typechecked this directory (issue #1902).
      id: `offline-${Date.now()}`,
      role: 'assistant',
      content: `offline:${content}`,
      timestamp: new Date(),
      state: 'complete',
    };
  }
}

async function collectStream(agent: Robota, input = 'verify-stream'): Promise<string> {
  let output = '';
  for await (const chunk of agent.runStream(input)) {
    output += chunk;
  }
  return output;
}

async function main(): Promise<void> {
  const agent = new Robota({
    name: 'OfflineVerifyAgent',
    aiProviders: [new MockAIProvider()],
    defaultModel: {
      provider: 'mock-provider',
      model: 'offline-model',
    },
    logging: {
      enabled: false,
      level: 'silent',
    },
  });

  const response = await agent.run('verify-run');
  if (response !== 'offline:verify-run') {
    throw new Error(`Unexpected run response: ${response}`);
  }

  const streamed = await collectStream(agent);
  if (streamed !== 'offline:verify-stream') {
    throw new Error(`Unexpected stream response: ${streamed}`);
  }

  // CORE-042: the two entry points are two entries into ONE turn, so the same input must produce
  // the same answer through either. That is the property six copied capabilities failed to hold.
  const viaRun = await agent.run('same-input');
  const viaStream = await collectStream(agent, 'same-input');
  if (viaRun !== viaStream) {
    throw new Error(`run and runStream disagree: ${viaRun} vs ${viaStream}`);
  }

  await agent.destroy();
  process.stdout.write('agents offline verify passed.\n');
}

void main();
