import { AbstractAIProvider } from '@robota-sdk/agent-core';
import type { IChatOptions, TUniversalMessage } from '@robota-sdk/agent-core';
import { Session } from '../src/session.js';
import type { ITerminalOutput, ISpinner } from '../src/permission-types.js';

class MockAIProvider extends AbstractAIProvider {
  override readonly name = 'mock-provider';
  override readonly version = '1.0.0';

  override async chat(
    messages: TUniversalMessage[],
    _options?: IChatOptions,
  ): Promise<TUniversalMessage> {
    const last = messages.at(-1);
    const content = typeof last?.content === 'string' ? last.content : '';

    return {
      role: 'assistant',
      content: `session:${content}`,
      timestamp: new Date(),
    };
  }

  override async *chatStream(
    _messages: TUniversalMessage[],
    _options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    yield {
      role: 'assistant',
      content: 'session-stream',
      timestamp: new Date(),
    };
  }
}

const silentTerminal: ITerminalOutput = {
  write(_text: string): void {},
  writeLine(_text: string): void {},
  writeMarkdown(_md: string): void {},
  spinner(_message: string): ISpinner {
    return { stop(): void {}, update(_msg: string): void {} };
  },
};

async function main(): Promise<void> {
  const session = new Session({
    tools: [],
    provider: new MockAIProvider(),
    systemMessage: 'You are a test assistant.',
    terminal: silentTerminal,
    defaultTrustLevel: 'full',
  });

  const response = await session.run('verify-session-run');
  if (response !== 'session:verify-session-run') {
    throw new Error(`Unexpected session response: ${response}`);
  }

  process.stdout.write('sessions offline verify passed.\n');
}

void main();
