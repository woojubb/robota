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
      id: `example-${Date.now()}-2`,
      role: 'assistant',
      content: `session:${content}`,
      timestamp: new Date(),
      state: 'complete',
    };
  }

  override async *chatStream(
    _messages: TUniversalMessage[],
    _options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    yield {
      id: `example-${Date.now()}-3`,
      role: 'assistant',
      content: 'session-stream',
      timestamp: new Date(),
      state: 'complete',
    };
  }
}

const silentTerminal: ITerminalOutput = {
  writeError(_text: string): void {},
  async prompt(): Promise<string> {
    // A silent example terminal answers nothing rather than blocking; `ITerminalOutput` requires the
    // member, and a stub that omitted it only compiled because nothing typechecked this directory.
    return '';
  },
  async select(_options: string[], initialIndex = 0): Promise<number> {
    return initialIndex;
  },
  write(_text: string): void {},
  writeLine(_text: string): void {},
  writeMarkdown(_md: string): void {},
  spinner(_message: string): ISpinner {
    return { stop(): void {}, update(_msg: string): void {} };
  },
};

async function main(): Promise<void> {
  const session = new Session({
    // ARCH-010: the session's execution root is an explicit field, not an ambient process read.
    cwd: process.cwd(),
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
